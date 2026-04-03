import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
  Routes
} from 'discord.js';
import { BackendClient } from './backend-client.js';
import { buildCommandDefinitions } from './command-definitions.js';
import { loadConfig } from './config.js';
import { RuntimeStore } from './runtime-store.js';
import { Scheduler } from './scheduler.js';
import { SessionManager } from './session-manager.js';

const config = loadConfig();
const store = new RuntimeStore(config.storagePath);
store.load();
const startedAt = Date.now();
const botVersion = config.botVersion;

const backendClient = new BackendClient({
  baseUrl: config.apiBaseUrl,
  token: config.apiToken,
  publicAppUrl: config.publicAppUrl
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const sessionManager = new SessionManager({
  store,
  backendClient,
  questionTimeoutSeconds: config.questionTimeoutSeconds
});

const scheduler = new Scheduler({
  backendClient,
  sessionManager,
  client,
  pollMs: config.schedulePollMs
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  await rest.put(
    Routes.applicationCommands(config.discordClientId),
    { body: buildCommandDefinitions() }
  );
}

function leaderboardEmbed(result, title) {
  const rows = Array.isArray(result?.entries)
    ? result.entries
    : Array.isArray(result)
      ? result
      : [];
  if (!rows.length) {
    return new EmbedBuilder().setTitle(title).setDescription('No scores yet.');
  }
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      rows.map((row, idx) => {
        const accuracy = Number(row.total_answered || 0) > 0
          ? ` · ${Math.round((Number(row.correct_answered || 0) / Number(row.total_answered || 1)) * 100)}%`
          : '';
        return `**${idx + 1}.** ${row.display_name || row.email || 'Player'} — ${row.score} pts${accuracy}`;
      }).join('\n')
    );
}

function formatUptime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || parts.length) parts.push(`${hours}h`);
  if (minutes || parts.length) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

async function handleOtCommand(interaction) {
  const category = interaction.options.getString('category');
  const count = interaction.options.getInteger('count') || 1;
  const mode = interaction.guildId ? 'public' : 'private';
  await interaction.deferReply(mode === 'private' ? { flags: MessageFlags.Ephemeral } : undefined);
  try {
    const channel = {
      id: interaction.channelId,
      isDMBased: () => mode === 'private',
      send: async (payload) => interaction.followUp(payload)
    };
    const sessions = await sessionManager.createSession({
      client,
      channel,
      mode,
      ownerDiscordUserId: interaction.user.id,
      guildId: interaction.guildId,
      category,
      count
    });
    const response = sessions.length
      ? `Started ${sessions.length} trivia question${sessions.length === 1 ? '' : 's'} in ${mode === 'private' ? 'this DM' : 'the channel'}.`
      : 'No questions were returned by the backend.';
    await interaction.editReply({ content: response });
  } catch (err) {
    await interaction.editReply({ content: `Could not start trivia: ${err.message}` });
  }
}

async function handleCategoriesCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const categories = await backendClient.fetchCategories();
    if (!Array.isArray(categories) || !categories.length) {
      await interaction.editReply({ content: 'No categories are configured yet.' });
      return;
    }
    const content = categories.map((item) => `- ${item.name}`).join('\n');
    await interaction.editReply({ content });
  } catch (err) {
    await interaction.editReply({ content: `Could not load categories: ${err.message}` });
  }
}

async function handleMakeQuestionCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const categoryName = interaction.options.getString('category', true);
    const text = interaction.options.getString('question', true);
    const correct = interaction.options.getString('correct', true);
    const optionB = interaction.options.getString('b', true);
    const optionC = interaction.options.getString('c');
    const optionD = interaction.options.getString('d');
    const difficulty = interaction.options.getString('difficulty') || 'medium';
    const imageUrl = interaction.options.getString('image_url');
    const hasC = !!String(optionC || '').trim();
    const hasD = !!String(optionD || '').trim();
    if (hasC !== hasD) {
      await interaction.editReply({ content: 'Use either 2 answers or 4 answers. Options C and D must both be filled or both be blank.' });
      return;
    }
    await backendClient.createPendingQuestion({
      categoryName,
      text,
      correct,
      optionB,
      optionC,
      optionD,
      complexity: difficulty,
      submittedBy: `${interaction.user.username} (Discord ${interaction.user.id})`,
      imageUrl
    });
    await interaction.editReply({ content: 'Question suggestion submitted for admin review.' });
  } catch (err) {
    await interaction.editReply({ content: `Could not submit question suggestion: ${err.message}` });
  }
}

async function handleHelpCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let backendStatus = 'ok';
  try {
    await backendClient.fetchCategories();
  } catch (err) {
    backendStatus = `error: ${err.message}`;
  }
  const embed = new EmbedBuilder()
    .setTitle('Open-Trivia Bot Help')
    .setDescription(`Main site: ${config.publicAppUrl}`)
    .addFields(
      {
        name: 'Commands',
        value: [
          '`/trivia` starts one random trivia question.',
          '`/trivia <category> <count>` starts filtered trivia.',
          '`/suggest-question` submits a trivia suggestion for admin approval.',
          '`/categories` lists available categories.',
          '`/leaderboard [category] [timeframe]` shows server and global standings.',
          '`/schedule-trivia list` shows every scheduled job in this server with the correct removal ID.',
          '`/schedule-trivia daily|every|random|comments` creates recurring trivia jobs.',
          '`/schedule-trivia edit <id>` updates an existing scheduled job.',
          '`/schedule-trivia remove <id>` deletes a scheduled job by ID.'
        ].join('\n')
      },
      {
        name: 'How It Works',
        value: [
          'Use `/trivia` in a server channel for shared button-based trivia.',
          'DM the bot or mention it to get a private one-on-one question.',
          'Discord players are created in Open-Trivia automatically on first answer so scores count right away.'
        ].join('\n')
      },
      {
        name: 'Policy Links',
        value: [
          `[Terms of Use](${new URL('/terms', `${config.publicAppUrl}/`).toString()})`,
          `[Privacy Policy](${new URL('/privacy', `${config.publicAppUrl}/`).toString()})`
        ].join('\n')
      },
      {
        name: 'Health',
        value: [
          `Version: \`${botVersion}\``,
          `Heartbeat: \`${new Date().toISOString()}\``,
          `Uptime: \`${formatUptime(Date.now() - startedAt)}\``,
          `Gateway ping: \`${Number.isFinite(client.ws.ping) ? `${Math.round(client.ws.ping)}ms` : 'n/a'}\``,
          `Backend: \`${backendStatus}\``
        ].join('\n')
      }
    );
  await interaction.editReply({ embeds: [embed] });
}

function describeSchedule(schedule) {
  let mode = 'unknown';
  if (schedule.schedule_kind === 'daily') {
    mode = `daily at ${schedule.daily_time}`;
  } else if (schedule.schedule_kind === 'random_interval') {
    const min = Number(schedule.interval_min_minutes || 1);
    const max = Number(schedule.interval_max_minutes || min);
    mode = `random every ${min}-${max} minute(s)`;
  } else if (schedule.schedule_kind === 'comment_range') {
    const min = Number(schedule.comment_min_count || 1);
    const max = Number(schedule.comment_max_count || min);
    const progress = Number(schedule.current_comment_count || 0);
    const target = Number(schedule.next_comment_target || max);
    mode = `after ${min}-${max} comments (${progress}/${target})`;
  } else {
    mode = `every ${schedule.interval_minutes >= 60 && schedule.interval_minutes % 60 === 0
      ? `${schedule.interval_minutes / 60} hour(s)`
      : `${schedule.interval_minutes} minute(s)`}`;
  }
  const categoryLabel = schedule.category_name || 'Any category';
  const lastStatus = String(schedule.last_status || '').trim().toLowerCase();
  const statusLabel = lastStatus === 'failed'
    ? 'last failed'
    : lastStatus === 'success'
      ? 'last succeeded'
      : 'not run yet';
  const nextLabel = schedule.next_run ? ` · next ${new Date(schedule.next_run).toLocaleString()}` : '';
  return `- ID \`${schedule.id}\` · <#${schedule.channel_id}> · ${categoryLabel} · ${mode} · ${schedule.question_count} question(s)${nextLabel} · ${statusLabel}`;
}

function buildSchedulePages({ schedules, selectedChannelId }) {
  const intro = 'Use `/schedule-trivia edit id:<ID> ...` to update a job, `/schedule-trivia remove id:<ID>` to delete one, or `id:ALL` to clear every schedule in this server.';
  const noResults = selectedChannelId
    ? `No schedules configured for <#${selectedChannelId}>.`
    : 'No schedules configured for this server.';
  if (!schedules.length) return [{ content: noResults, page: 1, totalPages: 1 }];

  const lines = schedules.map((item) => describeSchedule(item));
  const pages = [];
  let currentLines = [];
  for (const line of lines) {
    const nextLines = [...currentLines, line];
    const candidate = [intro, ...nextLines].join('\n');
    if (candidate.length > 1800 && currentLines.length) {
      pages.push(currentLines);
      currentLines = [line];
    } else {
      currentLines = nextLines;
    }
  }
  if (currentLines.length) pages.push(currentLines);

  return pages.map((pageLines, index) => ({
    page: index + 1,
    totalPages: pages.length,
    content: [
      intro,
      `Page ${index + 1}/${pages.length}`,
      ...pageLines
    ].join('\n')
  }));
}

function buildSchedulePaginationRow({ guildId, selectedChannelId, page, totalPages }) {
  if (totalPages <= 1) return [];
  const filter = selectedChannelId || 'all';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`schedule-page:${guildId}:${filter}:${page - 1}`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`schedule-page:${guildId}:${filter}:${page + 1}`)
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages)
    )
  ];
}

async function renderScheduleList({ interaction, guildId, selectedChannelId = null, page = 1, useUpdate = false }) {
  const schedules = await backendClient.fetchSchedules({ guildId });
  const filteredSchedules = selectedChannelId
    ? schedules.filter((item) => item.channel_id === selectedChannelId)
    : schedules;
  const pages = buildSchedulePages({ schedules: filteredSchedules, selectedChannelId });
  const safePage = Math.min(Math.max(1, page), pages.length);
  const current = pages[safePage - 1];
  const payload = {
    content: current.content,
    components: buildSchedulePaginationRow({
      guildId,
      selectedChannelId,
      page: current.page,
      totalPages: current.totalPages
    })
  };
  if (useUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.editReply(payload);
  }
}

function formatChannelLabel(channel) {
  const channelId = channel?.id;
  if (channelId) return `<#${channelId}>`;
  const channelName = String(channel?.name || '').trim();
  return channelName || 'that channel';
}

function extractRawChannelId(interaction) {
  const directOption = interaction.options.get('channel');
  if (directOption?.channel?.id) return directOption.channel.id;
  if (directOption?.value) return String(directOption.value);

  const walkOptions = (options) => {
    if (!Array.isArray(options)) return null;
    for (const option of options) {
      if (option?.name === 'channel') {
        if (option.channel?.id) return option.channel.id;
        if (option.value) return String(option.value);
      }
      const nested = walkOptions(option?.options);
      if (nested) return nested;
    }
    return null;
  };

  return walkOptions(interaction.options?.data) || null;
}

function resolveScheduleTarget(interaction) {
  const selectedChannel = interaction.options.getChannel('channel') || interaction.options.get('channel')?.channel || null;
  const rawChannelId = extractRawChannelId(interaction);
  const channelId = selectedChannel?.id || rawChannelId || interaction.channelId || interaction.channel?.id || null;
  return {
    channelId,
    channelLabel: selectedChannel ? formatChannelLabel(selectedChannel) : (channelId ? `<#${channelId}>` : 'this channel')
  };
}

async function handleScheduleCommand(interaction) {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: 'Scheduling is only available inside a server channel.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    try {
      const selectedChannel = interaction.options.getChannel('channel');
      await renderScheduleList({
        interaction,
        guildId: interaction.guildId,
        selectedChannelId: selectedChannel?.id || null
      });
    } catch (err) {
      await interaction.editReply({ content: `Could not load schedules: ${err.message}` });
    }
    return;
  }
  if (subcommand === 'remove') {
    const rawId = String(interaction.options.getString('id', true) || '').trim();
    try {
      if (rawId.toUpperCase() === 'ALL') {
        const schedules = await backendClient.fetchSchedules({ guildId: interaction.guildId });
        if (!schedules.length) {
          await interaction.editReply({ content: 'No schedules are configured for this server.' });
          return;
        }
        await Promise.all(schedules.map((schedule) => backendClient.deleteSchedule(schedule.id, interaction.guildId)));
        await interaction.editReply({ content: `Removed all ${schedules.length} scheduled trivia job${schedules.length === 1 ? '' : 's'} for this server.` });
        return;
      }
      const id = Number.parseInt(rawId, 10);
      if (!Number.isFinite(id)) {
        await interaction.editReply({ content: 'Use a numeric schedule ID from `/schedule-trivia list`, or `ALL`.' });
        return;
      }
      await backendClient.deleteSchedule(id, interaction.guildId);
      await interaction.editReply({ content: `Removed schedule \`${id}\`.` });
    } catch (err) {
      await interaction.editReply({ content: `Could not remove schedule: ${err.message}` });
    }
    return;
  }
  if (subcommand === 'edit') {
    const id = interaction.options.getInteger('id', true);
    const category = interaction.options.getString('category');
    const count = interaction.options.getInteger('count');
    const selectedTarget = resolveScheduleTarget(interaction);
    const time = interaction.options.getString('time');
    const unit = interaction.options.getString('unit');
    const interval = interaction.options.getInteger('interval');
    const minInterval = interaction.options.getInteger('min_interval');
    const maxInterval = interaction.options.getInteger('max_interval');
    const minComments = interaction.options.getInteger('min_comments');
    const maxComments = interaction.options.getInteger('max_comments');
    const updates = { guildId: interaction.guildId };
    if (interaction.options.get('channel') && selectedTarget.channelId) updates.channelId = selectedTarget.channelId;
    if (category) updates.categoryName = category;
    if (count) updates.questionCount = count;
    if (time) {
      updates.scheduleKind = 'daily';
      updates.dailyTime = time;
    } else if (interval !== null) {
      if (!unit) {
        await interaction.editReply({ content: 'Provide `unit` when editing a fixed interval.' });
        return;
      }
      updates.scheduleKind = 'interval';
      updates.intervalMinutes = unit === 'hours' ? interval * 60 : interval;
    } else if (minInterval !== null || maxInterval !== null) {
      if (minInterval === null || maxInterval === null || !unit) {
        await interaction.editReply({ content: 'Provide `unit`, `min_interval`, and `max_interval` together for a random time range.' });
        return;
      }
      updates.scheduleKind = 'random_interval';
      updates.intervalMinMinutes = unit === 'hours' ? minInterval * 60 : minInterval;
      updates.intervalMaxMinutes = unit === 'hours' ? maxInterval * 60 : maxInterval;
    } else if (minComments !== null || maxComments !== null) {
      if (minComments === null || maxComments === null) {
        await interaction.editReply({ content: 'Provide both `min_comments` and `max_comments` for a comment-trigger schedule.' });
        return;
      }
      updates.scheduleKind = 'comment_range';
      updates.commentMinCount = minComments;
      updates.commentMaxCount = maxComments;
    } else if (unit) {
      await interaction.editReply({ content: 'Provide matching interval values with `unit`.' });
      return;
    }
    try {
      const schedule = await backendClient.updateSchedule(id, updates);
      await interaction.editReply({
        content: `Updated schedule \`${schedule.id}\`.\n${describeSchedule(schedule)}`
      });
    } catch (err) {
      await interaction.editReply({ content: `Could not update schedule: ${err.message}` });
    }
    return;
  }

  const selectedChannel = resolveScheduleTarget(interaction);
  if (!selectedChannel.channelId) {
    await interaction.editReply({ content: 'Choose a text channel for scheduled trivia.' });
    return;
  }

  const category = interaction.options.getString('category');
  const count = interaction.options.getInteger('count') || 1;
  let payload = null;
  if (subcommand === 'daily') {
    payload = {
      guildId: interaction.guildId,
      channelId: selectedChannel.channelId,
      category,
      count,
      scheduleKind: 'daily',
      dailyTime: interaction.options.getString('time', true)
    };
  } else if (subcommand === 'every') {
    const unit = interaction.options.getString('unit', true);
    const every = interaction.options.getInteger('interval') ?? interaction.options.getInteger('every', true);
    payload = {
      guildId: interaction.guildId,
      channelId: selectedChannel.channelId,
      category,
      count,
      scheduleKind: 'interval',
      intervalMinutes: unit === 'hours' ? every * 60 : every
    };
  } else if (subcommand === 'random') {
    const unit = interaction.options.getString('unit', true);
    const minInterval = interaction.options.getInteger('min_interval', true);
    const maxInterval = interaction.options.getInteger('max_interval', true);
    payload = {
      guildId: interaction.guildId,
      channelId: selectedChannel.channelId,
      category,
      count,
      scheduleKind: 'random_interval',
      intervalMinMinutes: unit === 'hours' ? minInterval * 60 : minInterval,
      intervalMaxMinutes: unit === 'hours' ? maxInterval * 60 : maxInterval
    };
  } else if (subcommand === 'comments') {
    payload = {
      guildId: interaction.guildId,
      channelId: selectedChannel.channelId,
      category,
      count,
      scheduleKind: 'comment_range',
      commentMinCount: interaction.options.getInteger('min_comments', true),
      commentMaxCount: interaction.options.getInteger('max_comments', true)
    };
  }
  if (!payload) {
    await interaction.editReply({ content: 'Unsupported schedule request.' });
    return;
  }
  try {
    const schedule = await backendClient.createSchedule(payload);
    await interaction.editReply({
      content: `Saved schedule \`${schedule.id}\` for ${selectedChannel.channelLabel}.\n${describeSchedule(schedule)}`
    });
  } catch (err) {
    await interaction.editReply({
      content: `Could not save schedule: ${err.message}`
    });
  }
}

async function handleLeaderboardCommand(interaction) {
  const category = interaction.options.getString('category');
  const timeframe = interaction.options.getString('timeframe') || 'all';
  await interaction.deferReply();
  try {
    const data = await backendClient.fetchLeaderboard({
      guildId: interaction.guildId,
      category,
      timeframe
    });
    await interaction.editReply({
      embeds: [
        leaderboardEmbed(data.server, `Server Leaderboard${category ? ` · ${category}` : ''}`),
        leaderboardEmbed(data.global, `Global Leaderboard${category ? ` · ${category}` : ''}`)
      ]
    });
  } catch (err) {
    await interaction.editReply({ content: `Could not load leaderboard: ${err.message}` });
  }
}

async function handlePromptedMessage(message) {
  if (message.author.bot) return;
  const channel = message.channel || await client.channels.fetch(message.channelId).catch(() => null);
  if (!channel) return;
  if (message.guildId && message.channelId) {
    try {
      const dueSchedules = await backendClient.recordChannelComment({
        guildId: message.guildId,
        channelId: message.channelId
      });
      for (const schedule of dueSchedules) {
        await scheduler.runSchedule(schedule);
      }
    } catch (err) {
      console.error('Failed to process comment-trigger schedules', err);
    }
  }
  const isDm = channel?.isDMBased?.();
  const mentioned = message.mentions?.users?.has?.(client.user.id);
  if (!isDm && !mentioned) return;
  const category = String(message.content || '')
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim() || null;
  try {
    await sessionManager.createSession({
      client,
      channel,
      mode: 'private',
      ownerDiscordUserId: message.author.id,
      guildId: message.guildId,
      category,
      count: 1
    });
  } catch (err) {
    await message.reply(`Could not start trivia: ${err.message}`);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Discord bot ready as ${readyClient.user.tag}`);
  readyClient.user.setActivity('Open-Trivia', { type: ActivityType.Playing });
  sessionManager.restore(readyClient);
  scheduler.start();
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const [prefix, guildId, filter, rawPage] = String(interaction.customId || '').split(':');
    if (prefix === 'schedule-page') {
      try {
        await renderScheduleList({
          interaction,
          guildId,
          selectedChannelId: filter && filter !== 'all' ? filter : null,
          page: Number.parseInt(rawPage, 10) || 1,
          useUpdate: true
        });
      } catch (err) {
        await interaction.update({ content: `Could not load schedules: ${err.message}`, components: [] });
      }
      return;
    }
    const handled = await sessionManager.handleButtonInteraction(client, interaction);
    if (handled) return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'trivia') {
    await handleOtCommand(interaction);
    return;
  }
  if (interaction.commandName === 'leaderboard') {
    await handleLeaderboardCommand(interaction);
    return;
  }
  if (interaction.commandName === 'categories') {
    await handleCategoriesCommand(interaction);
    return;
  }
  if (interaction.commandName === 'suggest-question') {
    await handleMakeQuestionCommand(interaction);
    return;
  }
  if (interaction.commandName === 'help') {
    await handleHelpCommand(interaction);
    return;
  }
  if (interaction.commandName === 'schedule-trivia') {
    await handleScheduleCommand(interaction);
  }
});

client.on(Events.MessageCreate, handlePromptedMessage);

await registerCommands();
await client.login(config.discordToken);
