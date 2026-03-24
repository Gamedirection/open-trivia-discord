import fs from 'node:fs';

function emptyState() {
  return {
    schedules: [],
    sessions: [],
    guildSettings: {}
  };
}

export class RuntimeStore {
  constructor(storagePath) {
    this.storagePath = storagePath;
    this.state = emptyState();
  }

  load() {
    if (!fs.existsSync(this.storagePath)) {
      this.persist();
      return this.state;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      this.state = {
        schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        guildSettings: parsed.guildSettings && typeof parsed.guildSettings === 'object' ? parsed.guildSettings : {}
      };
    } catch {
      this.state = emptyState();
    }
    return this.state;
  }

  persist() {
    fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2));
  }

  getSchedules() {
    return [...this.state.schedules];
  }

  upsertSchedule(schedule) {
    const idx = this.state.schedules.findIndex((item) => item.id === schedule.id);
    if (idx >= 0) this.state.schedules[idx] = schedule;
    else this.state.schedules.push(schedule);
    this.persist();
  }

  removeSchedule(scheduleId) {
    this.state.schedules = this.state.schedules.filter((item) => item.id !== scheduleId);
    this.persist();
  }

  getSessions() {
    return [...this.state.sessions];
  }

  saveSession(session) {
    const idx = this.state.sessions.findIndex((item) => item.id === session.id);
    if (idx >= 0) this.state.sessions[idx] = session;
    else this.state.sessions.push(session);
    this.persist();
  }

  removeSession(sessionId) {
    this.state.sessions = this.state.sessions.filter((item) => item.id !== sessionId);
    this.persist();
  }
}
