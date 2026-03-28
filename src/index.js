import {
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
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
const botVersion = process.env.npm_package_version || '0.1.0';

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
  await interaction.deferReply({ ephemeral: mode === 'private' });
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
  await interaction.deferReply({ ephemeral: true });
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
  await interaction.deferReply({ ephemeral: true });
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
  await interaction.deferReply({ ephemeral: true });
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
          '`/schedule-trivia daily|every` creates recurring trivia jobs.',
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
  const mode = schedule.schedule_kind === 'daily'
    ? `daily at ${schedule.daily_time}`
    : `every ${schedule.interval_minutes >= 60 && schedule.interval_minutes % 60 === 0
      ? `${schedule.interval_minutes / 60} hour(s)`
      : `${schedule.interval_minutes} minute(s)`}`;
  const categoryLabel = schedule.category_name || 'Any category';
  return `- ID \`${schedule.id}\` · <#${schedule.channel_id}> · ${categoryLabel} · ${mode} · ${schedule.question_count} question(s)${schedule.next_run ? ` · next ${new Date(schedule.next_run).toLocaleString()}` : ''}`;
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
    await interaction.reply({ content: 'Scheduling is only available inside a server channel.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    try {
      const selectedChannel = interaction.options.getChannel('channel');
      const schedules = await backendClient.fetchSchedules({ guildId: interaction.guildId });
      const filteredSchedules = selectedChannel
        ? schedules.filter((item) => item.channel_id === selectedChannel.id)
        : schedules;
      const content = filteredSchedules.length
        ? [
          'Use `/schedule-trivia remove id:<ID>` to delete one of these schedules.',
          ...filteredSchedules.map((item) => describeSchedule(item))
        ].join('\n')
        : selectedChannel
          ? `No schedules configured for ${formatChannelLabel(selectedChannel)}.`
          : 'No schedules configured for this server.';
      await interaction.editReply({ content });
    } catch (err) {
      await interaction.editReply({ content: `Could not load schedules: ${err.message}` });
    }
    return;
  }
  if (subcommand === 'remove') {
    const id = interaction.options.getInteger('id', true);
    try {
      await backendClient.deleteSchedule(id, interaction.guildId);
      await interaction.editReply({ content: `Removed schedule \`${id}\`.` });
    } catch (err) {
      await interaction.editReply({ content: `Could not remove schedule: ${err.message}` });
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

client.once('ready', async (readyClient) => {
  console.log(`Discord bot ready as ${readyClient.user.tag}`);
  readyClient.user.setActivity('Open-Trivia', { type: ActivityType.Playing });
  sessionManager.restore(readyClient);
  scheduler.start();
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
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
