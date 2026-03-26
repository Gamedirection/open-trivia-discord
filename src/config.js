import path from 'node:path';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberFromEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
  return {
    discordToken: required('DISCORD_TOKEN'),
    discordClientId: required('DISCORD_CLIENT_ID'),
    apiBaseUrl: String(process.env.BOT_API_BASE_URL || 'http://backend:5000').trim().replace(/\/+$/, ''),
    apiToken: required('BOT_API_TOKEN'),
    publicAppUrl: String(process.env.BOT_PUBLIC_APP_URL || 'http://localhost:3000').trim().replace(/\/+$/, ''),
    storagePath: path.resolve(process.env.BOT_STORAGE_PATH || '/tmp/open-trivia-discord-state.json'),
    schedulePollMs: Math.max(5000, numberFromEnv('BOT_SCHEDULE_POLL_MS', 15000)),
    questionTimeoutSeconds: Math.max(15, numberFromEnv('BOT_QUESTION_TIMEOUT_SECONDS', 86400))
  };
}
