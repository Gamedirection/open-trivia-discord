# Changelog

## v0.1.1 - 2026-03-24

- Added `/categories` to list available trivia categories from the backend.
- Added `/help` with usage guidance, site link, version, uptime, ping, and backend health status.
- Fixed `/ot` so slash commands without arguments start a single random question cleanly.
- Fixed slash-command delivery so the first trivia question is posted through the interaction flow instead of being overwritten.
- Improved guild slash-command channel handling to avoid null-channel failures.
- Throttled repeated scheduler auth errors to reduce noisy logs during bad bot-token configuration.

## v0.1.0 - 2026-03-24

- Added the initial Discord bot service for Open-Trivia.
- Added slash commands for `/ot`, `/leaderboard`, and `/otschedule`.
- Added DM and mention-based private trivia sessions.
- Added public channel trivia with button answers and live guess counts.
- Added backend-linked scoring through Discord account matching.
- Added guild schedule polling backed by Open-Trivia bot APIs.
- Added Docker packaging and standalone Docker Compose support.
