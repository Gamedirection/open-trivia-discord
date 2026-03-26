<img width="1325" height="380" alt="image" src="https://github.com/Gamedirection/Open-Trivia/blob/main/img/open-trivia-logo_OT-Logo%2BMark.svg" />


# open-trivia-discord

Discord bot service for Open-Trivia. This service is designed to live as its own deployment and call the main Open-Trivia backend over HTTP using a bot API token.

See [CHANGELOG.md](./CHANGELOG.md) for bot release history.

## Features

- Registers `/trivia`, `/categories`, `/leaderboard`, `/help`, `/schedule-trivia`, and `/suggest-question` slash commands on startup.
- Supports private DM trivia and public channel trivia with answer buttons.
- Supports `/help` usage guidance with site link, version, uptime, gateway ping, and backend reachability.
- Supports `/suggest-question` so Discord users can submit admin-review question suggestions.
- Hides blank answer slots so True/False style questions only render the real buttons.
- Removes `A/B/C/D` prefixes from Discord answer buttons so buttons show only answer text.
- Defaults trivia sessions to a 24 hour timeout, then deletes the expired Discord message.
- Shows incorrect answers privately with the correct answer text.
- Auto-creates Open-Trivia users for Discord players on first answer so Discord-only play still scores.
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
- `POST /bot/pending-questions`
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

Typical production values:

- `BOT_API_BASE_URL=https://trivia.gamedirection.net/api`
- `BOT_PUBLIC_APP_URL=https://trivia.gamedirection.net`
- `BOT_QUESTION_TIMEOUT_SECONDS=86400`

## Runtime state

The bot stores active in-flight trivia sessions in `BOT_STORAGE_PATH`. Recurring schedules are persisted in the main Open-Trivia backend so they survive bot container restarts.

## Commands

### `/trivia`

Starts one or more trivia questions.

Options:

- `category` optional category name
- `count` optional question count, defaults to `1`

Behavior:

- With no arguments, `/trivia` starts one random trivia question.
- In DMs, only the requesting user can answer.
- In guild channels, anyone in the channel can answer once.
- Incorrect answers get a private reply with the correct answer.
- Discord-only players are created in Open-Trivia automatically on first answer.
- Expired questions are removed from Discord when their timeout is reached.

### `/categories`

Lists the available Open-Trivia categories from the backend.

### `/leaderboard`

Shows both the current server leaderboard and the global leaderboard.

Options:

- `category` optional category name
- `timeframe` optional one of `today`, `this month`, `this year`, `all time`

### `/schedule-trivia`

Manage recurring trivia in the current guild channel.

Subcommands:

- `list [channel]`
- `daily <HH:MM> [channel] [category] [count]`
- `every <minutes|hours> <every> [channel] [category] [count]`
- `remove <id>`

### `/suggest-question`

Submits a question suggestion to the main Open-Trivia review queue.

Options:

- `category` required category name
- `question` required question text
- `correct` required correct answer text, stored as option `A`
- `b` required option `B`
- `c` optional option `C`
- `d` optional option `D`
- `difficulty` optional `easy|medium|hard`, defaults to `medium`
- `image_url` optional image URL

Question suggestions support either 2 answers or 4 answers. If you use `C`, you must also use `D`.

### `/help`

Shows:

- a link back to the main Open-Trivia site
- command usage guidance
- bot version
- current heartbeat timestamp
- uptime and gateway ping
- backend health probe result

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

## Docker Compose

The bot can also run as its own Compose project from this folder.

1. Create a local env file:

```bash
cp .env.example .env
```

2. Fill in the required Discord and Open-Trivia settings in `.env`.

3. Start the bot:

```bash
docker compose up -d --build
```

4. Inspect logs:

```bash
docker compose logs -f
```

The included [docker-compose.yml](./docker-compose.yml) starts a single `discord-bot` service and persists the local runtime state file in a named Docker volume mounted at `/tmp`.

On Linux, the Compose file also maps `host.docker.internal` to Docker's host gateway so the bot can reach a locally running Open-Trivia backend such as `http://host.docker.internal:3001`.

## Docker Swarm

The bot repo also includes a Swarm stack file at [docker-swarm.yaml](./docker-swarm.yaml).

1. Create a local env file:

```bash
cp .env.example .env
```

2. Fill in the required Discord and Open-Trivia settings in `.env`.

3. Deploy the stack:

```bash
docker stack deploy -c docker-swarm.yaml open-trivia-discord
```

4. Inspect service state:

```bash
docker stack services open-trivia-discord
docker service logs -f open-trivia-discord_discord-bot
```
