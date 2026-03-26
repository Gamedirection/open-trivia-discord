import { ChannelType, SlashCommandBuilder } from 'discord.js';

export const leaderboardTimeframes = [
  { name: 'today', value: 'day' },
  { name: 'this month', value: 'month' },
  { name: 'this year', value: 'year' },
  { name: 'all time', value: 'all' }
];

export function buildCommandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName('trivia')
      .setDescription('Spawn Open-Trivia questions in this channel or DM.')
      .addStringOption((option) =>
        option
          .setName('category')
          .setDescription('Category name to filter questions')
          .setRequired(false))
      .addIntegerOption((option) =>
        option
          .setName('count')
          .setDescription('Number of questions to ask')
          .setMinValue(1)
          .setMaxValue(25)
          .setRequired(false)),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show the current server and global Open-Trivia leaderboards.')
      .addStringOption((option) =>
        option
          .setName('category')
          .setDescription('Category name to filter leaderboard results')
          .setRequired(false))
      .addStringOption((option) => {
        const configured = option
          .setName('timeframe')
          .setDescription('Leaderboard timeframe')
          .setRequired(false);
        leaderboardTimeframes.forEach((choice) => configured.addChoices(choice));
        return configured;
      }),
    new SlashCommandBuilder()
      .setName('categories')
      .setDescription('List available Open-Trivia categories.'),
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show bot usage, version, and health information.'),
    new SlashCommandBuilder()
      .setName('suggest-question')
      .setDescription('Submit a trivia question suggestion for admin review.')
      .addStringOption((option) =>
        option.setName('category').setDescription('Category name for the question').setRequired(true))
      .addStringOption((option) =>
        option.setName('question').setDescription('The question text').setRequired(true))
      .addStringOption((option) =>
        option.setName('correct').setDescription('The correct answer text (stored as option A)').setRequired(true))
      .addStringOption((option) =>
        option.setName('b').setDescription('Option B text').setRequired(true))
      .addStringOption((option) =>
        option.setName('c').setDescription('Optional option C text').setRequired(false))
      .addStringOption((option) =>
        option.setName('d').setDescription('Optional option D text').setRequired(false))
      .addStringOption((option) =>
        option
          .setName('difficulty')
          .setDescription('Question difficulty')
          .setRequired(false)
          .addChoices(
            { name: 'easy', value: 'easy' },
            { name: 'medium', value: 'medium' },
            { name: 'hard', value: 'hard' }
          ))
      .addStringOption((option) =>
        option.setName('image_url').setDescription('Optional image URL').setRequired(false)),
    new SlashCommandBuilder()
      .setName('schedule-trivia')
      .setDescription('Manage recurring Open-Trivia questions for this server.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('list')
          .setDescription('List schedules configured for this server')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Optional channel to filter schedules for')
              .setRequired(false)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('daily')
          .setDescription('Post daily trivia in a selected channel')
          .addStringOption((option) =>
            option.setName('time').setDescription('HH:MM, 24-hour clock').setRequired(true))
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Channel where the bot should post')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(false))
          .addStringOption((option) =>
            option.setName('category').setDescription('Optional category filter').setRequired(false))
          .addIntegerOption((option) =>
            option.setName('count').setDescription('Number of questions each run').setMinValue(1).setMaxValue(20).setRequired(false)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('every')
          .setDescription('Post trivia every X minutes or hours in a selected channel')
          .addStringOption((option) =>
            option
              .setName('unit')
              .setDescription('Time unit')
              .setRequired(true)
              .addChoices(
                { name: 'minutes', value: 'minutes' },
                { name: 'hours', value: 'hours' }
              ))
          .addIntegerOption((option) =>
            option.setName('interval').setDescription('How often to post').setMinValue(1).setMaxValue(1440).setRequired(true))
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Channel where the bot should post')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(false))
          .addStringOption((option) =>
            option.setName('category').setDescription('Optional category filter').setRequired(false))
          .addIntegerOption((option) =>
            option.setName('count').setDescription('Number of questions each run').setMinValue(1).setMaxValue(20).setRequired(false)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('remove')
          .setDescription('Remove a schedule by ID')
          .addIntegerOption((option) =>
            option.setName('id').setDescription('Schedule ID from /schedule-trivia list').setRequired(true)))
  ].map((command) => command.toJSON());
}
