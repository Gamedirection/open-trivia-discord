import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js';

function buildAnswerRows(session) {
  const buttons = session.options.map((option) =>
    new ButtonBuilder()
      .setCustomId(`ot-answer:${session.id}:${option.key}`)
      .setLabel(option.label)
      .setStyle(ButtonStyle.Primary)
  );
  return [new ActionRowBuilder().addComponents(buttons)];
}

function formatDifficultyLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Medium';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeQuestionImageUrl(imageUrl, publicAppUrl) {
  const value = String(imageUrl || '').trim();
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value).toString();
      return /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(parsed) ? parsed : null;
    }
    const parsed = new URL(value, `${String(publicAppUrl || '').replace(/\/+$/, '')}/`).toString();
    return /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionSummaryEmbed(session, statusText) {
  const embed = new EmbedBuilder()
    .setTitle(`Open-Trivia: ${session.category || 'General'}`)
    .setDescription(session.text)
    .addFields(
      ...session.options.map((option) => ({
        name: option.key,
        value: option.label,
        inline: true
      })),
      {
        name: 'Status',
        value: statusText,
        inline: false
      }
    )
    .setTimestamp(new Date(session.createdAt));
  if (session.imageUrl) {
    embed.setImage(session.imageUrl);
  }
  return embed;
}

export class SessionManager {
  constructor({ store, backendClient, questionTimeoutSeconds }) {
    this.store = store;
    this.backendClient = backendClient;
    this.questionTimeoutSeconds = questionTimeoutSeconds;
    this.timers = new Map();
  }

  restore(client) {
    for (const session of this.store.getSessions()) {
      if (session.status === 'open') {
        this.armTimeout(client, session);
      }
    }
  }

  async createSession({
    client,
    channel,
    mode,
    ownerDiscordUserId,
    guildId,
    category,
    count = 1
  }) {
    let items = [];
    try {
      const payload = await this.backendClient.fetchQuestions({
        category,
        count,
        guildId,
        channelId: channel.id,
        mode: mode === 'private' ? 'direct' : mode,
        closeAfterSeconds: this.questionTimeoutSeconds
      });
      items = Array.isArray(payload.sessions) ? payload.sessions : [];
    } catch (err) {
      if (!String(err?.message || '').includes('No questions available')) throw err;
    }
    if (!items.length) {
      const fallback = await this.backendClient.fetchOpenTdbQuestions({ count });
      const fallbackQuestions = Array.isArray(fallback?.questions) ? fallback.questions : [];
      items = fallbackQuestions.map((question) => ({
        session_id: `opentdb-${question.id}`,
        closes_at: new Date(Date.now() + this.questionTimeoutSeconds * 1000).toISOString(),
        question: {
          ...question,
          source: 'OpenTriviaDB'
        }
      }));
    }
    const sessions = [];
    for (const item of items) {
      const question = item.question || {};
      const session = {
        id: String(item.session_id),
        backendQuestionId: question.id,
        source: question.source || 'local',
        createdAt: new Date().toISOString(),
        guildId: guildId || null,
        channelId: channel.id,
        mode,
        ownerDiscordUserId: ownerDiscordUserId || null,
        category: question.category || category || 'General',
        complexity: question.complexity || 'medium',
        text: question.text,
        imageUrl: normalizeQuestionImageUrl(question.image_url, this.backendClient.publicAppUrl),
        options: Array.isArray(question.options)
          ? question.options.map((option) => ({
            key: String(option.char || option.key || '').toUpperCase(),
            label: option.text || option.label || ''
          })).filter((option) => option.key && String(option.label || '').trim())
          : [],
        correctAnswer: String(question.correctAnswer || '').trim().toUpperCase() || null,
        guesses: {},
        status: 'open',
        messageId: null,
        closesAt: item.closes_at || new Date(Date.now() + this.questionTimeoutSeconds * 1000).toISOString()
      };
      const sent = await channel.send({
        embeds: [sessionSummaryEmbed(session, '0 users have guessed.')],
        components: buildAnswerRows(session)
      });
      session.messageId = sent.id;
      this.store.saveSession(session);
      this.armTimeout(client, session);
      sessions.push(session);
    }
    return sessions;
  }

  armTimeout(client, session) {
    this.clearTimeout(session.id);
    const due = Math.max(1000, new Date(session.closesAt).getTime() - Date.now());
    const timer = setTimeout(() => {
      this.revealSession(client, session.id, { timedOut: true }).catch((err) => {
        console.error('Failed to reveal session on timeout', err);
      });
    }, due);
    this.timers.set(session.id, timer);
  }

  clearTimeout(sessionId) {
    const existing = this.timers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(sessionId);
    }
  }

  async handleButtonInteraction(client, interaction) {
    const [prefix, sessionId, answerKey] = interaction.customId.split(':');
    if (prefix !== 'ot-answer') return false;
    const session = this.store.getSessions().find((item) => item.id === sessionId);
    if (!session || session.status !== 'open') {
      await interaction.reply({ content: 'This trivia question is no longer active.', ephemeral: true });
      return true;
    }
    if (session.mode === 'private' && interaction.user.id !== session.ownerDiscordUserId) {
      await interaction.reply({ content: 'This question is private to the requesting user.', ephemeral: true });
      return true;
    }
    if (session.guesses[interaction.user.id]) {
      await interaction.reply({ content: 'You already answered this question.', ephemeral: true });
      return true;
    }

    try {
      const result = session.source === 'OpenTriviaDB'
        ? {
            linked: true,
            is_correct: answerKey === session.correctAnswer,
            points_awarded: 0,
            answered_count: Object.keys(session.guesses).length + 1,
            difficulty: session.complexity || 'medium',
            correct_answer: session.correctAnswer,
            correct_answer_label: session.options.find((option) => option.key === session.correctAnswer)?.label || session.correctAnswer,
          }
        : await this.backendClient.submitAnswer({
            sessionId: session.id,
            discordUserId: interaction.user.id,
            discordUsername: interaction.user.username,
            discordAvatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
            answer: answerKey
          });

      session.guesses[interaction.user.id] = {
        answer: answerKey,
        correct: !!result.is_correct,
        points: Number(result.points_awarded || 0)
      };
      this.store.saveSession(session);

      const guessCount = Number(result.answered_count || Object.keys(session.guesses).length);
      await interaction.update({
        embeds: [sessionSummaryEmbed(session, `${guessCount} user${guessCount === 1 ? '' : 's'} have guessed.`)],
        components: buildAnswerRows(session)
      });

      if (!result.linked) {
        await interaction.followUp({
          content: `Link your Open-Trivia account first: ${result.link_url || this.backendClient.buildLinkAccountUrl()}`,
          ephemeral: true
        });
      } else {
        const difficultyLabel = formatDifficultyLabel(result.difficulty);
        await interaction.followUp({
          content: result.is_correct
            ? `Correct. This ${difficultyLabel} question was +${result.points_awarded || 0} points.${session.source === 'OpenTriviaDB' ? ' (OpenTriviaDB fallback)' : ''}`
            : `Incorrect. Correct answer: ${result.correct_answer_label || result.correct_answer || 'Unknown'}.`,
          ephemeral: true
        });
      }

      if (session.mode === 'private') {
        await this.revealSession(client, session.id);
      }
    } catch (err) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: `Could not submit your answer: ${err.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Could not submit your answer: ${err.message}`, ephemeral: true });
      }
    }
    return true;
  }

  async revealSession(client, sessionId, { timedOut = false } = {}) {
    const session = this.store.getSessions().find((item) => item.id === sessionId);
    if (!session || session.status !== 'open') return;
    session.status = 'closed';
    this.clearTimeout(sessionId);
    this.store.saveSession(session);

    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (!channel?.messages) {
      this.store.removeSession(sessionId);
      return;
    }
    const message = await channel.messages.fetch(session.messageId).catch(() => null);
    if (!message) {
      this.store.removeSession(sessionId);
      return;
    }
    const result = session.source === 'OpenTriviaDB'
      ? null
      : await this.backendClient.closeSession(session.id).catch(() => null);
    const guessCount = result?.total_answers ?? Object.keys(session.guesses).length;
    const correctAnswer = String(result?.correct_answer || session.correctAnswer || '').toUpperCase();
    const summary = timedOut
      ? `Time is up. ${guessCount} participant${guessCount === 1 ? '' : 's'} answered. Correct answer: ${correctAnswer}.`
      : `Question closed. ${guessCount} participant${guessCount === 1 ? '' : 's'} answered. Correct answer: ${correctAnswer}.`;

    if (timedOut) {
      await message.delete().catch(async () => {
        await message.edit({
          embeds: [sessionSummaryEmbed(session, summary)],
          components: []
        }).catch(() => {});
      });
      this.store.removeSession(sessionId);
      return;
    }

    await message.edit({
      embeds: [sessionSummaryEmbed(session, summary)],
      components: []
    });
    this.store.removeSession(sessionId);
  }
}
