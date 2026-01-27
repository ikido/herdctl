---
"@herdctl/core": minor
---

Add DiscordHookRunner for Discord channel notifications

- Implement DiscordHookRunner that posts job notifications to Discord channels
- Uses Discord embeds with appropriate colors (green for success, red for failure, amber for timeout, gray for cancelled)
- Bot token read from environment variable (configurable via bot_token_env)
- Output truncated to max 1000 chars in embed
- Supports filtering notifications by event type via on_events
- Human-readable duration formatting (ms, seconds, minutes, hours)
- Includes agent name, job ID, schedule, duration, and error details in embed
