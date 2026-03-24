function buildUrl(baseUrl, pathname, params = {}) {
  const url = new URL(pathname, `${baseUrl}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

export class BackendClient {
  constructor({ baseUrl, token, publicAppUrl }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.publicAppUrl = publicAppUrl;
  }

  async request(pathname, { method = 'GET', params, body } = {}) {
    const response = await fetch(buildUrl(this.baseUrl, pathname, params), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || data.message || `Backend request failed (${response.status})`;
      throw new Error(message);
    }
    return data;
  }

  async fetchQuestions({ category, count = 1, guildId, channelId, mode }) {
    return this.request('/bot/trivia/questions', {
      method: 'POST',
      body: {
        categoryName: category,
        count,
        guildId,
        channelId,
        mode
      }
    });
  }

  async submitAnswer({ sessionId, discordUserId, discordUsername, answer }) {
    return this.request(`/bot/trivia/sessions/${sessionId}/answer`, {
      method: 'POST',
      body: {
        discordUserId,
        discordUsername,
        selectedAnswer: answer
      }
    });
  }

  async closeSession(sessionId) {
    return this.request(`/bot/trivia/sessions/${sessionId}/close`, {
      method: 'POST'
    });
  }

  async fetchLeaderboard({ guildId, category, timeframe = 'all' }) {
    return this.request('/bot/leaderboard', {
      params: { guildId, categoryName: category, timeframe }
    });
  }

  async fetchSchedules({ guildId, dueOnly = false } = {}) {
    return this.request('/bot/schedules', {
      params: {
        guildId,
        dueOnly: dueOnly ? 1 : undefined
      }
    });
  }

  async fetchCategories() {
    return this.request('/bot/categories');
  }

  async createSchedule({ guildId, channelId, category, count = 1, scheduleKind, intervalMinutes, dailyTime }) {
    return this.request('/bot/schedules', {
      method: 'POST',
      body: {
        guildId,
        channelId,
        categoryName: category,
        questionCount: count,
        scheduleKind,
        intervalMinutes,
        dailyTime
      }
    });
  }

  async updateSchedule(id, updates) {
    return this.request(`/bot/schedules/${id}`, {
      method: 'PATCH',
      body: updates
    });
  }

  async deleteSchedule(id) {
    return this.request(`/bot/schedules/${id}`, {
      method: 'DELETE'
    });
  }

  async markScheduleRun(id) {
    return this.request(`/bot/schedules/${id}/mark-run`, {
      method: 'POST'
    });
  }

  buildLinkAccountUrl() {
    const url = new URL('/api/auth/discord/start', `${this.publicAppUrl}/`);
    url.searchParams.set('target', '/');
    return url.toString();
  }
}
