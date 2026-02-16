# 009: Slack-Discord Parity Fixes -- Actionable Plan

**Date:** 2026-02-16
**Depends on:** [008-slack-discord-alignment.md](./008-slack-discord-alignment.md)
**Purpose:** Concrete implementation plan for Priority 1 fixes and key design decisions to bring the Slack connector to parity with Discord.

---

## Table of Contents

1. [Wire up CommandHandler](#1-wire-up-commandhandler)
2. [Add Type-Safe Event Emitter](#2-add-type-safe-event-emitter)
3. [Add Missing Events](#3-add-missing-events)
4. [Channel-Based Sessions (Instead of Thread-Based)](#4-channel-based-sessions-instead-of-thread-based)
5. [Auto-Mode Handler Explanation](#5-auto-mode-handler-explanation)
6. [Agent Configuration Alignment](#6-agent-configuration-alignment)

---

## 1. Wire up CommandHandler

### Current State

The `CommandHandler` class exists at `packages/slack/src/commands/command-handler.ts` and is fully implemented. Three built-in commands (`!help`, `!reset`, `!status`) are defined in their own files and exported from `packages/slack/src/commands/index.ts`. However, **no code in `SlackConnector` ever imports, instantiates, or calls `CommandHandler`**. The commands are dead code.

In contrast, Discord's `DiscordConnector` (`packages/discord/src/discord-connector.ts`):
- Creates a `CommandManager` instance in `_initializeCommands()` (called from the `ready` handler at line 370)
- Routes interactions through `_handleInteraction()` (line 524)
- Emits `commandExecuted` events after each command (line 542)

### Proposed Changes

#### File: `packages/slack/src/slack-connector.ts`

**Step 1: Add imports**

Add to the import block at the top of the file:

```typescript
import {
  CommandHandler,
  helpCommand,
  resetCommand,
  statusCommand,
} from "./commands/index.js";
```

**Step 2: Add CommandHandler as a class property**

Add alongside the other private fields (after `private readonly logger`):

```typescript
private commandHandler: CommandHandler | null = null;
```

**Step 3: Initialize CommandHandler in `connect()`, after bot info is retrieved**

After the line `this.botUsername = authResult.user as string;` (line 105) and before `this.status = "connected";` (line 107), add:

```typescript
// Initialize command handler with built-in commands
this.commandHandler = new CommandHandler({ logger: this.logger });
this.commandHandler.registerCommand(helpCommand);
this.commandHandler.registerCommand(resetCommand);
this.commandHandler.registerCommand(statusCommand);

this.logger.info("Prefix commands registered", {
  commands: ["!help", "!reset", "!status"],
});
```

**Step 4: Check for commands before emitting message events**

In both the `app_mention` handler and the `message` handler, after extracting the prompt text but before emitting the `message` event, insert a command check. The key change is in `buildMessageEvent` and the event handler logic.

In the `app_mention` handler, after `const prompt = processMessage(event.text, this.botUserId);` (line 217), add:

```typescript
// Check if this is a command
if (this.commandHandler && this.commandHandler.isCommand(prompt)) {
  const sessionManager = this.sessionManagers.get(agentName);
  if (sessionManager) {
    const executed = await this.commandHandler.executeCommand(prompt, {
      agentName,
      threadTs,
      channelId: event.channel,
      userId: event.user,
      reply: async (content: string) => {
        await say({ text: content, thread_ts: threadTs });
      },
      sessionManager,
      connectorState: this.getState(),
    });
    if (executed) {
      this.emit("commandExecuted", {
        agentName,
        commandName: prompt.trim().slice(1).split(/\s+/)[0],
        userId: event.user,
        channelId: event.channel,
      });
      return;
    }
  }
}
```

Apply the same pattern in the `message` handler, after `const prompt = processMessage(event.text ?? "", this.botUserId);` (line 328). The code is identical except the reply uses `event.user ?? ""` for the userId.

**Step 5: Clear CommandHandler on disconnect**

In `disconnect()`, after `this.app = null;` (line 151), add:

```typescript
this.commandHandler = null;
```

#### File: `packages/slack/src/commands/reset.ts`

When sessions switch to channel-based (see Section 4), the `!reset` command will need to change its `clearSession` call from `threadTs` to `channelId`. For now, the command works with the current thread-based session key.

### Implementation Notes

- Commands are checked **before** the message event is emitted, so the FleetManager never sees command messages
- The `CommandContext.reply` function is constructed inline using the `say` function from Bolt
- The `sessionManager` is looked up from the `this.sessionManagers` map using `agentName`
- The `connectorState` comes from `this.getState()` -- this is available because the connector owns the state

---

## 2. Add Type-Safe Event Emitter

### Current State

**Discord** (`packages/discord/src/discord-connector.ts` lines 813-839) has type-safe overrides:

```typescript
override emit<K extends DiscordConnectorEventName>(
  event: K,
  payload: DiscordConnectorEventMap[K]
): boolean {
  return super.emit(event, payload);
}

override on<K extends DiscordConnectorEventName>(
  event: K,
  listener: (payload: DiscordConnectorEventMap[K]) => void
): this {
  return super.on(event, listener);
}

// ... same for once() and off()
```

Discord's event map (`packages/discord/src/types.ts` lines 236-381) uses object syntax:

```typescript
interface DiscordConnectorEventMap {
  ready: { agentName: string; botUser: { ... } };
  message: { agentName: string; prompt: string; ... };
  // ...
}
```

**Slack** (`packages/slack/src/types.ts` lines 220-225) uses tuple syntax and has **no** type-safe overrides:

```typescript
interface SlackConnectorEventMap {
  message: [payload: SlackMessageEvent];
  error: [payload: SlackErrorEvent];
  connected: [];
  disconnected: [];
}
```

### Proposed Changes

#### File: `packages/slack/src/types.ts`

**Replace the `SlackConnectorEventMap` interface** (lines 220-225) with object syntax matching Discord:

```typescript
/**
 * Strongly-typed event map for SlackConnector
 *
 * Uses object syntax matching Discord's DiscordConnectorEventMap pattern.
 */
export interface SlackConnectorEventMap {
  /** Emitted when connection is established and ready */
  ready: {
    agentName: string;
    botUser: {
      id: string;
      username: string;
    };
  };

  /** Emitted when connection is lost */
  disconnect: {
    agentName: string;
    reason: string;
  };

  /** Emitted on connection error */
  error: {
    agentName: string;
    error: Error;
  };

  /** Emitted when a processable message is received */
  message: SlackMessageEvent;

  /** Emitted when a message is ignored */
  messageIgnored: {
    agentName: string;
    reason: "not_configured" | "bot_message" | "no_agent_resolved" | "empty_prompt";
    channelId: string;
    messageTs: string;
  };

  /** Emitted when a prefix command is executed */
  commandExecuted: {
    agentName: string;
    commandName: string;
    userId: string;
    channelId: string;
  };

  /** Emitted when a session is created, resumed, expired, or cleared */
  sessionLifecycle: {
    agentName: string;
    event: "created" | "resumed" | "expired" | "cleared";
    channelId: string;
    sessionId: string;
  };
}

export type SlackConnectorEventName = keyof SlackConnectorEventMap;
export type SlackConnectorEventPayload<E extends SlackConnectorEventName> =
  SlackConnectorEventMap[E];
```

**Update the `ISlackConnector` interface** (lines 157-175) to use the new event types:

```typescript
export interface ISlackConnector extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getState(): SlackConnectorState;

  // Type-safe event subscription
  on<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void
  ): this;
  once<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void
  ): this;
  off<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void
  ): this;
}
```

#### File: `packages/slack/src/slack-connector.ts`

**Add type-safe overrides** at the bottom of the `SlackConnector` class (before the closing `}`):

```typescript
// ===========================================================================
// Type-Safe Event Emitter Overrides
// ===========================================================================

override emit<K extends SlackConnectorEventName>(
  event: K,
  payload: SlackConnectorEventMap[K]
): boolean {
  return super.emit(event, payload);
}

override on<K extends SlackConnectorEventName>(
  event: K,
  listener: (payload: SlackConnectorEventMap[K]) => void
): this {
  return super.on(event, listener);
}

override once<K extends SlackConnectorEventName>(
  event: K,
  listener: (payload: SlackConnectorEventMap[K]) => void
): this {
  return super.once(event, listener);
}

override off<K extends SlackConnectorEventName>(
  event: K,
  listener: (payload: SlackConnectorEventMap[K]) => void
): this {
  return super.off(event, listener);
}
```

Add imports at the top of `slack-connector.ts`:

```typescript
import type {
  SlackConnectorEventMap,
  SlackConnectorEventName,
} from "./types.js";
```

### Implementation Notes

- The tuple syntax `message: [payload: SlackMessageEvent]` must be replaced with object syntax `message: SlackMessageEvent` because the type-safe override pattern `emit<K>(event: K, payload: Map[K])` requires the map values to be single types, not tuples.
- The `error` event is renamed from `SlackErrorEvent` (which had `agentName: string; error: Error`) to an inline object to match Discord's pattern. Since Slack is a shared connector, `agentName` can be `"slack"` or can be omitted for connector-level errors. For simplicity, keep it as-is.
- The `connected` and `disconnected` events are replaced with `ready` and `disconnect` to match Discord's naming. This is a breaking change, but per CLAUDE.md, breaking changes are fine in pre-MVP.

---

## 3. Add Missing Events

### Current State

Discord emits 9 event types. Slack emits 4 (and 2 of those have wrong names). Here is the complete comparison with where each event should be emitted in the Slack code:

| Event | Discord | Slack Current | Slack Needed |
|-------|---------|---------------|--------------|
| `ready` | Yes | `connected` (wrong name, no payload) | Rename, add payload |
| `disconnect` | Yes | `disconnected` (wrong name, no payload) | Rename, add payload |
| `error` | Yes | Yes | OK |
| `message` | Yes | Yes | OK |
| `reconnecting` | Yes | Missing | Not needed (Bolt handles internally) |
| `reconnected` | Yes | Missing | Not needed (Bolt handles internally) |
| `messageIgnored` | Yes | Missing | ADD |
| `commandExecuted` | Yes | Missing | ADD |
| `sessionLifecycle` | Yes | Missing | ADD |
| `rateLimit` | Yes | Missing | Not needed (Slack rate limits differ) |

### Proposed Changes

All changes are in `packages/slack/src/slack-connector.ts`.

#### 3a. `ready` event (replaces `connected`)

**Location:** `connect()` method, line 119 (`this.emit("connected")`)

**Replace with:**

```typescript
this.emit("ready", {
  agentName: "slack",
  botUser: {
    id: this.botUserId!,
    username: this.botUsername ?? "unknown",
  },
});
```

Note: Since Slack has a single shared connector (not per-agent), the `agentName` field is `"slack"`. Alternatively, this could be omitted or set to a workspace identifier. Using `"slack"` keeps the type compatible.

#### 3b. `disconnect` event (replaces `disconnected`)

**Location:** `disconnect()` method, line 156 (`this.emit("disconnected")`)

**Replace with:**

```typescript
this.emit("disconnect", {
  agentName: "slack",
  reason: "Intentional disconnect",
});
```

#### 3c. `messageIgnored` events

Add `messageIgnored` emissions at every point where `this.messagesIgnored++` is incremented. There are currently 5 places:

1. **app_mention handler, unconfigured channel** (line 210-213):

```typescript
this.messagesIgnored++;
this.emit("messageIgnored", {
  agentName: "unknown",
  reason: "not_configured",
  channelId: event.channel,
  messageTs: event.ts,
});
this.logger.debug("Ignoring mention in unconfigured channel", { ... });
```

2. **app_mention handler, empty prompt** (line 219):

```typescript
this.messagesIgnored++;
this.emit("messageIgnored", {
  agentName: agentName ?? "unknown",
  reason: "empty_prompt",
  channelId: event.channel,
  messageTs: event.ts,
});
```

3. **message handler, bot/own message** (line 251):

```typescript
this.messagesIgnored++;
this.emit("messageIgnored", {
  agentName: "unknown",
  reason: "bot_message",
  channelId: event.channel,
  messageTs: event.ts,
});
```

4. **message handler, no agent resolved** (line 314):

```typescript
this.messagesIgnored++;
this.emit("messageIgnored", {
  agentName: "unknown",
  reason: "no_agent_resolved",
  channelId: event.channel,
  messageTs: event.ts ?? event.thread_ts ?? "",
});
```

5. **message handler, empty prompt** (line 331):

```typescript
this.messagesIgnored++;
this.emit("messageIgnored", {
  agentName: resolvedAgent,
  reason: "empty_prompt",
  channelId: event.channel,
  messageTs: event.ts,
});
```

#### 3d. `commandExecuted` event

Already addressed in Section 1 (Wire up CommandHandler). The event is emitted after `commandHandler.executeCommand()` returns true.

#### 3e. `sessionLifecycle` event

This event requires changes in the FleetManager's `SlackManager` (`packages/core/src/fleet-manager/slack-manager.ts`), because that is where sessions are created/resumed. The connector itself does not manage sessions -- it delegates to the manager.

**In `SlackManager.handleMessage()`** (line 541-635), after session operations:

After getting the existing session (line 545-555), emit:

```typescript
if (existingSession) {
  emitter.emit("slack:session:lifecycle", {
    agentName,
    event: "resumed",
    channelId: event.metadata.channelId,
    sessionId: existingSession.sessionId,
  });
} else {
  // Will be emitted as "created" after the job completes and session is stored
}
```

After storing the session (line 623-634), emit:

```typescript
emitter.emit("slack:session:lifecycle", {
  agentName,
  event: "created",
  channelId: event.metadata.channelId,
  sessionId: result.sessionId,
});
```

#### What Slack intentionally skips

- **`reconnecting` / `reconnected`**: Slack Bolt manages WebSocket reconnection internally. There is no accessible event to hook into. If Bolt exposes reconnection events in the future, they can be proxied.
- **`rateLimit`**: Slack rate limiting is handled by Bolt's built-in retry logic. There is no per-request rate limit event like Discord.js provides. Slack could add a rate limit tracker in the future if needed.

### Files that need updating for event changes

When the `connected`/`disconnected` event names change to `ready`/`disconnect`, the FleetManager's `SlackManager` must also be updated:

**File: `packages/core/src/fleet-manager/slack-manager.ts`**

The `start()` method (line 424) subscribes to `"message"` and `"error"` events. It does not currently subscribe to `"connected"` or `"disconnected"`, so no changes needed there. However, the `ISlackConnector` interface in this file (line 96-105) needs updating to match the new event names.

---

## 4. Channel-Based Sessions (Instead of Thread-Based)

### The Design Decision

The user wants Slack sessions to be **channel-based**, matching Discord's model:

- **One active session per channel** (not per thread)
- `!new` or `!reset` starts a fresh session in the same channel
- The agent still replies in threads for conversation grouping (Slack UX convention)
- Notifications from elsewhere (e.g., scheduled job results) go to the same thread but are NOT part of the interactive session
- Session is keyed by `channelId`, not `threadTs`

### Current State

#### Discord Session Manager (`packages/discord/src/session-manager/`)

- **Key:** `channelId` (string)
- **Schema:** `DiscordSessionStateSchema` with `channels: Record<string, ChannelSession>`
- **`ChannelSession`:** `{ sessionId: string; lastMessageAt: string }`
- **`getOrCreateSession(channelId)`** -- single argument
- **`setSession(channelId, sessionId)`** -- two arguments
- **Storage:** `.herdctl/discord-sessions/<agent>.yaml`

#### Slack Session Manager (`packages/slack/src/session-manager/`)

- **Key:** `threadTs` (string)
- **Schema:** `SlackSessionStateSchema` with `threads: Record<string, ThreadSession>`
- **`ThreadSession`:** `{ sessionId: string; lastMessageAt: string; channelId: string }`
- **`getOrCreateSession(threadTs, channelId)`** -- extra `channelId` arg
- **`setSession(threadTs, sessionId, channelId)`** -- extra `channelId` arg
- **Storage:** `.herdctl/slack-sessions/<agent>.yaml`

### Proposed Changes

The Slack session manager should be refactored to key by `channelId` instead of `threadTs`. This makes it structurally identical to Discord's.

#### File: `packages/slack/src/session-manager/types.ts`

**Replace `ThreadSessionSchema` and `SlackSessionStateSchema`:**

```typescript
/**
 * Schema for individual channel session mapping
 *
 * Matches Discord's ChannelSession pattern.
 * One active session per channel.
 */
export const ChannelSessionSchema = z.object({
  /** Claude session ID for resuming conversations */
  sessionId: z.string().min(1, "Session ID cannot be empty"),

  /** ISO timestamp when last message was sent/received */
  lastMessageAt: z.string().datetime({
    message: "lastMessageAt must be a valid ISO datetime string",
  }),
});

/**
 * Schema for the entire agent's Slack session state file
 */
export const SlackSessionStateSchema = z.object({
  version: z.literal(1),
  agentName: z.string().min(1, "Agent name cannot be empty"),

  /** Map of channel ID to session info */
  channels: z.record(z.string(), ChannelSessionSchema),
});

export type ChannelSession = z.infer<typeof ChannelSessionSchema>;
export type SlackSessionState = z.infer<typeof SlackSessionStateSchema>;
```

**Update `ISessionManager` interface:**

```typescript
export interface ISessionManager {
  getOrCreateSession(channelId: string): Promise<SessionResult>;
  touchSession(channelId: string): Promise<void>;
  getSession(channelId: string): Promise<ChannelSession | null>;
  setSession(channelId: string, sessionId: string): Promise<void>;
  clearSession(channelId: string): Promise<boolean>;
  cleanupExpiredSessions(): Promise<number>;
  getActiveSessionCount(): Promise<number>;
  readonly agentName: string;
}
```

Note: The `channelId` parameter in `getOrCreateSession` and `setSession` drops the extra argument, making the interface identical to Discord's.

**Update factory functions:**

```typescript
export function createInitialSessionState(agentName: string): SlackSessionState {
  return {
    version: 1,
    agentName,
    channels: {},
  };
}
```

Remove the `createThreadSession` factory function (no longer needed).

#### File: `packages/slack/src/session-manager/session-manager.ts`

Replace all `threadTs` references with `channelId`. Replace `state.threads[...]` with `state.channels[...]`. Remove the `channelId` parameter from `getOrCreateSession()` and `setSession()`.

Key method signatures become:

```typescript
async getOrCreateSession(channelId: string): Promise<SessionResult>
async touchSession(channelId: string): Promise<void>
async getSession(channelId: string): Promise<ChannelSession | null>
async setSession(channelId: string, sessionId: string): Promise<void>
async clearSession(channelId: string): Promise<boolean>
```

This makes the Slack `SessionManager` nearly identical to Discord's `SessionManager`.

#### File: `packages/slack/src/types.ts`

Update `ISlackSessionManager` to match:

```typescript
export interface ISlackSessionManager {
  readonly agentName: string;

  getOrCreateSession(channelId: string): Promise<{ sessionId: string; isNew: boolean }>;
  getSession(channelId: string): Promise<{ sessionId: string; lastMessageAt: string } | null>;
  setSession(channelId: string, sessionId: string): Promise<void>;
  touchSession(channelId: string): Promise<void>;
  clearSession(channelId: string): Promise<boolean>;
  cleanupExpiredSessions(): Promise<number>;
  getActiveSessionCount(): Promise<number>;
}
```

#### File: `packages/slack/src/slack-connector.ts`

The `activeThreads` map (`Map<string, string>`) remains. It is still needed for routing thread replies to the correct agent. But sessions are no longer keyed by `threadTs`.

No changes needed in the connector itself for session key changes -- the connector does not call session methods directly. It only stores `threadTs` in the `activeThreads` map for routing.

#### File: `packages/core/src/fleet-manager/slack-manager.ts`

This is where most session-related changes land:

1. **`handleMessage()`**: Change session lookup from `event.metadata.threadTs` to `event.metadata.channelId`:

```typescript
// Before:
const existingSession = await sessionManager.getSession(event.metadata.threadTs);

// After:
const existingSession = await sessionManager.getSession(event.metadata.channelId);
```

2. **`handleMessage()`**: Change session storage from `threadTs` to `channelId`:

```typescript
// Before:
await sessionManager.setSession(
  event.metadata.threadTs,
  result.sessionId,
  event.metadata.channelId
);

// After:
await sessionManager.setSession(
  event.metadata.channelId,
  result.sessionId
);
```

3. **Update the `ISlackSessionManager` interface** in this file (line 110-119) to match the new method signatures (drop the `channelId` param from `setSession` and `getOrCreateSession`).

#### What happens with threads?

Threads remain the Slack UX mechanism for conversation grouping:

- When a user @mentions the bot in a channel, the bot replies in a thread off that message
- Subsequent messages in that thread are routed to the same agent via `activeThreads`
- The **session** (Claude conversation state) is per-channel, not per-thread
- If a user starts a new thread with `!new` or `!reset`, the channel's session is cleared and a fresh Claude session begins
- If a scheduled job result needs to be posted, it can be posted to the channel without affecting the session

This means:

- Two different threads in the same channel share the same Claude session
- This matches Discord, where all messages in a channel share one session
- The `activeThreads` map is for **agent routing** only, not session management

#### File: `packages/slack/src/commands/reset.ts`

Update to clear by `channelId`:

```typescript
async execute(context: CommandContext): Promise<void> {
  const { channelId, sessionManager, reply } = context;

  const cleared = await sessionManager.clearSession(channelId);

  if (cleared) {
    await reply(
      "Session cleared. The next message will start a fresh conversation."
    );
  } else {
    await reply("No active session in this channel.");
  }
},
```

#### File: `packages/slack/src/commands/status.ts`

Update to look up session by `channelId`:

```typescript
const session = await sessionManager.getSession(context.channelId);
```

---

## 5. Auto-Mode Handler Explanation

### What Discord's AutoModeHandler Does

Discord's `auto-mode-handler.ts` (`packages/discord/src/auto-mode-handler.ts`) provides three things:

#### 1. Channel mode resolution (`resolveChannelConfig()`)

Given a channel ID and guild ID, this function looks up the channel's configuration from the agent's `guilds[].channels[]` config and returns:

```typescript
{
  mode: "mention" | "auto",    // How the bot decides to respond
  contextMessages: number,     // How many history messages to fetch
  isDM: boolean,
  guildId: string | null,
}
```

- **`mention` mode** (default): The bot only responds when explicitly @mentioned
- **`auto` mode**: The bot responds to ALL non-bot messages in the channel, no mention needed

This is configured per-channel in the YAML config:

```yaml
guilds:
  - id: "123456789"
    channels:
      - id: "987654321"
        name: "#support"
        mode: mention         # Only respond when @mentioned
      - id: "111222333"
        name: "#ai-playground"
        mode: auto            # Respond to everything
```

#### 2. DM filtering (`checkDMUserFilter()`)

Discord bots can receive DMs. The auto-mode handler controls who can DM:

- DMs default to `auto` mode (no mention needed)
- An allowlist restricts DMs to specific users
- A blocklist blocks specific users
- DMs can be disabled entirely

#### 3. Mode-based message filtering

The Discord connector calls `shouldProcessMessage(message, botUserId, mode)`:
- In `auto` mode: all non-bot messages pass
- In `mention` mode: only messages that @mention the bot pass

### How Discord Decides Whether to Respond

The full decision chain in `DiscordConnector._handleMessage()`:

1. Is the author a bot? -> Ignore
2. Is this a DM? -> Check `checkDMUserFilter()` (allowlist/blocklist) -> If allowed, use auto mode
3. Is this a guild channel? -> Call `resolveChannelConfig(channelId, guildId, guilds, dm)` -> Get mode
4. If channel not configured -> Ignore (emit `messageIgnored` with reason `unknown_channel`)
5. Call `shouldProcessMessage(message, botUserId, mode)`:
   - `auto` mode: process all non-bot messages
   - `mention` mode: only process if `isBotMentioned()` returns true
6. If should not process -> Ignore (emit `messageIgnored` with reason `not_mentioned`)
7. Build conversation context and emit `message` event

### Does Slack Need Something Similar?

**No, Slack does not need an auto-mode handler.** Slack's architecture achieves the same outcomes through different platform mechanisms.

Here is why:

#### Slack's equivalent of "mention mode"

Slack's Bolt framework provides the `app_mention` event, which fires only when the bot is @mentioned. This is the Slack-native equivalent of Discord's mention mode. The `app_mention` handler in `SlackConnector.registerEventHandlers()` handles this case.

#### Slack's equivalent of "auto mode" for threads

Once a conversation thread is started (by an @mention), the `message` event handler picks up all subsequent replies in that thread. This is "auto mode within a thread" -- the user does not need to @mention the bot again inside a thread they already started. The `activeThreads` map handles this routing.

#### Slack's equivalent of channel configuration

Slack uses `channelAgentMap` (built from the YAML config) to determine which channels are "configured." Messages in unconfigured channels are ignored. This is equivalent to Discord's guild/channel configuration -- if a channel is not listed, the bot ignores it.

#### What is NOT equivalent

1. **Discord has `auto` mode at the channel level** -- the bot can respond to every message in a channel, even without being @mentioned. Slack currently does not support this. If a user sends a top-level message in a configured channel WITHOUT @mentioning the bot, the `message` event handler will pick it up through the `channelAgentMap`, but the current code routes it to the agent anyway (lines 301-310 in `slack-connector.ts`). This is actually closer to Discord's auto mode behavior.

2. **Discord has DM support** -- Slack does not currently support DMs at all. This is a future enhancement, not a parity issue.

#### Conclusion

Slack's channel-to-agent routing via `channelAgentMap` plus the Bolt event model (`app_mention` for explicit triggers, `message` for thread replies and channel messages) provides equivalent functionality to Discord's auto-mode handler. The approaches are different because the platforms are different, but the user-facing behavior is the same:

- Configured channels process messages -> equivalent to Discord's guild/channel config
- @mentions start new conversations -> equivalent to Discord's mention mode
- Thread replies continue without @mention -> equivalent to Discord's auto mode within a conversation
- Unconfigured channels are ignored -> equivalent to Discord returning null from `resolveChannelConfig`

**No changes needed.** If per-channel mode configuration is wanted in the future (e.g., some Slack channels in "auto" mode, some in "mention-only"), it can be added as a `mode` field in the `SlackChannelSchema`. But this is not a parity issue -- it is a feature enhancement.

---

## 6. Agent Configuration Alignment

### Current State

#### Discord Config (`packages/core/src/config/schema.ts` lines 594-607)

Discord configuration is **per-agent** -- each agent has its own `chat.discord` block with its own bot token:

```yaml
# Agent config (herdctl-agent.yml)
name: support-agent
chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN    # Unique per agent
    session_expiry_hours: 24
    log_level: standard
    presence:
      activity_type: watching
      activity_message: "for support requests"
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            name: "#support"
            mode: mention
            context_messages: 10
    dm:
      enabled: true
      mode: auto
```

Key aspects:
- `bot_token_env` is required (no default) -- each agent has its own bot
- `guilds` is required -- hierarchical guild > channels structure
- Per-channel `mode` and `context_messages`
- Optional `presence` and `dm` configuration
- One `DiscordConnector` per agent in the fleet

#### Slack Config (`packages/core/src/config/schema.ts` lines 650-661)

Slack configuration is also **per-agent**, but all agents share the same tokens:

```yaml
# Agent config (herdctl-agent.yml)
name: support-agent
chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN          # Shared across agents (with default)
    app_token_env: SLACK_APP_TOKEN          # Shared across agents (with default)
    session_expiry_hours: 24
    log_level: standard
    channels:
      - id: "C0123456789"
        name: "#support"
```

Key aspects:
- `bot_token_env` and `app_token_env` have defaults (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`)
- `channels` is a flat list (no guild hierarchy -- Slack does not have guilds)
- No per-channel `mode` or `context_messages`
- No `presence` equivalent (Slack does not have Discord-style presence)
- No DM configuration
- One shared `SlackConnector` for all agents

### Config Shape Comparison

| Field | Discord | Slack | Notes |
|-------|---------|-------|-------|
| `bot_token_env` | Required, no default | Has default `SLACK_BOT_TOKEN` | Correct -- Slack shares tokens |
| `app_token_env` | N/A | Has default `SLACK_APP_TOKEN` | Slack-specific (Socket Mode) |
| `session_expiry_hours` | Default 24 | Default 24 | Aligned |
| `log_level` | 3-level enum | 3-level enum | Aligned |
| `presence` | Optional object | N/A | Not applicable to Slack |
| `guilds` | Required array | N/A | Slack has no guild concept |
| `channels` | Nested under guilds | Top-level flat array | Correct for platform |
| `channels[].mode` | `"mention" \| "auto"` | N/A | Could add to Slack (see below) |
| `channels[].context_messages` | Number, default 10 | N/A | Could add to Slack (see below) |
| `dm` | Optional config | N/A | Future Slack enhancement |

### Proposed Unified Agent Configuration

The configs are already close. The key differences are platform-specific and should stay. However, two optional fields should be added to `SlackChannelSchema` for parity:

#### File: `packages/core/src/config/schema.ts`

Update `SlackChannelSchema` (lines 623-628):

```typescript
export const SlackChannelSchema = z.object({
  /** Slack channel ID */
  id: z.string(),
  /** Human-readable channel name (for documentation) */
  name: z.string().optional(),
  /** Channel mode: mention (default) = only respond to @mentions,
   *  auto = respond to all messages */
  mode: z.enum(["mention", "auto"]).default("mention"),
  /** Number of context messages to include in conversation history */
  context_messages: z.number().int().positive().default(10),
});
```

This makes the per-channel config shape identical to Discord's `DiscordChannelSchema`:

```typescript
// Discord (existing)
DiscordChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mode: z.enum(["mention", "auto"]).default("mention"),
  context_messages: z.number().int().positive().default(10),
});

// Slack (proposed)
SlackChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mode: z.enum(["mention", "auto"]).default("mention"),
  context_messages: z.number().int().positive().default(10),
});
```

### Side-by-Side YAML Comparison

#### Discord Agent Config

```yaml
name: code-reviewer
description: "Reviews pull requests"
chat:
  discord:
    bot_token_env: REVIEWER_DISCORD_TOKEN
    session_expiry_hours: 12
    log_level: standard
    presence:
      activity_type: watching
      activity_message: "for PRs to review"
    guilds:
      - id: "111222333444555666"
        channels:
          - id: "777888999000111222"
            name: "#code-review"
            mode: mention
            context_messages: 15
          - id: "333444555666777888"
            name: "#ai-sandbox"
            mode: auto
            context_messages: 5
    dm:
      enabled: true
      mode: auto
      allowlist:
        - "123456789012345678"
```

#### Slack Agent Config (Proposed)

```yaml
name: code-reviewer
description: "Reviews pull requests"
chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN        # Shared, has default
    app_token_env: SLACK_APP_TOKEN        # Shared, has default
    session_expiry_hours: 12
    log_level: standard
    channels:
      - id: "C0123456789"
        name: "#code-review"
        mode: mention                     # NEW -- matches Discord
        context_messages: 15              # NEW -- matches Discord
      - id: "C9876543210"
        name: "#ai-sandbox"
        mode: auto                        # NEW -- matches Discord
        context_messages: 5               # NEW -- matches Discord
```

### What stays different (correctly)

1. **Token structure**: Discord has one `bot_token_env` (unique per agent). Slack has `bot_token_env` + `app_token_env` (shared across agents, with defaults). This is a fundamental platform difference.

2. **Guild hierarchy**: Discord wraps channels in guilds (`guilds[].channels[]`). Slack has a flat `channels[]` list. Slack workspaces are analogous to Discord guilds, but since Slack uses one bot per workspace, there is no need for a guild-level grouping.

3. **Presence**: Discord has rich presence (activity type + message). Slack does not have an equivalent concept for bot users.

4. **DMs**: Discord has configurable DMs with allowlist/blocklist. Slack does not support DMs in the current implementation. This is a future enhancement.

### Implementation Notes for `mode` and `context_messages`

When `mode` and `context_messages` are added to the Slack channel schema:

1. **`mode`**: The `SlackConnector.registerEventHandlers()` message handler (the handler for non-threaded, top-level channel messages) should check the channel mode. If mode is `mention`, only process messages that @mention the bot. If mode is `auto`, process all messages. Currently, top-level channel messages are processed if the channel is in `channelAgentMap` (lines 301-310), which is essentially auto mode. The `app_mention` handler already covers mention mode.

2. **`context_messages`**: When conversation context building is added (Priority 2 from 008), the `context_messages` config value should control how many Slack messages are fetched via `conversations.replies` for context building.

3. **Config flow**: The `SlackManager.initialize()` method in `packages/core/src/fleet-manager/slack-manager.ts` already iterates through agent slack configs to build the `channelAgentMap`. It should also pass the mode and context_messages settings through, either by extending the channel map value to include config or by building a separate channel config map.

---

## Summary of Changes by File

| File | Changes |
|------|---------|
| `packages/slack/src/slack-connector.ts` | Wire CommandHandler, add type-safe overrides, emit `ready`/`disconnect`/`messageIgnored`/`commandExecuted`, clear command handler on disconnect |
| `packages/slack/src/types.ts` | Replace event map with object syntax, add new event types, update `ISlackConnector` and `ISlackSessionManager` interfaces |
| `packages/slack/src/session-manager/types.ts` | Change from thread-based to channel-based schema |
| `packages/slack/src/session-manager/session-manager.ts` | Change all session keys from `threadTs` to `channelId` |
| `packages/slack/src/commands/reset.ts` | Use `channelId` instead of `threadTs` for session clearing |
| `packages/slack/src/commands/status.ts` | Use `channelId` instead of `threadTs` for session lookup |
| `packages/core/src/config/schema.ts` | Add `mode` and `context_messages` to `SlackChannelSchema` |
| `packages/core/src/fleet-manager/slack-manager.ts` | Update session calls to use `channelId`, update `ISlackSessionManager` interface, add `sessionLifecycle` events |

### Priority Order

1. **Wire CommandHandler** -- dead code is the worst kind of gap
2. **Type-safe event emitter** -- core type safety contract
3. **Event parity** (`ready`/`disconnect`/`messageIgnored`) -- aligns with Discord
4. **Channel-based sessions** -- design alignment with Discord
5. **Config alignment** (`mode`/`context_messages`) -- enables future auto-mode support
