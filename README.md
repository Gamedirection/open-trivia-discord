# open-trivia-discord

Discord bot service for Open-Trivia. This service is designed to live as its own deployment and call the main Open-Trivia backend over HTTP using a bot API token.

## Features

- Registers `/ot`, `/leaderboard`, and `/otschedule` slash commands on startup.
- Supports private DM trivia and public channel trivia with answer buttons.
- Tracks per-question guesses and updates the message with the current guess count.
- Polls backend-managed per-guild/channel schedules for:
  - daily trivia at a configured time
  - every X minutes
  - every X hours
- Calls the main Open-Trivia backend for:
  - question retrieval
  - answer submission and scoring
  - server + global leaderboard lookup

## Required backend endpoints

The bot expects the main backend to provide:

- `POST /bot/trivia/questions`
- `POST /bot/trivia/sessions/:id/answer`
- `POST /bot/trivia/sessions/:id/close`
- `GET /bot/leaderboard`
- `GET /bot/categories`
- `GET /bot/schedules`
- `POST /bot/schedules`
- `DELETE /bot/schedules/:id`
- `POST /bot/schedules/:id/mark-run`

All bot requests use:

```text
Authorization: Bearer <BOT_API_TOKEN>
```

## Environment

Copy `.env.example` and set:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `BOT_API_BASE_URL`
- `BOT_API_TOKEN`
- `BOT_PUBLIC_APP_URL`

Optional:

- `BOT_STORAGE_PATH`
- `BOT_SCHEDULE_POLL_MS`
- `BOT_QUESTION_TIMEOUT_SECONDS`

## Runtime state

The bot stores active in-flight trivia sessions in `BOT_STORAGE_PATH`. Recurring schedules are persisted in the main Open-Trivia backend so they survive bot container restarts.

## Commands

### `/ot`

Starts one or more trivia questions.

Options:

- `category` optional category name
- `count` optional question count, defaults to `1`

Behavior:

- In DMs, only the requesting user can answer.
- In guild channels, anyone in the channel can answer once.

### `/leaderboard`

Shows both the current server leaderboard and the global leaderboard.

Options:

- `category` optional category name
- `timeframe` optional one of `today`, `this month`, `this year`, `all time`

### `/otschedule`

Manage recurring trivia in the current guild channel.

Subcommands:

- `list`
- `daily <HH:MM> [category] [count]`
- `every <minutes|hours> <every> [category] [count]`
- `disable <id>`

## Run locally

```bash
npm install
npm start
```

## Docker

```bash
docker build -t open-trivia-discord .
docker run --env-file .env open-trivia-discord
```
