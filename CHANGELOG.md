# Changelog

## v0.1.6 - 2026-03-26

- Fixed `/schedule-trivia remove` so schedule deletion no longer fails channel validation.
- Fixed scheduled channel resolution for slash-command channel selections when creating recurring trivia.
- Added Discord-specific fixed scoring values by difficulty, now defaulting to Easy `+5`, Medium `+10`, and Hard `+15`.
- Updated correct-answer responses to include the difficulty and awarded points.

## v0.1.4 - 2026-03-26

- Replaced `/ot` with `/trivia`.
- Replaced `/otschedule` with `/schedule-trivia`.
- Changed schedule deletion to use `/schedule-trivia remove <id>`.
- Improved `/schedule-trivia list` so it shows all schedules in the current server with channel, category, and the correct removal ID.
- Added Terms of Use and Privacy Policy links to `/help`.

## v0.1.3 - 2026-03-25

- Changed the default trivia timeout to 24 hours.
- Deletes expired trivia messages from Discord when a question times out.
- Shows the correct answer privately when a user answers incorrectly.
- Auto-creates Open-Trivia users for Discord players on first answer so scores still count.

## v0.1.2 - 2026-03-24

- Added optional `channel` targeting to `/otschedule list`, `/otschedule daily`, and `/otschedule every`.
- Kept optional schedule `category` support and documented category-plus-channel scheduling behavior.
- Hid blank answer slots so bot trivia messages only render real answer buttons.

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
