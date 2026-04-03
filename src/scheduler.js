function randomInt(min, max) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function computeNextRun(schedule, from = new Date()) {
  const now = new Date(from);
  const scheduleKind = schedule.schedule_kind || schedule.scheduleKind || schedule.mode;
  if (scheduleKind === 'daily') {
    const dailyTime = schedule.daily_time || schedule.dailyTime || schedule.at || '12:00';
    const [hour, minute] = String(dailyTime).split(':').map((part) => Number(part) || 0);
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  if (scheduleKind === 'random_interval') {
    const minMinutes = Math.max(1, Number(schedule.interval_min_minutes || schedule.intervalMinMinutes || 1));
    const maxMinutes = Math.max(minMinutes, Number(schedule.interval_max_minutes || schedule.intervalMaxMinutes || minMinutes));
    return new Date(now.getTime() + randomInt(minMinutes, maxMinutes) * 60 * 1000).toISOString();
  }
  if (scheduleKind === 'comment_range') {
    return null;
  }
  const intervalMinutes = Math.max(1, Number(
    schedule.interval_minutes
      || schedule.intervalMinutes
      || (schedule.mode === 'hours' ? Number(schedule.every || 1) * 60 : schedule.every || 1)
  ));
  return new Date(now.getTime() + intervalMinutes * 60 * 1000).toISOString();
}

export class Scheduler {
  constructor({ backendClient, sessionManager, client, pollMs }) {
    this.backendClient = backendClient;
    this.sessionManager = sessionManager;
    this.client = client;
    this.pollMs = pollMs;
    this.interval = null;
    this.lastAuthErrorAt = 0;
  }

  start() {
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        if (String(err?.message || '').includes('Bot authentication required')) {
          const now = Date.now();
          if (now - this.lastAuthErrorAt < 60000) return;
          this.lastAuthErrorAt = now;
        }
        console.error('Scheduler tick failed', err);
      });
    }, this.pollMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  async tick() {
    const schedules = await this.backendClient.fetchSchedules({ dueOnly: true });
    for (const schedule of schedules) {
      await this.runSchedule(schedule);
    }
  }

  async runSchedule(schedule) {
    try {
      const channel = await this.resolveScheduleChannel(schedule);
      if (!channel) return;
      await this.sessionManager.createSession({
        client: this.client,
        channel,
        mode: 'public',
        ownerDiscordUserId: null,
        guildId: schedule.guild_id,
        category: schedule.category_name || null,
        count: Number(schedule.question_count || 1)
      });
      await this.backendClient.markScheduleRun(schedule.id, { status: 'success' });
    } catch (err) {
      await this.handleScheduleError(schedule, err);
    }
  }

  async resolveScheduleChannel(schedule) {
    let channel = await this.client.channels.fetch(schedule.channel_id).catch(() => null);
    if (!channel && schedule.guild_id) {
      const guild = await this.client.guilds.fetch(schedule.guild_id).catch(() => null);
      channel = await guild?.channels?.fetch?.(schedule.channel_id).catch(() => null);
    }
    if (!channel?.isTextBased?.() || channel?.isDMBased?.()) {
      console.warn(`Skipping schedule ${schedule.id}: target channel ${schedule.channel_id} is unavailable or not text-based.`);
      await this.disableSchedule(schedule, 'channel is unavailable, private, or not text-based');
      return null;
    }
    if (schedule.guild_id && channel.guildId && String(channel.guildId) !== String(schedule.guild_id)) {
      console.warn(`Skipping schedule ${schedule.id}: channel ${schedule.channel_id} belongs to guild ${channel.guildId}, expected ${schedule.guild_id}.`);
      await this.disableSchedule(schedule, 'channel belongs to a different server');
      return null;
    }
    if (typeof channel.isSendable === 'function' && !channel.isSendable()) {
      console.warn(`Skipping schedule ${schedule.id}: bot cannot send messages to ${schedule.channel_id}.`);
      await this.disableSchedule(schedule, 'bot cannot send messages to the scheduled channel');
      return null;
    }
    return channel;
  }

  async disableSchedule(schedule, reason) {
    try {
      await this.backendClient.markScheduleRun(schedule.id, { status: 'failed', error: reason });
      await this.backendClient.updateSchedule(schedule.id, { enabled: false });
      console.warn(`Disabled schedule ${schedule.id}: ${reason}.`);
    } catch (err) {
      console.error(`Failed to disable schedule ${schedule.id} after ${reason}`, err);
    }
  }

  async handleScheduleError(schedule, err) {
    const code = Number(err?.code || err?.rawError?.code || 0);
    const message = String(err?.message || err?.rawError?.message || err || '');
    if (code === 50001 || code === 50013 || /Missing Access|Missing Permissions/i.test(message)) {
      console.warn(`Disabling schedule ${schedule.id}: Discord denied access to channel ${schedule.channel_id}.`);
      await this.disableSchedule(schedule, 'Discord denied access to the channel');
      return;
    }
    await this.backendClient.markScheduleRun(schedule.id, { status: 'failed', error: message.slice(0, 500) }).catch(() => {});
    throw err;
  }
}

export { computeNextRun };
Scheduler.computeNextRun = computeNextRun;
