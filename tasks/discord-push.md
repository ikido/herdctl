# Discord Push Notifications

## Overview

Add the ability for herdctl agents to **push notifications to Discord channels** when scheduled jobs complete. This enables use cases like a "Hurricane Watcher" agent that runs every 6 hours and posts status reports to a Discord channel.

## Current State

### What Exists Today

The Discord integration (`packages/discord/`) is **inbound-only** - it's a chat interface where:

1. User sends message in Discord channel or DM
2. DiscordConnector detects it (based on channel/guild config)
3. Agent processes the message and replies

**Current capabilities:**
- Per-agent Discord bots (each agent can have its own bot token)
- Channel configuration with `mention` vs `auto` modes
- DM support with allowlist/blocklist
- Slash commands (`/help`, `/reset`, `/status`)
- Session/conversation context tracking
- Message splitting for long responses

**Current agent config structure:**
```yaml
chat:
  discord:
    bot_token_env: MY_DISCORD_TOKEN
    guilds:
      - id: "guild-id"
        channels:
          - id: "channel-id"
            mode: mention  # or auto
```

### What's Missing

There is **no mechanism** for:
- Agents to send unsolicited messages to Discord
- Scheduled jobs to post results to Discord channels
- Notifications when jobs complete or fail
- Outbound messaging independent of a conversation

**Key gaps:**
1. `DiscordConnector` has no `sendToChannel()` or similar outbound method
2. No schema support for "notification channel" config
3. No bridge between FleetManager job events and Discord
4. No message formatting utilities for notifications (embeds, etc.)

## Desired End State

### Use Case: Hurricane Watcher Example

A user should be able to create a hurricane watcher agent that:
1. Runs on a schedule (e.g., every 6 hours)
2. Checks for hurricane activity affecting a configured location
3. Posts a status report to a Discord channel
4. (Future: Only posts if there's actually a threat)

**Example directory structure:**
```
examples/hurricane-watcher/
├── herdctl.yaml
├── agents/
│   └── hurricane-watcher.yaml
└── README.md
```

**Example agent config (desired):**
```yaml
name: hurricane-watcher
description: Monitors hurricane activity and posts to Discord

system_prompt: |
  You are a hurricane monitoring agent. Check for tropical storm
  and hurricane activity that could affect the specified location.
  Format your response as a HURRICANE STATUS REPORT.

schedules:
  check:
    type: interval
    interval: 6h
    prompt: "Check for hurricane activity affecting Miami, FL"
    notify_discord:
      channel_id: "${DISCORD_CHANNEL_ID}"
      format: embed  # or text
      on_events: [completed]  # or [completed, failed]

chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    guilds:
      - id: "${DISCORD_GUILD_ID}"
        channels:
          - id: "${DISCORD_CHANNEL_ID}"
```

## Proposed Solution

### 1. Schema Changes

Add `notify_discord` option to `ScheduleSchema` in `packages/core/src/config/schema.ts`:

```typescript
export const DiscordNotifySchema = z.object({
  channel_id: z.string(),
  format: z.enum(["text", "embed"]).optional().default("text"),
  on_events: z.array(z.enum(["completed", "failed"])).optional().default(["completed"]),
  include_output: z.boolean().optional().default(true),
});

export const ScheduleSchema = z.object({
  type: ScheduleTypeSchema,
  interval: z.string().optional(),
  expression: z.string().optional(),
  prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
  enabled: z.boolean().optional().default(true),
  // NEW
  notify_discord: DiscordNotifySchema.optional(),
});
```

### 2. DiscordConnector Extension

Add outbound messaging capability to `packages/discord/src/discord-connector.ts`:

```typescript
/**
 * Send a message to a Discord channel (for notifications)
 */
async sendToChannel(channelId: string, content: string | EmbedOptions): Promise<void>

/**
 * Send a formatted job result notification
 */
async sendJobNotification(channelId: string, job: Job, format: "text" | "embed"): Promise<void>
```

### 3. FleetManager-Discord Bridge

Create a new component that connects FleetManager job events to Discord notifications:

**Option A: Built into FleetManager**
- FleetManager checks for `notify_discord` config on job completion
- Calls DiscordConnector directly

**Option B: Separate bridge component**
- New `DiscordNotificationBridge` class
- Subscribes to FleetManager events
- Handles notification logic independently

Recommendation: **Option B** - keeps concerns separated and makes Discord optional.

### 4. Event Flow (After Implementation)

```
Scheduler triggers schedule
  ↓
ScheduleExecutor runs agent with prompt
  ↓
Job completes (success or failure)
  ↓
FleetManager emits job:completed event
  ↓
DiscordNotificationBridge receives event
  ↓
Checks if schedule has notify_discord config
  ↓
Formats message based on config (text/embed)
  ↓
Calls DiscordConnector.sendToChannel()
  ↓
User sees notification in Discord
```

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/config/schema.ts` | Add `DiscordNotifySchema`, update `ScheduleSchema` |
| `packages/discord/src/discord-connector.ts` | Add `sendToChannel()`, `sendJobNotification()` |
| `packages/discord/src/types.ts` | Add notification-related types |
| `packages/core/src/fleet-manager/` | Add notification bridge (new file or extend existing) |
| `examples/hurricane-watcher/` | New example directory |

## Open Questions

1. **Bot token sharing**: Should notification use the same bot as chat, or allow a separate token?
   - Recommendation: Same bot (simpler), but allow override in `notify_discord` config

2. **Rate limiting**: Discord has rate limits. How to handle burst notifications?
   - Recommendation: Queue with backoff, warn if rate limited

3. **Channel validation**: Should we validate channel_id on startup or fail at runtime?
   - Recommendation: Validate on first send, cache result

4. **Embed formatting**: What fields should the default embed include?
   - Recommendation: Agent name, schedule name, status, timestamp, truncated output

5. **Error handling**: What if Discord send fails?
   - Recommendation: Log error, emit event, but don't fail the job

## Future Enhancements (Out of Scope for MVP)

- Conditional notifications (only if output matches criteria)
- Thread support (post to a specific thread)
- Mention support (@role or @user in notifications)
- Custom message templates
- Multiple notification channels per schedule
- Slack/other platform support using same pattern

## Success Criteria

1. Hurricane watcher example works end-to-end
2. User can configure `notify_discord` on any schedule
3. Notifications appear in Discord with job results
4. Errors are handled gracefully (Discord down doesn't crash agent)
5. Documentation explains setup (bot creation, permissions, config)
