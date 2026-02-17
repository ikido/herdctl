# WEA-59: Enhanced !status Command with Context Window Tracking

## Overview

Enhance the `!status` command in Slack/Discord chat to show comprehensive session information including context window usage, git workspace state, and agent configuration. This provides users with visibility into how much context remains before the agent hits limits or needs a handoff.

**Linear Issue:** [WEA-59](https://linear.app/wearevolt/issue/WEA-59/show-remaining-context-and-session-details-in-status-command)
**Status:** In Progress
**Priority:** 3 (Normal)

## Problem Statement

The current `!status` command provides only minimal information:
- Connection status
- Bot username and uptime
- Session ID (truncated)
- Last activity timestamp

Users have **no visibility** into:
- How much context window remains (critical for long conversations)
- What model is being used
- What permissions the agent has
- What MCP servers are available
- Git workspace state (branch, uncommitted changes)
- Number of messages in the conversation

This makes it difficult to know when:
- The agent is approaching context limits (~95% triggers auto-compact)
- A session handoff might be needed
- The agent might start "forgetting" earlier context

## Goals

### Primary Goals
1. Show context window usage (tokens used/total, percentage remaining)
2. Display session metadata (ID, duration, message count)
3. Show agent configuration (model, permissions, MCP servers)
4. Display git workspace state when available

### Secondary Goals
1. Maintain backwards compatibility with existing status command
2. Support both Slack and Discord connectors
3. Format output appropriately for each platform (mrkdwn vs markdown)
4. Provide actionable information (e.g., "approaching limit" warnings)

### Non-Goals
- **NOT** implementing automatic context handoff (that's WEA-22)
- **NOT** showing context usage after every message (that's WEA-58)
- **NOT** implementing worktree strategy (WEA-21 handles that)

## Current Architecture

### Status Command Implementation

**Location:** `packages/slack/src/commands/status.ts`

```typescript
export const statusCommand: PrefixCommand = {
  name: "status",
  description: "Show agent status and connection info",

  async execute(context: CommandContext): Promise<void> {
    const { agentName, channelId, connectorState, sessionManager, reply } = context;

    // Current implementation:
    // 1. Gets session info from sessionManager
    // 2. Formats connection status, uptime
    // 3. Shows session ID and last activity
    // 4. Sends reply
  }
};
```

**CommandContext Interface:**
```typescript
export interface CommandContext {
  agentName: string;
  channelId: string;
  userId: string;
  reply: (content: string) => Promise<void>;
  sessionManager: ISlackSessionManager;
  connectorState: SlackConnectorState;
}
```

### Session Manager

**Location:** `packages/slack/src/session-manager/session-manager.ts`

The `SessionManager` currently tracks:
- Channel ID → Session ID mapping
- Last message timestamp per channel
- Session expiry (default 24 hours)

**Session State Structure:**
```yaml
# .herdctl/slack-sessions/<agent-name>.yaml
version: 2
agentName: developer
channels:
  C1234567890:
    sessionId: "sdk-session-abc123..."
    lastMessageAt: "2026-02-17T12:00:00Z"
```

**Missing:**
- Context token tracking
- Message count
- Session start time (can infer from first message timestamp)
- Model information
- Agent configuration snapshot

### SDK Message Flow

**Location:** `packages/core/src/runner/types.ts`

SDK messages include usage information in specific message types:

```typescript
export interface SDKMessage {
  type: "system" | "assistant" | "stream_event" | "result" | "user" | ...
  subtype?: string;
  content?: string;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  // ... other fields
}
```

**Key Message Types:**
- `assistant`: Complete assistant responses (has usage data)
- `result`: Final result summary (has cumulative usage)
- `system` with `subtype: "init"`: Session initialization (has session_id)

### Slack Manager Integration

**Location:** `packages/core/src/fleet-manager/slack-manager.ts`

The `SlackManager`:
1. Creates one `SlackConnector` instance per workspace
2. Maintains channel → agent routing
3. Handles `message` events and triggers agent execution
4. Manages session lifecycle via `SessionManager`

**Message Handler Flow:**
```typescript
connector.on("message", async (payload: SlackMessageEvent) => {
  // 1. Get or create session
  const { sessionId, isNew } = await sessionManager.getOrCreateSession(channelId);

  // 2. Trigger agent execution
  await context.trigger({
    agent: agentName,
    prompt: payload.prompt,
    resume: isNew ? undefined : sessionId,
    triggerType: "slack-chat",
    onMessage: async (message) => {
      // Process SDK messages, send to Slack
    },
    injectedMcpServers: { ... }
  });
});
```

## Proposed Solution

### Architecture Changes

#### 1. Extend SessionManager State

**New Session State Structure:**
```yaml
# .herdctl/slack-sessions/<agent-name>.yaml
version: 3  # Bump version for migration
agentName: developer
channels:
  C1234567890:
    sessionId: "sdk-session-abc123..."
    sessionStartedAt: "2026-02-17T12:00:00Z"  # NEW
    lastMessageAt: "2026-02-17T14:30:00Z"
    messageCount: 18  # NEW
    contextUsage:  # NEW
      inputTokens: 45234
      outputTokens: 12500
      totalTokens: 57734
      contextWindow: 200000
      lastUpdated: "2026-02-17T14:30:00Z"
    agentConfig:  # NEW (snapshot)
      model: "claude-sonnet-4"
      permissionMode: "bypassPermissions"
      mcpServers: ["linear-mcp", "perplexity"]
```

**SessionManager Interface Updates:**
```typescript
interface ISlackSessionManager {
  // Existing methods
  getOrCreateSession(channelId: string): Promise<SessionResult>;
  getSession(channelId: string): Promise<ChannelSession | null>;
  touchSession(channelId: string): Promise<void>;

  // NEW methods
  updateContextUsage(
    channelId: string,
    usage: { inputTokens: number; outputTokens: number; contextWindow: number }
  ): Promise<void>;

  incrementMessageCount(channelId: string): Promise<void>;

  setAgentConfig(
    channelId: string,
    config: { model: string; permissionMode: string; mcpServers: string[] }
  ): Promise<void>;
}
```

#### 2. Track Context Usage in Message Handler

**Location:** `packages/core/src/fleet-manager/slack-manager.ts`

Modify the `onMessage` callback to track context usage:

```typescript
onMessage: async (message: SDKMessage) => {
  // Track context usage from assistant messages
  if (message.type === "assistant" && message.usage) {
    await sessionManager.updateContextUsage(channelId, {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      contextWindow: message.contextWindow ?? 200000,
    });
  }

  // Increment message count for all assistant messages
  if (message.type === "assistant") {
    await sessionManager.incrementMessageCount(channelId);
  }

  // ... existing message handling
}
```

**Note:** The SDK provides `input_tokens` and `output_tokens` in usage, and `contextWindow` may be available in the message. Need to verify SDK message structure.

#### 3. Extend CommandContext

**Location:** `packages/slack/src/commands/command-handler.ts`

Add agent configuration to CommandContext:

```typescript
export interface CommandContext {
  agentName: string;
  channelId: string;
  userId: string;
  reply: (content: string) => Promise<void>;
  sessionManager: ISlackSessionManager;
  connectorState: SlackConnectorState;

  // NEW: Agent configuration snapshot
  agentConfig?: {
    model: string;
    permissionMode: string;
    mcpServers: string[];
    workingDirectory?: string;
  };
}
```

This will be populated by `SlackManager` when building the command context.

#### 4. Enhance Status Command

**Location:** `packages/slack/src/commands/status.ts`

Major rewrite to show all new information:

```typescript
export const statusCommand: PrefixCommand = {
  name: "status",
  description: "Show agent status and context window usage",

  async execute(context: CommandContext): Promise<void> {
    const { agentName, channelId, connectorState, sessionManager, agentConfig, reply } = context;

    // Get enhanced session info
    const session = await sessionManager.getSession(channelId);

    if (!session) {
      await reply("No active session in this channel.");
      return;
    }

    // Build comprehensive status message
    let message = `📊 *${agentName} Status*\n\n`;

    // 1. Connection Status (existing)
    message += `*Connection*\n`;
    message += `${getStatusEmoji(connectorState.status)} ${connectorState.status}\n`;
    message += `Bot: ${connectorState.botUser?.username ?? "Unknown"}\n`;
    if (connectorState.connectedAt) {
      message += `Uptime: ${formatDuration(connectorState.connectedAt)}\n`;
    }

    // 2. Session Info (enhanced)
    message += `\n*Session*\n`;
    message += `ID: \`${session.sessionId.substring(0, 20)}...\`\n`;
    message += `Started: ${formatTimestamp(session.sessionStartedAt)}\n`;
    message += `Duration: ${formatDuration(session.sessionStartedAt)}\n`;
    message += `Messages: ${session.messageCount}\n`;

    // 3. Context Window (NEW)
    if (session.contextUsage) {
      message += `\n*Context Window*\n`;
      const { totalTokens, contextWindow } = session.contextUsage;
      const percentUsed = Math.round((totalTokens / contextWindow) * 100);
      const percentRemaining = 100 - percentUsed;

      message += `${totalTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens\n`;
      message += `${percentRemaining}% remaining\n`;

      // Warnings
      if (percentUsed >= 95) {
        message += `⚠️ *CRITICAL:* Auto-compact imminent\n`;
      } else if (percentUsed >= 90) {
        message += `⚠️ *WARNING:* Approaching context limit\n`;
      } else if (percentUsed >= 75) {
        message += `ℹ️ Context filling up\n`;
      }

      message += `Last updated: ${formatTimestamp(session.contextUsage.lastUpdated)}\n`;
    }

    // 4. Workspace (NEW, if available)
    if (agentConfig?.workingDirectory) {
      message += `\n*Workspace*\n`;

      // Try to get git branch (optional, may fail)
      try {
        const gitBranch = await getGitBranch(agentConfig.workingDirectory);
        message += `Branch: \`${gitBranch}\`\n`;

        const uncommittedCount = await getUncommittedChangesCount(agentConfig.workingDirectory);
        if (uncommittedCount > 0) {
          message += `Uncommitted changes: ${uncommittedCount}\n`;
        }
      } catch {
        // Git info unavailable, skip
      }

      message += `Path: ${agentConfig.workingDirectory}\n`;
    }

    // 5. Configuration (NEW)
    if (session.agentConfig) {
      message += `\n*Configuration*\n`;
      message += `Model: ${session.agentConfig.model}\n`;
      message += `Permissions: ${session.agentConfig.permissionMode}\n`;
      if (session.agentConfig.mcpServers.length > 0) {
        message += `MCP Servers: ${session.agentConfig.mcpServers.join(", ")}\n`;
      }
    }

    await reply(message);
  }
};
```

**Helper Functions to Add:**
```typescript
async function getGitBranch(workingDirectory: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
    cwd: workingDirectory,
  });
  return stdout.trim();
}

async function getUncommittedChangesCount(workingDirectory: string): Promise<number> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: workingDirectory,
  });
  return stdout.trim().split("\n").filter(line => line.length > 0).length;
}
```

## Implementation Plan

### Phase 1: Session State Enhancement (Core)

**Files:**
- `packages/slack/src/session-manager/types.ts` — Update interfaces
- `packages/slack/src/session-manager/session-manager.ts` — Add new methods
- `packages/discord/src/session-manager/types.ts` — Mirror changes for Discord

**Tasks:**
1. Update `ChannelSession` interface to include:
   - `sessionStartedAt`
   - `messageCount`
   - `contextUsage`
   - `agentConfig`
2. Implement `updateContextUsage()` method
3. Implement `incrementMessageCount()` method
4. Implement `setAgentConfig()` method
5. Handle version migration (v2 → v3 state file format)
6. Update unit tests

**Estimated:** 3-4 hours

### Phase 2: Context Tracking in Message Handler

**Files:**
- `packages/core/src/fleet-manager/slack-manager.ts`
- `packages/core/src/fleet-manager/discord-manager.ts` (for parity)

**Tasks:**
1. Modify `onMessage` callback to:
   - Extract usage data from SDK messages
   - Call `updateContextUsage()` on assistant messages
   - Call `incrementMessageCount()` on assistant messages
2. Capture agent config on session creation:
   - Model from `agent.model` or default
   - Permission mode from `agent.permission_mode`
   - MCP server list from `agent.mcp_servers`
3. Call `setAgentConfig()` when initializing session
4. Add integration tests

**Estimated:** 2-3 hours

### Phase 3: Enhanced Status Command

**Files:**
- `packages/slack/src/commands/status.ts`
- `packages/slack/src/commands/command-handler.ts` (update CommandContext)

**Tasks:**
1. Update `CommandContext` to include `agentConfig`
2. Rewrite status command with new sections:
   - Connection (existing, minor tweaks)
   - Session (enhanced with duration, message count)
   - Context Window (new)
   - Workspace (new, optional)
   - Configuration (new)
3. Add helper functions for git status
4. Add formatting utilities:
   - `formatTokenCount()` — Format large numbers with commas
   - `getContextWarningEmoji()` — Return emoji based on usage %
5. Handle missing data gracefully (legacy sessions)
6. Update unit tests

**Estimated:** 3-4 hours

### Phase 4: Discord Parity

**Files:**
- `packages/discord/src/commands/status.ts`

**Tasks:**
1. Mirror all changes from Slack status command
2. Adjust formatting for Discord markdown (vs Slack mrkdwn)
3. Ensure Discord session manager has same capabilities
4. Add integration tests

**Estimated:** 2 hours

### Phase 5: Documentation & Testing

**Files:**
- `docs/src/content/docs/concepts/sessions.md` — Update with context tracking
- `README.md` examples — Show enhanced status output
- Integration tests

**Tasks:**
1. Update documentation to describe enhanced status command
2. Add screenshots/examples of new output
3. Write integration test that:
   - Sends multiple messages
   - Calls `!status`
   - Verifies all sections are present
4. Update CHANGELOG / create changeset

**Estimated:** 2 hours

## Data Flow

### Session Initialization
```
User sends message in Slack
  ↓
SlackConnector emits "message" event
  ↓
SlackManager handles event
  ↓
SessionManager.getOrCreateSession(channelId)
  ↓
If new session:
  - Generate sessionId
  - Set sessionStartedAt = now
  - Set messageCount = 0
  - Store agentConfig snapshot
  ↓
Trigger agent execution with sessionId
```

### Context Usage Tracking
```
Agent execution starts (SDK runtime)
  ↓
SDK sends messages (assistant, system, etc.)
  ↓
onMessage callback receives SDKMessage
  ↓
If message.type === "assistant" && message.usage:
  - Extract input_tokens, output_tokens
  - Extract contextWindow (or use default)
  - Calculate totalTokens
  - SessionManager.updateContextUsage(channelId, usage)
  - SessionManager.incrementMessageCount(channelId)
  ↓
Session state updated on disk (.herdctl/slack-sessions/<agent>.yaml)
```

### Status Command Execution
```
User sends "!status" in Slack
  ↓
CommandHandler detects command
  ↓
Execute statusCommand.execute(context)
  ↓
SessionManager.getSession(channelId)
  ↓
Read enhanced session state:
  - sessionId, sessionStartedAt, messageCount
  - contextUsage (tokens, percentage)
  - agentConfig (model, permissions, MCP servers)
  ↓
Query git status (if workingDirectory available):
  - git branch --show-current
  - git status --porcelain | wc -l
  ↓
Format comprehensive status message
  ↓
Send reply to Slack channel
```

## Edge Cases & Considerations

### 1. Legacy Sessions (v2 State Files)
**Problem:** Existing sessions don't have new fields
**Solution:** Handle gracefully, show "N/A" or omit sections
**Migration:** On first write after upgrade, migrate v2 → v3

### 2. Missing Context Window Info
**Problem:** SDK might not always provide `contextWindow`
**Solution:** Use model-based defaults:
- Sonnet 4: 200,000 tokens
- Opus 4: 200,000 tokens
- Haiku 4: 200,000 tokens

### 3. Git Info Unavailable
**Problem:** Working directory might not be a git repo, or git command fails
**Solution:** Wrap in try/catch, skip workspace section if unavailable

### 4. Long-Running Sessions
**Problem:** Very old sessions might have stale context usage data
**Solution:** Show `lastUpdated` timestamp, add warning if > 1 hour old

### 5. Session Handoffs (Future)
**Problem:** When WEA-22 is implemented, sessions will be replaced
**Solution:** Design state format to support handoff history (future extension)

### 6. Docker vs SDK Runtime
**Problem:** Docker runtime might not expose same message structure
**Solution:** Ensure message processor normalizes usage data across runtimes

### 7. Message Count Accuracy
**Problem:** Message count might drift if tracking fails
**Solution:** Count is best-effort; not critical for functionality

### 8. Context Window After Auto-Compact
**Problem:** SDK auto-compacts at ~95%, usage might drop suddenly
**Solution:** Show "Context compacted" message when usage drops >50% between updates

## Testing Strategy

### Unit Tests

**SessionManager:**
- `updateContextUsage()` stores data correctly
- `incrementMessageCount()` increments properly
- `setAgentConfig()` stores config snapshot
- Version migration v2 → v3 works
- Missing fields handled gracefully

**Status Command:**
- Formats all sections correctly
- Handles missing data (legacy sessions)
- Shows warnings at correct thresholds (75%, 90%, 95%)
- Git helper functions handle errors

### Integration Tests

**End-to-End Flow:**
1. Start agent with Slack chat enabled
2. Send 3-4 messages (build up context)
3. Call `!status`
4. Verify response includes:
   - Session info with message count
   - Context usage with percentage
   - Agent config
5. Send more messages (cross 75% threshold if possible)
6. Call `!status` again
7. Verify warning appears

**Docker Runtime:**
1. Run agent in Docker mode
2. Verify context tracking still works
3. Verify status command shows correct info

### Manual Testing Checklist

- [ ] New session shows all sections
- [ ] Context usage updates after each message
- [ ] Percentage calculation is accurate
- [ ] Warnings appear at 75%, 90%, 95%
- [ ] Git info shows current branch
- [ ] Uncommitted changes count is accurate
- [ ] Works in both Slack and Discord
- [ ] Legacy sessions (v2) don't crash

