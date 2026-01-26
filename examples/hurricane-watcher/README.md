# Hurricane Watcher Example

This example demonstrates a scheduled agent that monitors hurricane activity and sends notifications via hooks.

## Features

- Scheduled checks every 6 hours
- Uses WebSearch and WebFetch to get real-time hurricane data
- Configurable notification hooks (shell, Discord, webhook)

## Quick Start

```bash
# From the repo root
cd examples/hurricane-watcher

# Trigger manually (for testing)
herdctl trigger hurricane-watcher --prompt "Check for hurricane activity affecting Miami, FL"

# Or start the fleet to run on schedule
herdctl start
```

## Notification Hooks

The agent is configured with hooks that run after each job. Edit `agents/hurricane-watcher.yaml` to configure:

### Shell Hook (enabled by default)

Logs notifications to `/tmp/hurricane-notifications.log`:

```yaml
hooks:
  after_run:
    - type: shell
      command: "tee -a /tmp/hurricane-notifications.log"
```

### Discord Hook

To enable Discord notifications:

1. Create a Discord bot at https://discord.com/developers/applications
2. Add the bot to your server with "Send Messages" permission
3. Get the channel ID (right-click channel → Copy ID, with Developer Mode enabled)
4. Set environment variables:
   ```bash
   export DISCORD_BOT_TOKEN="your-bot-token"
   export DISCORD_CHANNEL_ID="your-channel-id"
   ```
5. Uncomment the Discord hook in the agent config

### Webhook Hook

To POST notifications to a URL:

1. Set up your webhook endpoint
2. Uncomment and configure the webhook hook in the agent config
3. Set any required auth tokens as environment variables

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Required for running agents |
| `DISCORD_BOT_TOKEN` | Discord bot token (for Discord notifications) |
| `DISCORD_CHANNEL_ID` | Discord channel ID (for Discord notifications) |
| `WEBHOOK_TOKEN` | Auth token for webhook endpoint (if needed) |
