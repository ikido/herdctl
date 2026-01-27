# Multi-Agent Fleet Example

This example demonstrates running multiple agents in a single fleet, each with its own Discord bot for chat interactions.

## What's Included

This fleet combines two agents with Discord chat:
- **hurricane-watcher** - Monitors Atlantic hurricane activity (2h intervals)
- **price-checker** - Monitors office chair prices (1h intervals)

Both agents have their own Discord bot but operate in the same channel. Users can @mention either bot to chat with the respective agent about their domain.

## Key Concept: Multiple Bots, Same Channel

Each agent has its own Discord bot token, allowing them to:
- Maintain separate conversation contexts
- Respond to their own @mentions
- Have distinct bot identities (names, avatars)

```yaml
agents:
  - path: ../hurricane-watcher/agents/hurricane-watcher.yaml
    overrides:
      schedules:
        check:
          interval: 2h
      chat:
        discord:
          bot_token_env: HURRICANE_DISCORD_BOT_TOKEN  # Separate bot
          guilds:
            - id: "${DISCORD_GUILD_ID}"
              channels:
                - id: "${DISCORD_CHANNEL_ID}"
                  mode: mention

  - path: ../price-checker/agents/price-checker.yaml
    overrides:
      schedules:
        check:
          interval: 1h
      chat:
        discord:
          bot_token_env: PRICE_DISCORD_BOT_TOKEN  # Different bot
          guilds:
            - id: "${DISCORD_GUILD_ID}"      # Same guild
              channels:
                - id: "${DISCORD_CHANNEL_ID}"  # Same channel
                  mode: mention
```

## Setup

1. **Create two Discord applications** at [discord.com/developers](https://discord.com/developers/applications)
2. **Add a bot** to each application
3. **Enable "Message Content Intent"** for both bots
4. **Invite both bots** to your server with permissions: Send Messages, Read Message History, Use Slash Commands
5. **Copy `.env.example` to `.env`** and fill in your values

## Overrides Pattern

This example also demonstrates the `overrides` feature:
- Reuse existing agent definitions without modification
- Customize schedules, chat config, hooks, permissions per-fleet
- Override any agent field - values are deep-merged
- Arrays (like hooks) are replaced entirely

## Running

```bash
cd examples/multi-agent

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Discord bot token (optional, for notifications)

# Start the fleet
herdctl start

# Check status
herdctl status

# Manually trigger an agent
herdctl trigger hurricane-watcher
herdctl trigger price-checker
```

## Notes

- Each agent maintains its own `context.md` in its original directory
- The price-checker requires Discord environment variables for notifications
- The hurricane-watcher has Discord hooks commented out by default
