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
      const channel = await this.resolveScheduleChannel(schedule);
      if (!channel) continue;
      await this.sessionManager.createSession({
        client: this.client,
        channel,
        mode: 'public',
        ownerDiscordUserId: null,
        guildId: schedule.guild_id,
        category: schedule.category_name || null,
        count: Number(schedule.question_count || 1)
      });
      await this.backendClient.markScheduleRun(schedule.id);
    }
  }

  async resolveScheduleChannel(schedule) {
    let channel = await this.client.channels.fetch(schedule.channel_id).catch(() => null);
    if (!channel && schedule.guild_id) {
      const guild = await this.client.guilds.fetch(schedule.guild_id).catch(() => null);
      channel = await guild?.channels?.fetch?.(schedule.channel_id).catch(() => null);
    }
    if (!channel?.isTextBased?.()) {
      console.warn(`Skipping schedule ${schedule.id}: target channel ${schedule.channel_id} is unavailable or not text-based.`);
      return null;
    }
    return channel;
  }
}

export { computeNextRun };
Scheduler.computeNextRun = computeNextRun;
