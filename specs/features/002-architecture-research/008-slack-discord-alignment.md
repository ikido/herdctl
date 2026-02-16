# 008: Slack-Discord Connector Alignment Analysis

**Date:** 2026-02-16
**Purpose:** Comprehensive comparison of the Discord and Slack connectors to identify what the Slack connector must change to align with Discord's established patterns, making the Slack PR mergeable.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Package Structure](#2-package-structure)
3. [Connector Class Architecture](#3-connector-class-architecture)
4. [Session Management](#4-session-management)
5. [Message Handling](#5-message-handling)
6. [Streaming Responses](#6-streaming-responses)
7. [Commands](#7-commands)
8. [Auto Mode / Mention Mode](#8-auto-mode--mention-mode)
9. [FleetManager Integration](#9-fleetmanager-integration)
10. [Configuration Schema](#10-configuration-schema)
11. [Types and Events](#11-types-and-events)
12. [Error Handling](#12-error-handling)
13. [Logger](#13-logger)
14. [Formatting Utilities](#14-formatting-utilities)
15. [Testing Patterns](#15-testing-patterns)
16. [Prioritized Change List](#16-prioritized-change-list)
17. [Areas Where Slack Should Differ](#17-areas-where-slack-should-differ)

---

## 1. Executive Summary

The Discord connector is the mature, battle-tested reference implementation. The Slack connector follows many of the same patterns but has several structural divergences, missing features, and architectural shortcuts that need to be addressed before the PR can merge.

**Key architectural difference (intentional and correct):**
- Discord: N connectors, one per agent (each agent has its own bot token)
- Slack: 1 connector shared across all agents (one bot token per workspace) with channel-to-agent routing

This is a fundamental platform difference and is correctly implemented. However, within that constraint, Slack should still follow Discord's patterns for code organization, type safety, error handling, and event emission.

**Top-level findings:**
- Slack is missing type-safe event emitter overrides
- Slack's error handler is significantly simpler (no `ErrorHandler` class, no `withRetry`)
- Slack's connector uses `any` types for Bolt internals instead of clean interfaces
- Slack lacks rate limit tracking in connector state
- Slack's event map uses tuple syntax while Discord uses object syntax
- Slack's `CommandHandler` is not integrated into the connector (it's defined but never used)
- Slack is missing `ready`, `reconnecting`, `reconnected`, `messageIgnored`, `commandExecuted`, `sessionLifecycle`, and `rateLimit` events

---

## 2. Package Structure

### Discord Structure
```
packages/discord/src/
  discord-connector.ts          # Main connector class
  types.ts                      # All connector types/interfaces
  errors.ts                     # Error classes with enum codes
  error-handler.ts              # ErrorHandler class, withRetry, classifyError
  logger.ts                     # DiscordLogger class with level filtering
  mention-handler.ts            # Mention detection, context building
  auto-mode-handler.ts          # DM filtering, channel config resolution
  index.ts                      # Package exports
  commands/
    command-manager.ts           # CommandManager class
    types.ts                     # Command types (CommandContext, SlashCommand)
    help.ts                      # /help command
    reset.ts                     # /reset command
    status.ts                    # /status command
    index.ts                     # Command exports
    __tests__/                   # Per-command tests
  session-manager/
    session-manager.ts           # SessionManager class
    types.ts                     # Session types, Zod schemas, ISessionManager
    errors.ts                    # Session-specific error classes
    index.ts                     # Session exports
    __tests__/                   # Session manager tests
  utils/
    formatting.ts                # Message splitting, typing indicators
    index.ts                     # Utils exports
  __tests__/                     # Connector-level tests
```

### Slack Structure
```
packages/slack/src/
  slack-connector.ts             # Main connector class
  types.ts                       # All connector types/interfaces
  errors.ts                      # Error classes with enum codes
  error-handler.ts               # Simple classifyError, safeExecute
  logger.ts                      # Factory functions (no class)
  message-handler.ts             # Mention detection, shouldProcess
  formatting.ts                  # Message splitting, mrkdwn conversion
  index.ts                       # Package exports
  commands/
    command-handler.ts            # CommandHandler class (prefix-based)
    help.ts                       # !help command
    reset.ts                      # !reset command
    status.ts                     # !status command
    index.ts                      # Command exports
  session-manager/
    session-manager.ts            # SessionManager class
    types.ts                      # Session types, Zod schemas
    errors.ts                     # Session-specific error classes
    index.ts                      # Session exports
  __tests__/                     # All tests flat in one directory
```

### Differences and Required Changes

| Aspect | Discord | Slack | Change Needed |
|--------|---------|-------|---------------|
| Utils directory | `utils/` subdirectory with `index.ts` | Flat `formatting.ts` | Minor - acceptable as-is, Slack has fewer utils |
| Auto-mode handler | Dedicated `auto-mode-handler.ts` | None | See Section 8 - Slack doesn't need this (different model) |
| Command tests | Per-command `__tests__/` inside `commands/` | Single `__tests__/command-handler.test.ts` | Should add per-command tests |
| Session tests | `__tests__/` inside `session-manager/` | Single `__tests__/session-manager.test.ts` | Acceptable for now |
| Mention handler | `mention-handler.ts` with context building | `message-handler.ts` - simpler | Missing: conversation context building (see Section 5) |

---

## 3. Connector Class Architecture

### Constructor

| Aspect | Discord | Slack | Change Needed |
|--------|---------|-------|---------------|
| Base class | `EventEmitter` from `events` | `EventEmitter` from `node:events` | No (equivalent) |
| Implements | `IDiscordConnector` | `ISlackConnector` | OK |
| Config storage | Stores `agentConfig`, `discordConfig`, `botToken` separately | Stores `botToken`, `appToken`, `channelAgentMap` | Correct for shared connector model |
| Logger creation | `createLoggerFromConfig()` or injected | Injected or `createDefaultSlackLogger()` | OK |
| Error handler | Creates `ErrorHandler` instance | None | **MISSING**: Should create an `ErrorHandler` instance |
| Token validation | Validates token in constructor, throws `InvalidTokenError` | No validation | **MISSING**: Should validate tokens |
| Session manager | Stored as `_sessionManager` (single) | Stored as `sessionManagers` (Map) | Correct for shared model |
| Accessors | `get sessionManager`, `get commandManager`, `get agentName`, `get client` | None | **MISSING**: Should expose state via getters |

### Lifecycle: connect()

| Aspect | Discord | Slack | Change Needed |
|--------|---------|-------|---------------|
| Guard check | Throws `AlreadyConnectedError(this.agentName)` | Throws `AlreadyConnectedError()` (no agent name) | **FIX**: Pass context to error |
| Status tracking | Sets `connecting`, then `connected` via ready event | Sets `connecting`, then `connected` after `app.start()` | OK |
| Event setup | `_setupEventHandlers()` before `client.login()` | `registerEventHandlers()` before `app.start()` | OK |
| Session cleanup | Cleans expired sessions on startup (in ready handler) | Not done | **MISSING**: Should cleanup expired sessions on connect |
| Command init | `_initializeCommands()` in ready handler | Never initializes commands | **MISSING**: CommandHandler is defined but never wired in |
| Ready event | Emits typed `ready` event with bot user info | Emits untyped `connected` event | **FIX**: Should emit typed `ready` event matching Discord pattern |
| Error wrapping | Wraps in `DiscordConnectionError(agentName, message)` | Wraps in `SlackConnectionError(message)` | **FIX**: Include agent context |

### Lifecycle: disconnect()

| Aspect | Discord | Slack | Change Needed |
|--------|---------|-------|---------------|
| Stats logging | Logs message stats on disconnect | Does not | **MISSING**: Should log stats |
| Resource cleanup | Clears rate limit timer, command manager, bot user | Only nulls app | **MISSING**: Should clear all state |
| Event emission | Implicit (no explicit disconnect event) | Emits `disconnected` event | OK (Slack is actually better here) |

### isConnected() / getState()

| Aspect | Discord | Slack | Change Needed |
|--------|---------|-------|---------------|
| isConnected | `status === 'connected' && client !== null` | `status === 'connected'` | Minor - Slack should also check `app !== null` |
| State shape | Includes `rateLimits`, `messageStats`, `botUser` with discriminator | Includes `messageStats`, `botUser` without discriminator | **MISSING**: Should track rate limits (or equivalent) |

---

## 4. Session Management

### Architecture

| Aspect | Discord | Slack | Notes |
|--------|---------|-------|-------|
| Key type | `channelId` (string) | `threadTs` (string) | Correct - Slack threads are the conversation unit |
| Extra field | None | `channelId` stored with each session | Correct - needed to know which channel a thread belongs to |
| Storage path | `.herdctl/discord-sessions/<agent>.yaml` | `.herdctl/slack-sessions/<agent>.yaml` | Correct |
| Schema | `DiscordSessionStateSchema` with `channels` map | `SlackSessionStateSchema` with `threads` map | Correct |
| Session ID format | `discord-<agent>-<uuid>` | `slack-<agent>-<uuid>` | Correct |
| Interface | `ISessionManager` | `ISessionManager` (different) | OK - different signatures justified |

### Implementation Quality

Both session managers are nearly identical in implementation quality. They share:
- Atomic writes with temp file + rename
- YAML persistence with Zod validation
- In-memory caching
- Expiry-based cleanup
- Retry logic for Windows rename operations
- Same error classes (SessionStateReadError, etc.)

**Verdict: Session management is well-aligned. No significant changes needed.**

---

## 5. Message Handling

### Discord's Approach (mention-handler.ts + auto-mode-handler.ts)

Discord has a rich message handling pipeline:

1. **`isBotMentioned()`** - Checks both user mentions AND role mentions
2. **`shouldProcessMessage()`** - Takes `Message`, `botUserId`, `mode` and filters
3. **`stripBotMention()`** / `stripBotRoleMentions()` - Cleans prompt text
4. **`buildConversationContext()`** - Fetches message history from channel, builds `ConversationContext` with:
   - `messages: ContextMessage[]` (processed history with author info)
   - `prompt: string` (cleaned trigger message)
   - `wasMentioned: boolean`
5. **`formatContextForPrompt()`** - Formats context for Claude
6. **Auto-mode handler** - `resolveChannelConfig()`, `checkDMUserFilter()`, DM allowlist/blocklist

### Slack's Approach (message-handler.ts)

Slack has a minimal message handler:

1. **`isBotMentioned()`** - Simple string check for `<@BOTID>`
2. **`shouldProcessMessage()`** - Checks `bot_id`, `subtype`, `user` fields
3. **`stripBotMention()`** / `stripMentions()` - Cleans prompt text
4. **`processMessage()`** - Just strips mention and trims

### Missing from Slack

| Feature | Discord Has | Slack Has | Priority |
|---------|-------------|-----------|----------|
| Conversation context building | `buildConversationContext()` with history fetch | None | **HIGH** - Critical for quality responses |
| `ConversationContext` type | Full type with messages array, prompt, wasMentioned | None | **HIGH** |
| `ContextMessage` type | Rich type with authorId, authorName, isBot, isSelf, content, timestamp | None | **HIGH** |
| Context formatting for prompt | `formatContextForPrompt()` | None | **MEDIUM** |
| Role mention detection | `stripBotRoleMentions()` | N/A (Slack doesn't have role mentions) | Not needed |
| Message event includes context | `context: ConversationContext` in message event | Not included | **HIGH** |

**Note:** Conversation context building in Slack would use the Slack Web API to fetch thread history (via `conversations.replies`), which is different from Discord's `channel.messages.fetch()`. The concept is the same but the implementation differs.

### Required Changes

1. Add conversation context building to Slack (fetch thread history via Slack API)
2. Add `ConversationContext` and `ContextMessage` types to Slack
3. Include context in the `SlackMessageEvent` payload
4. Add `formatContextForPrompt()` equivalent

---

## 6. Streaming Responses

### Discord Manager's StreamingResponder

Located in `packages/core/src/fleet-manager/discord-manager.ts`:

```typescript
class StreamingResponder {
  private buffer: string = "";
  private lastSendTime: number = 0;
  private messagesSent: number = 0;
  // ... rate limiting, split support
  async addMessageAndSend(content: string): Promise<void>
  async flush(): Promise<void>
  hasSentMessages(): boolean
}
```

### Slack Manager's StreamingResponder

Located in `packages/core/src/fleet-manager/slack-manager.ts`:

Nearly identical implementation. The only differences:
- `maxBufferSize` default: Discord = 1500, Slack = 3500 (Slack has higher message limits)
- Log messages say "Slack" instead of "Discord"

**Verdict: Well-aligned. The differences are correct platform adaptations.**

---

## 7. Commands

### Discord: Slash Commands via REST API

| Aspect | Details |
|--------|---------|
| Registration | `CommandManager.registerCommands()` uses Discord REST API to register global application commands |
| Command type | `SlashCommand` interface with `name`, `description`, `execute(context)` |
| Context type | `CommandContext` with `interaction: ChatInputCommandInteraction`, `client`, `agentName`, `sessionManager`, `connectorState` |
| Integration | `CommandManager` instantiated in connector's `_initializeCommands()`, called from `_handleInteraction()` |
| Error handling | Uses `ErrorHandler` with retry logic for registration; ephemeral error replies |
| Reply mechanism | `interaction.reply({ content, ephemeral: true })` |
| Built-in commands | `/help`, `/reset`, `/status` |

### Slack: Prefix Commands (! prefix)

| Aspect | Details |
|--------|---------|
| Registration | `CommandHandler.registerCommand()` - in-memory only, no API registration |
| Command type | `PrefixCommand` interface with `name`, `description`, `execute(context)` |
| Context type | `CommandContext` with `agentName`, `threadTs`, `channelId`, `userId`, `reply`, `sessionManager`, `connectorState` |
| Integration | **NOT INTEGRATED** - `CommandHandler` exists but is never instantiated or called from `SlackConnector` |
| Error handling | Basic try/catch in `executeCommand()` |
| Reply mechanism | `reply(content)` function (posts to thread) |
| Built-in commands | `!help`, `!reset`, `!status` |

### Required Changes

| Change | Priority |
|--------|----------|
| **Wire CommandHandler into SlackConnector** - Create instance, register built-in commands, check messages for commands before emitting message events | **CRITICAL** |
| Add error handler integration to CommandHandler | **HIGH** |
| Consider using Slack slash commands instead of prefix commands (future) | **LOW** - prefix commands work for MVP |

---

## 8. Auto Mode / Mention Mode

### Discord

Discord has a sophisticated channel mode system:
- `auto-mode-handler.ts` with `resolveChannelConfig()` to determine mode per channel
- DM filtering with allowlist/blocklist via `checkDMUserFilter()`
- Each guild channel has configurable `mode: "mention" | "auto"`
- DMs default to `auto` mode

### Slack

Slack does not have an auto-mode system. Instead:
- `app_mention` events handle @mentions (always processed)
- `message` events handle thread replies (always processed if in active thread)
- Channel routing is via `channelAgentMap` (configured channels only)
- No DM support

### Assessment

**Slack does NOT need Discord's auto-mode handler.** The platform differences justify a different approach:
- Slack's `app_mention` event is the natural equivalent of Discord's mention mode
- Slack threads provide natural conversation scoping (no need for auto mode per channel)
- Slack DMs could be added later with a simpler model

**No changes needed for mode handling.**

---

## 9. FleetManager Integration

### Discord Manager (core)

```typescript
class DiscordManager {
  private connectors: Map<string, IDiscordConnector> = new Map();
  // N connectors, one per agent
  async initialize(): Promise<void>  // Creates connectors
  async start(): Promise<void>       // Connects all, subscribes to events
  async stop(): Promise<void>        // Disconnects all, logs session stats
  getConnector(agentName): IDiscordConnector | undefined
  getConnectorNames(): string[]
  getConnectedCount(): number
  hasConnector(agentName): boolean
  private handleMessage(agentName, event): Promise<void>
  private handleError(agentName, error): void
  // Response formatting
  formatErrorMessage(error): string
  splitResponse(text): string[]
  sendResponse(reply, content): Promise<void>
}
```

### Slack Manager (core)

```typescript
class SlackManager {
  private connector: ISlackConnector | null = null;
  // 1 connector, shared across all agents
  private sessionManagers: Map<string, ISlackSessionManager> = new Map();
  private channelAgentMap: Map<string, string> = new Map();
  async initialize(): Promise<void>  // Creates connector with channel map
  async start(): Promise<void>       // Connects, subscribes
  async stop(): Promise<void>        // Disconnects, logs session stats
  getConnector(): ISlackConnector | null
  isConnected(): boolean
  getState(): SlackConnectorState | null
  getChannelAgentMap(): Map<string, string>
  hasAgent(agentName): boolean
  private handleMessage(agentName, event): Promise<void>
  private handleError(agentName, error): void
  // Response formatting
  formatErrorMessage(error): string
  splitResponse(text): string[]
}
```

### Comparison

| Aspect | Discord Manager | Slack Manager | Notes |
|--------|----------------|---------------|-------|
| Connector storage | `Map<string, IDiscordConnector>` | Single `ISlackConnector \| null` | Correct for platform |
| Session manager access | Via `connector.sessionManager` property | Via `sessionManagers` Map | Correct - Slack has multiple session managers, one connector |
| Message handling pipeline | Gets session, creates StreamingResponder, triggers job, stores session | Same pipeline | Well-aligned |
| Error formatting | `formatErrorMessage()` uses Discord markdown (`**bold**`) | Uses Slack mrkdwn (`*bold*`) | Correct |
| Split response | Has code block analysis (`analyzeCodeBlocks()`) | Simple natural break splitting | **MISSING**: Slack should preserve code blocks across splits |
| `sendResponse()` method | Has standalone `sendResponse()` | Missing | **MINOR**: Could add for parity |
| Event emission | `discord:message:handled`, `discord:message:error`, `discord:error` | `slack:message:handled`, `slack:message:error`, `slack:error` | Well-aligned |
| Dynamic import | `importDiscordPackage()` | `importSlackPackage()` | Same pattern |

### Required Changes

1. **Add code block preservation to `splitResponse()`** in SlackManager (copy `analyzeCodeBlocks` and `findSplitPoint` logic from DiscordManager)
2. **Add `sendResponse()` convenience method** to SlackManager for parity

---

## 10. Configuration Schema

### Discord Schema (in core/config/schema.ts)

```typescript
AgentChatDiscordSchema = z.object({
  bot_token_env: z.string(),
  session_expiry_hours: z.number().default(24),
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),
  presence: DiscordPresenceSchema.optional(),
  guilds: z.array(DiscordGuildSchema),     // Required
  dm: DiscordDMSchema.optional(),
})

DiscordGuildSchema = z.object({
  id: z.string(),
  channels: z.array(DiscordChannelSchema).optional(),
  dm: DiscordDMSchema.optional(),
})

DiscordChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mode: z.enum(["mention", "auto"]).default("mention"),
  context_messages: z.number().default(10),
})
```

### Slack Schema (in core/config/schema.ts)

```typescript
AgentChatSlackSchema = z.object({
  bot_token_env: z.string().default("SLACK_BOT_TOKEN"),
  app_token_env: z.string().default("SLACK_APP_TOKEN"),
  session_expiry_hours: z.number().default(24),
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),
  channels: z.array(SlackChannelSchema),   // Required
})

SlackChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
})
```

### Comparison

| Aspect | Discord | Slack | Change Needed |
|--------|---------|-------|---------------|
| Token env vars | `bot_token_env` (required, no default) | `bot_token_env` + `app_token_env` (with defaults) | OK - Slack needs two tokens for Socket Mode |
| Session expiry | `session_expiry_hours` with default 24 | Same | Aligned |
| Log level | 3-level enum with default "standard" | Same | Aligned |
| Channel mode | `mode: "mention" \| "auto"` per channel | No mode | **CONSIDER**: Adding mode per channel (future) |
| Context messages | `context_messages` per channel | Not present | **CONSIDER**: Adding context_messages setting |
| Guilds hierarchy | `guilds > channels` (Discord's server model) | Flat `channels` | Correct for platform |
| DMs | Configurable DM with allowlist/blocklist | Not supported | Future enhancement |
| Presence | Activity type + message | Not supported | N/A (Slack doesn't have this concept) |

**Verdict: Schema is well-aligned for the platform differences. No critical changes needed.**

---

## 11. Types and Events

### Discord Event Map

```typescript
interface DiscordConnectorEventMap {
  ready:            { agentName, botUser }
  disconnect:       { agentName, code, reason }
  error:            { agentName, error: Error }
  reconnecting:     { agentName, attempt }
  reconnected:      { agentName }
  message:          { agentName, prompt, context, metadata, reply, startTyping }
  messageIgnored:   { agentName, reason, channelId, messageId }
  commandExecuted:  { agentName, commandName, userId, channelId }
  sessionLifecycle: { agentName, event, channelId, sessionId }
  rateLimit:        { agentName, timeToReset, limit, method, hash, route, global }
}

// Type-safe emit/on/once/off overrides on the class
```

### Slack Event Map

```typescript
interface SlackConnectorEventMap {
  message:      [payload: SlackMessageEvent];
  error:        [payload: SlackErrorEvent];
  connected:    [];
  disconnected: [];
}

// NO type-safe emit/on/once/off overrides
```

### Differences

| Aspect | Discord | Slack | Change Needed |
|--------|---------|-------|---------------|
| Event map syntax | Object values (each is a payload type) | Tuple values (array syntax) | **FIX**: Use Discord's object syntax for consistency |
| `ready` event | Typed with bot user info | `connected` (no payload) | **FIX**: Rename to `ready` with bot user payload |
| `disconnect` event | Typed with code and reason | `disconnected` (no payload) | **FIX**: Add payload |
| `reconnecting` event | Typed with attempt number | Missing | **ADD** |
| `reconnected` event | Typed | Missing | **ADD** |
| `messageIgnored` event | Typed with reason and IDs | Missing | **ADD** |
| `commandExecuted` event | Typed | Missing | **ADD** (once commands are wired in) |
| `sessionLifecycle` event | Typed with event type | Missing | **ADD** |
| `rateLimit` event | Typed with full rate limit info | Missing | **CONSIDER**: Slack's rate limiting is different |
| Type-safe emitter | Overrides `emit`, `on`, `once`, `off` | None | **ADD**: Type-safe event emitter overrides |
| Message event payload | Includes `context: ConversationContext`, full metadata | Minimal metadata, no context | **FIX**: Add context and richer metadata |

### Message Event Comparison

**Discord `message` event metadata:**
```typescript
{
  guildId: string | null;
  channelId: string;
  messageId: string;
  userId: string;
  username: string;
  wasMentioned: boolean;
  mode: "mention" | "auto";
}
```

**Slack `message` event metadata:**
```typescript
{
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  wasMentioned: boolean;
}
```

**Missing from Slack's message metadata:** `username` field.

---

## 12. Error Handling

### Discord Error Handler (`error-handler.ts`)

Full-featured error handling infrastructure:

1. **`USER_ERROR_MESSAGES`** - Constant object with typed keys
2. **`ErrorCategory` enum** - TRANSIENT, PERMANENT, RATE_LIMIT, CONFIGURATION, UNKNOWN
3. **`ClassifiedError` interface** - error, category, userMessage, shouldRetry, retryDelayMs
4. **`classifyError()`** - Handles Discord errors, session errors, network errors, timeout errors
5. **`withRetry<T>()`** - Generic retry function with exponential backoff
6. **`ErrorHandler` class** - Stateful error handler with:
   - `handleError()` - logs and returns user message
   - `handleErrorWithMessage()` - custom user message
   - `getErrorStats()` - error count by category
   - `resetStats()`
   - `isRetryable()`
   - `getUserMessage()`
7. **`safeExecute()`** - Execute with error handler logging
8. **`safeExecuteWithReply()`** - Execute with error reply on failure

### Slack Error Handler (`error-handler.ts`)

Minimal implementation:

1. **`USER_ERROR_MESSAGES`** - Plain Record (not typed keys)
2. **`ErrorCategory` enum** - AUTH, RATE_LIMIT, NETWORK, API, INTERNAL, UNKNOWN (different categories)
3. **`ClassifiedError` interface** - category, userMessage, isRetryable, originalError (different field names)
4. **`classifyError()`** - Simple string matching on error messages
5. **`safeExecute()`** - Direct logger call (no ErrorHandler)
6. **`safeExecuteWithReply()`** - With reply function instead of ErrorHandler

### Missing from Slack

| Feature | Discord | Slack | Priority |
|---------|---------|-------|----------|
| `ErrorHandler` class | Full class with stats tracking | Missing | **HIGH** |
| `withRetry()` | Generic retry with backoff | Missing | **HIGH** |
| `RetryOptions` / `RetryResult` types | Full types | Missing | **HIGH** |
| Error count tracking | `Map<ErrorCategory, number>` | Missing | **MEDIUM** |
| Typed user message keys | `UserErrorMessageKey` type | Missing | **LOW** |
| `ClassifiedError.shouldRetry` | `shouldRetry` boolean | `isRetryable` (different name) | **FIX**: Rename to `shouldRetry` |
| `ClassifiedError.error` | `error: Error` field | `originalError: Error` (different name) | **FIX**: Rename to `error` |
| Session error classification | `classifySessionError()` | Missing | **MEDIUM** |
| Network error detection | `isNetworkError()` with comprehensive patterns | Simple string matching | **MEDIUM** |
| Timeout error detection | `isTimeoutError()` | Included in network check | **LOW** |

---

## 13. Logger

### Discord Logger

Full `DiscordLogger` class:
- Level-based filtering (verbose/standard/minimal)
- Content redaction for sensitive data
- Configurable prefix
- `createLoggerFromConfig()` factory
- `createDefaultDiscordLogger()` factory
- `getLogLevel()` and `isRedactionEnabled()` accessors

### Slack Logger

Factory functions only:
- `createSlackLogger()` - returns object with level filtering
- `createDefaultSlackLogger()` - default prefix

### Differences

| Feature | Discord | Slack | Priority |
|---------|---------|-------|----------|
| Logger class | `DiscordLogger` class | No class, factory only | **MEDIUM**: Consider adding class for consistency |
| Content redaction | `redactData()` for sensitive fields | Missing | **MEDIUM** |
| Log level introspection | `getLogLevel()`, `isRedactionEnabled()` | Not available | **LOW** |
| Factory from config | `createLoggerFromConfig(agentName, config)` | `createSlackLogger(options)` | OK - different but functional |

---

## 14. Formatting Utilities

### Discord (`utils/formatting.ts`)

- `DISCORD_MAX_MESSAGE_LENGTH = 2000`
- `splitMessage()` with boundary preservation
- `startTypingIndicator()` with auto-refresh interval
- `sendSplitMessage()` - sends with delays
- `sendWithTyping()` - typing + send combined
- `truncateMessage()`
- `formatCodeBlock()`
- `escapeMarkdown()`

### Slack (`formatting.ts`)

- `SLACK_MAX_MESSAGE_LENGTH = 4000`
- `splitMessage()` with boundary preservation (same algorithm)
- `markdownToMrkdwn()` - Slack-specific conversion
- `createContextAttachment()` - Slack-specific context UI
- `truncateMessage()`
- `formatCodeBlock()`
- `escapeMrkdwn()` - Slack-specific escaping

### Differences

| Feature | Discord | Slack | Notes |
|---------|---------|-------|-------|
| Max length | 2000 | 4000 | Correct per platform |
| Split algorithm | Same | Same | Well-aligned |
| Typing indicator | `startTypingIndicator()` | N/A (uses emoji reaction) | Correct per platform |
| Send utilities | `sendSplitMessage()`, `sendWithTyping()` | Missing | **LOW**: These are used in the connector package, Slack's reply function handles this differently |
| Markdown conversion | `escapeMarkdown()` | `markdownToMrkdwn()` + `escapeMrkdwn()` | Correct - Slack needs mrkdwn conversion |
| Context attachment | N/A | `createContextAttachment()` | Slack-specific feature, good |

**Verdict: Formatting utilities are well-adapted to each platform. Minor improvements possible but not blocking.**

---

## 15. Testing Patterns

### Discord Tests

Tests are organized per-module:
```
discord/src/__tests__/
  discord-connector.test.ts
  auto-mode-handler.test.ts
  error-handler.test.ts
  errors.test.ts
  logger.test.ts
  mention-handler.test.ts
commands/__tests__/
  command-manager.test.ts
  help.test.ts
  reset.test.ts
  status.test.ts
session-manager/__tests__/
  session-manager.test.ts
  errors.test.ts
  types.test.ts
utils/__tests__/
  formatting.test.ts
```

### Slack Tests

Tests are flat in one directory:
```
slack/src/__tests__/
  slack-connector.test.ts
  command-handler.test.ts
  error-handler.test.ts
  errors.test.ts
  formatting.test.ts
  logger.test.ts
  message-handler.test.ts
  session-manager.test.ts
```

### Assessment

Both have reasonable test coverage. The Slack tests are flatter but cover the same modules. This is acceptable and not a blocker.

---

## 16. Prioritized Change List

### Priority 1: CRITICAL (Must fix for merge)

1. **Wire CommandHandler into SlackConnector**
   - Create CommandHandler instance in constructor or connect()
   - Register built-in commands (help, reset, status)
   - In message handler, check if message is a command before emitting message event
   - Commands are defined but completely disconnected from the connector

2. **Add type-safe event emitter overrides**
   - Override `emit`, `on`, `once`, `off` with typed versions (copy Discord's pattern)
   - Fix event map to use Discord's object syntax instead of tuple syntax

3. **Add comprehensive event emission**
   - Rename `connected` -> emit `ready` event with bot user payload
   - Rename `disconnected` -> emit proper `disconnect` event
   - Add `messageIgnored` event emission when messages are filtered
   - Add `commandExecuted` event after command handling

### Priority 2: HIGH (Should fix for merge)

4. **Add ErrorHandler class to Slack**
   - Port Discord's `ErrorHandler` class with stat tracking
   - Port `withRetry()` utility
   - Use ErrorHandler in connector for message handling errors
   - Align `ClassifiedError` field names (`shouldRetry` not `isRetryable`, `error` not `originalError`)

5. **Add conversation context building**
   - Create `buildConversationContext()` using Slack's `conversations.replies` API
   - Add `ConversationContext` and `ContextMessage` types
   - Include context in `SlackMessageEvent` payload
   - This enables the agent to see conversation history, improving response quality

6. **Token validation in constructor**
   - Validate `botToken` and `appToken` are non-empty strings
   - Throw appropriate error classes

7. **Session cleanup on connect**
   - Call `cleanupExpiredSessions()` for all session managers after successful connection

8. **Add code block preservation to SlackManager.splitResponse()**
   - Port `analyzeCodeBlocks()` from DiscordManager
   - Close/reopen code blocks across chunk boundaries

### Priority 3: MEDIUM (Should fix, but not blocking)

9. **Add content redaction to Slack logger**
   - Port `redactData()` from Discord's logger
   - Consider promoting to a DiscordLogger-style class

10. **Add `username` to message event metadata**
    - Fetch user info from Slack API or include from event data

11. **Add `sessionLifecycle` event**
    - Emit when sessions are created, resumed, expired, or cleared
    - Allows FleetManager to track session state

12. **Improve error messages to include agent context**
    - `AlreadyConnectedError` should accept agent name or context
    - `SlackConnectionError` should include which agent failed

13. **Log message stats on disconnect**
    - Log received/sent/ignored counts (matches Discord pattern)

14. **Replace `any` types for Bolt internals**
    - Define minimal interfaces for `App`, `SayFn`, event types
    - Move inline `AppMentionEvent`/`MessageEvent`/`SayFn` to types.ts

### Priority 4: LOW (Nice to have)

15. **Add `reconnecting`/`reconnected` events**
    - Slack Bolt handles reconnection internally
    - Could listen for Bolt's reconnection events and proxy them

16. **Consider `DiscordLogger`-style class for Slack**
    - Adds `getLogLevel()` and `isRedactionEnabled()` introspection
    - Not strictly needed for MVP

17. **Add per-command tests (matching Discord's pattern)**
    - Individual test files for help, reset, status commands

18. **Add `sendResponse()` method to SlackManager**
    - Convenience method matching DiscordManager's API

---

## 17. Areas Where Slack Should Differ from Discord

These are intentional and correct divergences that should NOT be changed:

### 1. Single Connector vs N Connectors

**Discord:** N connectors, one per agent (each agent has its own bot token and identity)
**Slack:** 1 connector shared across all agents (one bot token per workspace)

**Justification:** This is a fundamental platform difference. Slack uses a single app per workspace with one bot token. Discord supports multiple bot applications. The shared connector with channel-to-agent routing is the correct architecture for Slack.

### 2. Thread-Based vs Channel-Based Sessions

**Discord:** Sessions keyed by `channelId`
**Slack:** Sessions keyed by `threadTs`

**Justification:** Slack conversations naturally occur in threads. Each thread is a separate conversation context. Discord conversations happen in channels. This is a core platform difference.

### 3. Prefix Commands vs Slash Commands

**Discord:** Discord slash commands registered via REST API
**Slack:** Message prefix commands (`!reset`, `!status`)

**Justification:** Slack slash commands require URL verification and a public endpoint, which conflicts with Socket Mode. Prefix commands are simpler and work with Socket Mode. For MVP, this is the right choice. Future: Could switch to Slack's `app.command()` handler.

### 4. Emoji Reaction vs Typing Indicator

**Discord:** Typing indicator (refreshed every 8 seconds)
**Slack:** Hourglass emoji reaction on the trigger message

**Justification:** Slack's typing indicator API is less reliable in threads. The hourglass emoji reaction is a clearer signal in Slack's UI that the bot is processing, and it's automatically removed when done.

### 5. Formatting: Markdown vs mrkdwn

**Discord:** Standard Markdown (`**bold**`, `[text](url)`)
**Slack:** mrkdwn format (`*bold*`, `<url|text>`)

**Justification:** Platform-specific markup languages. The `markdownToMrkdwn()` converter is a correct adaptation.

### 6. Message Length Limits

**Discord:** 2000 characters hard limit
**Slack:** ~4000 characters practical limit (hard limit is ~40K)

**Justification:** Different platform constraints.

### 7. ConnectorOptions Shape

**Discord:** Takes `agentConfig`, `discordConfig`, `botToken`, `fleetManager`, `sessionManager`
**Slack:** Takes `botToken`, `appToken`, `channelAgentMap`, `sessionManagers`

**Justification:** Slack doesn't receive per-agent config because it's a shared connector. Instead it receives the routing map and all session managers.

### 8. No Auto-Mode Handler

**Discord:** Has `auto-mode-handler.ts` for DM filtering, channel mode resolution
**Slack:** No equivalent

**Justification:** Slack's event model (app_mention + message events) naturally separates mention-triggered vs thread-reply messages. The routing is handled by the `channelAgentMap` and `activeThreads` map. No separate mode handler is needed.

---

## Summary

The Slack connector is structurally sound but has several gaps relative to the Discord connector's maturity. The most critical issues are:

1. **Commands are defined but never wired in** (dead code)
2. **Missing type-safe event system** (the core contract with FleetManager)
3. **Missing ErrorHandler class** (error recovery and user experience)
4. **Missing conversation context** (response quality)

Addressing Priority 1 and 2 items would make the Slack PR mergeable. Priority 3 and 4 items can be follow-up work.
