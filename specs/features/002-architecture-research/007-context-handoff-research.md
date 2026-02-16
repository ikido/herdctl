# 007: Automatic Context Window Handoff Research

## Summary

When an agent's context window fills up during execution, herdctl should automatically detect this, trigger a handoff (creating a summary document of the current state), start a new session with that handoff document as the initial prompt, and replace the session ID in the running JobExecutor so work continues seamlessly.

This document researches the current codebase architecture and proposes a concrete implementation plan.

---

## 1. Current Session Management in JobExecutor

### How session_id Flows

The session ID lifecycle in `JobExecutor.execute()` (`packages/core/src/runner/job-executor.ts`):

1. **Input**: `options.resume` provides an optional session ID to resume
2. **Validation (lines 210-319)**: The executor validates the session against disk state:
   - If the caller provides a session ID different from the agent-level session on disk, it trusts the caller (for per-thread Slack sessions)
   - If the IDs match, it validates working directory, runtime context, and expiry
   - Expired or invalid sessions are cleared; execution starts fresh
3. **Execution (lines 325-533)**: The `executeWithRetry()` inner function passes the session ID to `this.runtime.execute()` via `resumeSessionId`
4. **Extraction (lines 413-416)**: During message streaming, the executor extracts `sessionId` from processed messages:
   ```typescript
   if (processed.sessionId) {
     sessionId = processed.sessionId;
   }
   ```
   The session ID comes from `system` messages with `subtype: "init"` (see `message-processor.ts` line 113)
5. **Persistence (lines 596-626)**: After execution completes, the session ID is persisted to `.herdctl/sessions/<agent>.json` via `updateSessionInfo()`
6. **Return (line 638)**: The session ID is included in `RunnerResult.sessionId`

### Key Observation

The `sessionId` variable is a simple `let` binding in the `execute()` method scope. It is set once from the init message and never changes during execution. **For context handoff, we need to be able to replace this mid-execution.**

### Session Storage Structure

Agent-level sessions are stored at `.herdctl/sessions/<agent>.json`:

```json
{
  "agent_name": "my-agent",
  "session_id": "a1b2c3d4-...",
  "created_at": "2026-02-16T09:00:00Z",
  "last_used_at": "2026-02-16T10:30:00Z",
  "job_count": 5,
  "mode": "autonomous",
  "working_directory": "/path/to/workspace",
  "runtime_type": "sdk",
  "docker_enabled": false
}
```

Slack per-thread sessions are stored at `.herdctl/slack-sessions/<agent>.yaml`:

```yaml
version: 1
agentName: my-agent
threads:
  "1234567890.123456":
    sessionId: slack-my-agent-uuid
    lastMessageAt: "2026-02-16T10:30:00Z"
    channelId: C1234567
```

---

## 2. Available Token Usage Signals

### SDK Runtime: `SDKResultMessage` (from `@anthropic-ai/claude-agent-sdk` v0.1.77)

The `result` message (emitted at the end of a query) contains rich usage data:

```typescript
type SDKResultMessage = {
  type: 'result';
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | ...;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  usage: NonNullableUsage;    // Anthropic API usage object
  modelUsage: {
    [modelName: string]: ModelUsage;
  };
  // ...
};
```

The `ModelUsage` type is the critical piece:

```typescript
type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;        // <-- THE CONTEXT WINDOW SIZE
};
```

**This is the key signal**: `modelUsage[modelName].contextWindow` gives us the total context window size, and `inputTokens + outputTokens` gives us current usage.

### SDK Runtime: `SDKAssistantMessage`

Each assistant message includes per-message usage via `message.usage` (Anthropic API `BetaUsage`):

```typescript
type SDKAssistantMessage = {
  type: 'assistant';
  message: APIAssistantMessage;  // includes .usage with input_tokens, output_tokens
  // ...
};
```

The message processor already extracts this (lines 188-201 of `message-processor.ts`):

```typescript
const usage = (apiMessage?.usage ?? message.usage) as {
  input_tokens?: number;
  output_tokens?: number;
} | undefined;
```

### SDK Runtime: `SDKCompactBoundaryMessage`

Claude Code already has an auto-compaction mechanism. The SDK emits a `compact_boundary` system message:

```typescript
type SDKCompactBoundaryMessage = {
  type: 'system';
  subtype: 'compact_boundary';
  compact_metadata: {
    trigger: 'manual' | 'auto';
    pre_tokens: number;           // <-- Token count BEFORE compaction
  };
};
```

There is also a `PreCompact` hook event:

```typescript
type PreCompactHookInput = BaseHookInput & {
  hook_event_name: 'PreCompact';
  trigger: 'manual' | 'auto';
  custom_instructions: string | null;
};
```

And a `SDKStatusMessage` with `status: 'compacting'` indicating compaction is in progress.

### CLI Runtime

The CLI runtime watches `.jsonl` session files for messages. The same message types appear in the session file. However, CLI runtime does not have direct access to the `ModelUsage.contextWindow` field unless it appears in the JSONL output.

### Summary of Available Signals

| Signal | Source | When Available | Key Fields |
|--------|--------|----------------|------------|
| `ModelUsage.contextWindow` | `result` message | End of query | Total context window size |
| `ModelUsage.inputTokens` | `result` message | End of query | Cumulative input tokens used |
| `assistant.message.usage` | Each assistant message | Per-turn | Per-message input/output tokens |
| `compact_boundary` | System message | When auto-compact triggers | `pre_tokens` (pre-compaction token count) |
| `status: 'compacting'` | System message | During compaction | Indicates compaction in progress |
| `PreCompact` hook | Hook event | Before compaction | Trigger type, custom instructions |

---

## 3. Detecting "Context Reaching Limit"

### Context Window Sizes

| Model | Default Context | Extended Context |
|-------|----------------|-----------------|
| Claude Sonnet 4 | 200K tokens | 1M tokens (beta: `context-1m-2025-08-07`) |
| Claude Opus 4 | 200K tokens | N/A |
| Claude Haiku | 200K tokens | N/A |

The SDK options support `betas: ['context-1m-2025-08-07']` to enable 1M context for Sonnet 4/4.5.

### Detection Strategy: Cumulative Token Tracking

The best approach is to track cumulative token usage from `assistant` messages during streaming:

```
usage_percentage = cumulative_input_tokens / context_window_size
```

**Problem**: We do not know `context_window_size` until the `result` message at the END of a query. However:

1. **The `compact_boundary` message gives us `pre_tokens`** -- this tells us how many tokens were in use before compaction. If Claude auto-compacts at ~80-90% of context, this gives us a proxy.

2. **We can use model name to infer context window size**: The `system.init` message includes the `model` field (e.g., `claude-sonnet-4-5-20250929`). We can maintain a lookup table:
   ```typescript
   const CONTEXT_WINDOW_SIZES: Record<string, number> = {
     'claude-sonnet-4': 200_000,
     'claude-opus-4': 200_000,
     'claude-haiku': 200_000,
     // Extended context beta
   };
   ```

3. **Per-assistant-message `usage.input_tokens` is cumulative**: Each Anthropic API response includes the total input token count for that turn (not just the delta). So the latest `input_tokens` value IS the current context usage.

### Proposed Detection Logic

```typescript
// Track across messages in the streaming loop
let contextWindowSize: number | undefined;  // From model name or result message
let lastInputTokens = 0;                    // From assistant message usage
let modelName: string | undefined;          // From system.init message

// On system.init message:
modelName = message.model;
contextWindowSize = CONTEXT_WINDOW_SIZES[normalizeModelName(modelName)];

// On each assistant message with usage:
if (usage?.input_tokens) {
  lastInputTokens = usage.input_tokens;

  if (contextWindowSize) {
    const usagePercent = lastInputTokens / contextWindowSize;
    const remainingPercent = 1 - usagePercent;

    if (remainingPercent <= 0.10) {  // 10% remaining
      // Trigger handoff
    }
  }
}

// On compact_boundary:
// Claude already auto-compacted -- this means context was very full.
// If we see this AND our threshold hasn't triggered yet,
// we can use pre_tokens as a signal.
```

### Threshold Recommendation

- **Trigger at 10% remaining** (90% used) as specified in the user requirement
- This should be configurable per agent via `session.context_handoff_threshold` (default: 0.10)
- Must avoid triggering during Claude's own auto-compaction (check for `status: 'compacting'` messages)

---

## 4. Implementation Plan

### 4.1 Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      JobExecutor.execute()                        │
│                                                                   │
│  for await (message of runtime.execute()) {                      │
│    processMessage(message)                                        │
│    trackTokenUsage(message)  ← NEW                               │
│                                                                   │
│    if (shouldHandoff()) {    ← NEW                               │
│      1. Interrupt current query                                   │
│      2. Ask agent to create handoff document                      │
│      3. Start new session with handoff doc                        │
│      4. Replace sessionId in executor                             │
│      5. Continue streaming from new session                       │
│    }                                                              │
│  }                                                                │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Step-by-Step Implementation

#### Step 1: Add Context Tracking to Message Processing

**File**: `packages/core/src/runner/context-tracker.ts` (new)

```typescript
/**
 * Tracks context window usage from SDK messages
 * and determines when a handoff is needed.
 */
export class ContextTracker {
  private contextWindowSize: number | undefined;
  private lastInputTokens = 0;
  private modelName: string | undefined;
  private isCompacting = false;
  private handoffTriggered = false;
  private threshold: number;  // e.g., 0.10 = trigger when 10% remaining

  constructor(options: { threshold?: number } = {}) {
    this.threshold = options.threshold ?? 0.10;
  }

  /** Process an SDK message and update tracking state */
  processMessage(message: SDKMessage): void {
    // Extract model name from init message
    if (message.type === 'system' && message.subtype === 'init') {
      this.modelName = (message as any).model;
      this.contextWindowSize = this.inferContextWindowSize(this.modelName);
    }

    // Track compaction status
    if (message.type === 'system' && message.subtype === 'status') {
      this.isCompacting = (message as any).status === 'compacting';
    }

    // Track token usage from assistant messages
    if (message.type === 'assistant') {
      const apiMessage = (message as any).message;
      const usage = apiMessage?.usage ?? (message as any).usage;
      if (usage?.input_tokens) {
        this.lastInputTokens = usage.input_tokens;
      }
    }

    // Track token usage from compact_boundary (pre-compaction count)
    if (message.type === 'system' && message.subtype === 'compact_boundary') {
      const metadata = (message as any).compact_metadata;
      if (metadata?.pre_tokens) {
        this.lastInputTokens = metadata.pre_tokens;
      }
    }

    // Extract contextWindow from result message modelUsage
    if (message.type === 'result') {
      const modelUsage = (message as any).modelUsage;
      if (modelUsage) {
        for (const usage of Object.values(modelUsage)) {
          const mu = usage as ModelUsage;
          if (mu.contextWindow) {
            this.contextWindowSize = mu.contextWindow;
          }
        }
      }
    }
  }

  /** Check if handoff should be triggered */
  shouldHandoff(): boolean {
    if (this.handoffTriggered) return false;  // Only trigger once
    if (this.isCompacting) return false;       // Don't trigger during compaction
    if (!this.contextWindowSize) return false;
    if (this.lastInputTokens === 0) return false;

    const usagePercent = this.lastInputTokens / this.contextWindowSize;
    const remainingPercent = 1 - usagePercent;

    return remainingPercent <= this.threshold;
  }

  /** Mark handoff as triggered to prevent re-triggering */
  markHandoffTriggered(): void {
    this.handoffTriggered = true;
  }

  /** Reset for a new session (after handoff) */
  reset(): void {
    this.lastInputTokens = 0;
    this.handoffTriggered = false;
    this.isCompacting = false;
    // Keep contextWindowSize and modelName -- same model
  }

  /** Get current usage stats for logging */
  getStats(): { inputTokens: number; contextWindow?: number; usagePercent?: number } {
    const usagePercent = this.contextWindowSize
      ? this.lastInputTokens / this.contextWindowSize
      : undefined;
    return {
      inputTokens: this.lastInputTokens,
      contextWindow: this.contextWindowSize,
      usagePercent,
    };
  }

  private inferContextWindowSize(modelName?: string): number | undefined {
    if (!modelName) return undefined;
    // Default to 200K for all current Claude models
    // Can be extended with model-specific lookups
    return 200_000;
  }
}
```

#### Step 2: Create Handoff Document Generator

**File**: `packages/core/src/runner/handoff.ts` (new)

The handoff prompt asks the agent to summarize its current state:

```typescript
/**
 * Generate the prompt that asks the agent to create a handoff summary.
 * This is injected mid-session before the context limit is hit.
 */
export function buildHandoffPrompt(): string {
  return `
IMPORTANT: Your context window is nearly full. Please create a handoff summary NOW.

Write a comprehensive handoff document that includes:

1. **Current Task**: What you were working on
2. **Progress**: What has been completed so far
3. **Current State**: Where you left off (specific files, line numbers, branch)
4. **Next Steps**: What needs to be done next
5. **Key Decisions**: Important decisions made and their rationale
6. **Open Issues**: Any blockers or unresolved questions
7. **File Changes**: List of files modified and what was changed

Format this as a structured markdown document. Be thorough -- a fresh session
will use this document to continue your work seamlessly.
`.trim();
}

/**
 * Generate the prompt for the new session that continues from the handoff.
 */
export function buildContinuationPrompt(
  handoffDocument: string,
  originalPrompt: string
): string {
  return `
# Continuation from Previous Session

You are continuing work from a previous session that ran out of context window space.
Below is the handoff document from the previous session, followed by the original task.

## Handoff Document

${handoffDocument}

## Original Task

${originalPrompt}

## Instructions

Continue the work described above. Pick up where the previous session left off.
Do NOT repeat work that has already been completed.
`.trim();
}
```

#### Step 3: Implement Handoff in JobExecutor

The `JobExecutor.execute()` method needs to be modified to support mid-execution handoff. The key insight is that the SDK's `Query` interface has an `interrupt()` method, and the V2 API (`unstable_v2_createSession`) supports multi-turn conversations.

**Approach A: Sequential Query Execution (Recommended)**

Since the current architecture uses `query()` which returns an `AsyncGenerator<SDKMessage>`, the cleanest approach is:

1. When handoff is needed, let the current query complete its current turn
2. Start a NEW `query()` call with `resume` pointing to the same session, asking for the handoff document
3. Capture the handoff document from the response
4. Start a THIRD `query()` call as a fresh session, passing the continuation prompt
5. Replace the session ID

This avoids needing to inject prompts mid-stream.

**However**, the simpler approach is to:

1. When threshold is reached, **stop processing messages** from current query
2. Execute a separate handoff query on the same session
3. Start a new session with the handoff doc
4. Continue the main loop with the new session

**Changes to `job-executor.ts`**:

```typescript
// In execute() method, add to the streaming loop:

// NEW: Create context tracker
const contextTracker = new ContextTracker({
  threshold: agent.session?.context_handoff_threshold ?? 0.10,
});

for await (const sdkMessage of messages) {
  messagesReceived++;

  // NEW: Update context tracking
  contextTracker.processMessage(sdkMessage);

  // ... existing message processing ...

  // NEW: Check if handoff is needed
  if (contextTracker.shouldHandoff()) {
    contextTracker.markHandoffTriggered();

    const stats = contextTracker.getStats();
    this.logger.info?.(
      `Context handoff triggered for ${agent.name}: ` +
      `${stats.inputTokens}/${stats.contextWindow} tokens ` +
      `(${((stats.usagePercent ?? 0) * 100).toFixed(1)}% used)`
    );

    // Log to job output
    await appendJobOutput(jobsDir, job.id, {
      type: "system",
      subtype: "context_handoff",
      content: `Context window ${((stats.usagePercent ?? 0) * 100).toFixed(1)}% full. Initiating handoff.`,
    });

    // Execute handoff sequence
    const handoffResult = await this.performHandoff({
      agent: options.agent,
      currentSessionId: sessionId!,
      originalPrompt: prompt,
      stateDir,
      jobsDir,
      jobId: job.id,
    });

    if (handoffResult.success) {
      // Replace session ID
      sessionId = handoffResult.newSessionId;
      contextTracker.reset();

      // Start streaming from new session
      messages = this.runtime.execute({
        prompt: handoffResult.continuationPrompt,
        agent: options.agent,
        // No resume -- this is a fresh session
        abortController: options.abortController,
      });

      // Continue the outer for-await loop with new messages
      // (Need to restructure as a while loop -- see Step 5)
    }

    break; // Break out of current message loop
  }
}
```

#### Step 4: The `performHandoff()` Method

```typescript
private async performHandoff(options: {
  agent: ResolvedAgent;
  currentSessionId: string;
  originalPrompt: string;
  stateDir: string;
  jobsDir: string;
  jobId: string;
}): Promise<{
  success: boolean;
  newSessionId?: string;
  continuationPrompt: string;
  handoffDocument?: string;
}> {
  const { agent, currentSessionId, originalPrompt, stateDir, jobsDir, jobId } = options;

  // Step 1: Execute handoff query on current session
  const handoffPrompt = buildHandoffPrompt();
  let handoffDocument = '';

  const handoffMessages = this.runtime.execute({
    prompt: handoffPrompt,
    agent,
    resume: currentSessionId,
    abortController: undefined, // Don't propagate abort for handoff
  });

  for await (const msg of handoffMessages) {
    // Capture the assistant's handoff response
    if (msg.type === 'assistant' && !msg.partial) {
      const apiMessage = (msg as any).message;
      const content = extractTextFromContentBlocks(apiMessage?.content ?? msg.content);
      if (content) {
        handoffDocument = content;
      }
    }
  }

  if (!handoffDocument) {
    this.logger.warn('Handoff failed: no handoff document generated');
    return { success: false, continuationPrompt: originalPrompt };
  }

  // Step 2: Build continuation prompt
  const continuationPrompt = buildContinuationPrompt(handoffDocument, originalPrompt);

  // Step 3: Log handoff document to job output
  await appendJobOutput(jobsDir, jobId, {
    type: "system",
    subtype: "handoff_document",
    content: handoffDocument,
  });

  // The new session ID will be extracted from the init message
  // of the continuation query (handled by the caller)
  return {
    success: true,
    continuationPrompt,
    handoffDocument,
  };
}
```

#### Step 5: Restructure the Message Loop

The current `for await` loop needs to become a `while` loop that can restart with a new `AsyncIterable<SDKMessage>`:

```typescript
// Replace the single for-await loop with a restartable loop
let currentMessages: AsyncIterable<SDKMessage> = messages;
let handoffCount = 0;
const MAX_HANDOFFS = 3; // Safety limit

while (true) {
  let handoffNeeded = false;

  for await (const sdkMessage of currentMessages) {
    messagesReceived++;
    contextTracker.processMessage(sdkMessage);

    // ... existing processing ...

    // Extract session ID
    if (processed.sessionId) {
      sessionId = processed.sessionId;
    }

    // Check for handoff
    if (contextTracker.shouldHandoff() && handoffCount < MAX_HANDOFFS) {
      contextTracker.markHandoffTriggered();
      handoffNeeded = true;

      // Perform handoff
      const handoffResult = await this.performHandoff({ ... });

      if (handoffResult.success) {
        sessionId = undefined; // Will be set from new session's init message
        handoffCount++;
        contextTracker.reset();

        // Prepare new message stream
        currentMessages = this.runtime.execute({
          prompt: handoffResult.continuationPrompt,
          agent: options.agent,
          abortController: options.abortController,
        });
      }

      break; // Exit inner loop, continue outer while loop
    }

    // Check for terminal
    if (isTerminalMessage(sdkMessage)) {
      break;
    }
  }

  if (!handoffNeeded) {
    break; // Normal completion
  }
}
```

#### Step 6: Update Session Persistence After Handoff

After handoff, the session ID changes. The existing persistence logic at Step 6 of `execute()` already handles this correctly since it uses the `sessionId` variable, which will now hold the new session's ID.

For Slack per-thread sessions, the `SessionManager.setSession()` method needs to be called with the new session ID. This happens naturally because:

1. The `onMessage` callback receives the new `system.init` message with the new session ID
2. The `SlackManager` processes this and updates the session mapping

However, we should emit a specific event so external consumers (like SlackManager) know a handoff occurred:

```typescript
// In the handoff sequence:
if (onMessage) {
  await onMessage({
    type: 'system',
    subtype: 'context_handoff',
    session_id: newSessionId,
    content: 'Context window handoff completed',
    old_session_id: oldSessionId,
  });
}
```

---

## 5. How session_id Replacement Works in Practice

### The Flow

```
Time ──────────────────────────────────────────────────────────────►

Session A (old):
  init(session_id=A) → msg → msg → msg → ... → 90% context used
                                                        │
                                            handoff query(resume=A)
                                            "Create handoff document"
                                                        │
                                            handoff_doc = response
                                                        │
Session B (new):                                       ▼
  query(prompt=continuation_prompt) → init(session_id=B) → msg → ...
                                            │
                              sessionId variable updated to B
                                            │
                              Session B persisted to disk
```

### What Gets Replaced

1. **In-memory `sessionId` variable** in `JobExecutor.execute()` -- updated when new `system.init` message arrives
2. **Job metadata `session_id`** -- updated when job completes (Step 5 of execute)
3. **Agent session file** (`.herdctl/sessions/<agent>.json`) -- updated when job completes (Step 6 of execute)
4. **Slack session mapping** (`.herdctl/slack-sessions/<agent>.yaml`) -- updated via `onMessage` callback when SlackManager sees new session ID

### What Stays the Same

- **Job ID** -- the same job spans both sessions
- **Working directory** -- unchanged
- **Agent configuration** -- unchanged
- **Runtime instance** -- reused for the new query

---

## 6. Code-Level Design: Where Changes Go

### New Files

| File | Purpose |
|------|---------|
| `packages/core/src/runner/context-tracker.ts` | `ContextTracker` class for monitoring token usage |
| `packages/core/src/runner/handoff.ts` | Handoff prompt generation and continuation prompt building |
| `packages/core/src/runner/__tests__/context-tracker.test.ts` | Unit tests for context tracking |
| `packages/core/src/runner/__tests__/handoff.test.ts` | Unit tests for handoff prompt generation |

### Modified Files

| File | Changes |
|------|---------|
| `packages/core/src/runner/job-executor.ts` | Add context tracking, handoff trigger, restartable message loop, `performHandoff()` method |
| `packages/core/src/runner/message-processor.ts` | Handle new `context_handoff` and `handoff_document` system subtypes |
| `packages/core/src/runner/types.ts` | Add handoff-related fields to `SDKMessage` type |
| `packages/core/src/config/schemas/agent.ts` | Add `session.context_handoff_threshold` config option |
| `packages/core/src/state/schemas/job-output.ts` | Add `handoff_document` subtype to system messages |

### Configuration

```yaml
agents:
  - name: my-agent
    session:
      mode: persistent
      context_handoff_threshold: 0.10   # Trigger handoff when 10% remaining (default)
      max_handoffs_per_job: 3           # Safety limit (default: 3)
```

### Events

New events emitted during handoff:

```typescript
// Emitted when handoff starts
emitter.emit('context:handoff:start', {
  agentName: string;
  jobId: string;
  oldSessionId: string;
  usagePercent: number;
  inputTokens: number;
  contextWindow: number;
});

// Emitted when handoff completes
emitter.emit('context:handoff:complete', {
  agentName: string;
  jobId: string;
  oldSessionId: string;
  newSessionId: string;
  handoffNumber: number;  // 1-based
});
```

---

## 7. Edge Cases and Concerns

### 7.1 Claude's Built-in Auto-Compaction

Claude Code already auto-compacts when context fills up. The `compact_boundary` message indicates this happened. We need to decide: does handoff replace compaction, or supplement it?

**Recommendation**: Handoff should trigger BEFORE Claude's auto-compaction. Set the threshold at 10% remaining (90% used), while Claude's auto-compaction likely triggers at a higher percentage. If we see a `compact_boundary` message, it means Claude already compacted and we should NOT trigger handoff on top of it (the compaction already reduced context usage).

### 7.2 Mid-Turn Interruption

If the agent is in the middle of a multi-step operation (e.g., editing multiple files), interrupting for handoff could leave things in an inconsistent state.

**Mitigation**: Only check for handoff after receiving a complete (non-partial) assistant message, not during streaming. This ensures the agent has completed its current thought.

### 7.3 Handoff Query Itself Using Context

The handoff prompt + response will consume additional context in the old session. If we are already at 90%, this might push us to 95%+ which could cause issues.

**Mitigation**: Keep the handoff prompt short and concise. If the handoff query fails due to context overflow, fall back to a minimal handoff (just the original prompt + "continue from where you left off").

### 7.4 CLI Runtime

CLI runtime executes via `claude -p` which is a single-shot command. Handoff would require spawning a new CLI process. This works fine since CLIRuntime already supports starting new executions.

### 7.5 Slack Per-Thread Sessions

When a Slack thread triggers a handoff, the thread's session ID must be updated in the SlackSessionManager. The existing `setSession()` method handles this. The `onMessage` callback chain already propagates session ID changes.

### 7.6 Recursive Handoff

If the continued session also fills up, another handoff should trigger. The `MAX_HANDOFFS` limit prevents infinite loops. Each handoff compounds context loss (information from handoff N-1 is already summarized), so quality degrades with each handoff.

---

## 8. Alternative Approaches Considered

### 8.1 Use V2 Session API (`unstable_v2_createSession`)

The SDK has an unstable V2 API with `SDKSession.send()` for multi-turn conversations. This would allow injecting the handoff prompt mid-session without creating a new query. However:
- It is marked `unstable` and may change
- The current codebase uses `query()` everywhere
- Switching to V2 is a larger architectural change

**Verdict**: Not recommended for initial implementation. Can migrate later.

### 8.2 Use SDK Hooks for PreCompact

The SDK supports a `PreCompact` hook that fires before compaction. We could use this hook to generate the handoff document automatically.

**Verdict**: Interesting but limited. The hook runs in the agent process and cannot control the executor's session management. Could be a useful supplement but not a replacement.

### 8.3 Use `Query.interrupt()`

The SDK's `Query` interface has `interrupt()` which stops the current query. We could interrupt, then start a new query with handoff.

**Verdict**: This is actually the cleanest approach for the SDK runtime. It stops the current stream gracefully. Combined with a follow-up `query()` for handoff and then another for continuation, this is the recommended path.

---

## 9. Implementation Priority and Phasing

### Phase 1: Token Tracking (Low Risk)
- Implement `ContextTracker` class
- Add tracking to `JobExecutor` message loop
- Log context usage stats to job output
- No behavior changes -- just monitoring

### Phase 2: Handoff Mechanism (Medium Risk)
- Implement `performHandoff()` in `JobExecutor`
- Restructure message loop to be restartable
- Add handoff prompt generation
- Add configuration options

### Phase 3: Session Replacement (Medium Risk)
- Handle session ID replacement for agent-level sessions
- Handle session ID replacement for Slack per-thread sessions
- Emit events for handoff lifecycle
- Add safety limits (max handoffs)

### Phase 4: Testing and Hardening
- Unit tests for `ContextTracker`
- Integration tests for handoff flow
- Edge case handling (CLI runtime, Docker, concurrent jobs)
- Monitoring/observability for handoff events

---

## 10. Universal Context Hooks

### Motivation: Pluggable Over Hardcoded

Sections 1-9 proposed a hardcoded handoff mechanism built directly into `JobExecutor`. While this works, it couples herdctl to one specific handoff behavior (ask the agent for a summary, start a new session with it). Different users will want different behaviors:

- Write a handoff document to a `specs/` directory using a `/handoff` slash command
- Post the handoff summary to a Slack thread or Linear comment
- Run a custom compaction script that prunes context differently from Claude's built-in auto-compact
- Load context from a knowledge base or RAG system when starting a new session
- Do nothing (let Claude's built-in auto-compact handle it)

The solution: expose **universal hooks** that fire at context lifecycle points, and make the built-in handoff behavior from Sections 1-9 the **default implementation** that users can override.

This follows the same design philosophy as the Git Worktree Strategy's setup/teardown pattern (see Section 12) -- universal, pluggable, and composable.

### Hook Design: `on_context_threshold` and `on_session_start`

Two new hook points are introduced:

#### `on_context_threshold`

Fires when context window usage reaches a configurable threshold.

| Property | Description |
|----------|-------------|
| **When it fires** | After processing an assistant message where `input_tokens / context_window >= (1 - threshold)` |
| **Default behavior** | If no hooks are configured: use herdctl's built-in handoff (Sections 4-5) |
| **Custom behavior** | User-defined hooks fire instead, completely replacing the built-in handoff |
| **Fires before auto-compact** | The threshold (default 90%) fires before Claude's auto-compact (~95%), giving hooks a chance to act first |

**Context payload passed to hook:**

```typescript
interface ContextThresholdHookPayload {
  hook_event_name: "context_threshold";

  // Context usage information
  context: {
    input_tokens: number;
    context_window: number;
    usage_percent: number;       // e.g., 0.92
    remaining_percent: number;   // e.g., 0.08
    model_name: string;
  };

  // Current session information
  session: {
    session_id: string;
    agent_name: string;
    job_id: string;
    working_directory: string;
    worktree_path?: string;      // If worktree strategy is active
  };

  // The original prompt for this job
  original_prompt: string;
}
```

#### `on_session_start`

Fires when a new session begins (either the first session for a job, or a continuation session after handoff).

| Property | Description |
|----------|-------------|
| **When it fires** | After receiving the `system.init` message with a new `session_id` |
| **Default behavior** | If no hooks are configured: do nothing |
| **Custom behavior** | User-defined hooks fire, can modify the prompt or inject context |
| **Return value** | Hooks can return additional context to prepend to the agent's prompt |

**Context payload passed to hook:**

```typescript
interface SessionStartHookPayload {
  hook_event_name: "session_start";

  // Session information
  session: {
    session_id: string;
    agent_name: string;
    job_id: string;
    working_directory: string;
    worktree_path?: string;
    is_continuation: boolean;     // true if this follows a context handoff
    previous_session_id?: string; // Set when is_continuation is true
    handoff_count: number;        // 0 for first session, 1+ for continuations
  };

  // The prompt that will be sent to the agent
  prompt: string;
}
```

**Return value from shell hooks:**

Shell hooks for `on_session_start` can write to stdout. If they produce output, it is treated as additional context to prepend to the prompt:

```bash
#!/bin/bash
# on_session_start hook: load handoff document if it exists
CONTEXT_PAYLOAD=$(cat)  # Read JSON from stdin
AGENT_NAME=$(echo "$CONTEXT_PAYLOAD" | jq -r '.session.agent_name')
SPECS_DIR="./specs/handoffs"

HANDOFF_FILE="$SPECS_DIR/$AGENT_NAME-handoff.md"
if [ -f "$HANDOFF_FILE" ]; then
  cat "$HANDOFF_FILE"
  rm "$HANDOFF_FILE"  # Clean up after loading
fi
```

### How Default Behavior Works

The key principle: **if no context hooks are configured, herdctl uses its built-in handoff mechanism.** If hooks ARE configured, the hooks take full control.

```
on_context_threshold configured?
  |
  |-- NO  --> Use built-in handoff (Sections 4-5: ask agent for summary, start new session)
  |
  |-- YES --> Execute configured hooks sequentially
              |
              |-- Hook can: save handoff doc, notify team, trigger external process, etc.
              |-- Hook can: return "abort" to stop the current session
              |-- Hook can: return "continue" to let execution proceed (and eventually hit auto-compact)
              |-- Built-in handoff is NOT executed

on_session_start configured?
  |
  |-- NO  --> Do nothing (session starts normally)
  |
  |-- YES --> Execute configured hooks
              |-- Shell hooks can return additional context via stdout
              |-- Context is prepended to the agent's prompt
```

This means the system from Sections 1-9 still works out of the box for users who do not configure hooks. Power users who want custom behavior simply add hooks to their agent config.

---

## 11. How Auto-Compact Currently Works in herdctl

### Research Findings

After thorough investigation of the codebase, here is exactly what herdctl does with Claude's built-in auto-compaction:

#### 1. SDK Message Types Are Known

The `SDKMessage` type in `packages/core/src/runner/types.ts` defines `type: "system"` with an optional `subtype` field. The `compact_boundary` subtype and `status` subtype (with value `"compacting"`) are the relevant signals.

#### 2. Message Processor: Pass-Through Only

In `packages/core/src/runner/message-processor.ts`, the `processSystemMessage()` function handles ALL system messages generically:

```typescript
function processSystemMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "system",
  };
  if (message.content) {
    output.content = message.content;
  }
  if (message.subtype) {
    output.subtype = message.subtype;
  }
  // Extract session ID specifically from init messages
  const sessionId =
    message.subtype === "init" ? message.session_id : undefined;
  return { output, sessionId };
}
```

There is **no special handling** for `compact_boundary` or `compacting` status messages. They are treated the same as any other system message -- the subtype and content are passed through to job output, and that is all.

#### 3. Job Executor: No Compaction Awareness

In `packages/core/src/runner/job-executor.ts`, the main streaming loop processes every SDK message through `processSDKMessage()`, writes it to job output, extracts session IDs from `init` messages, and checks for terminal messages. There is **no code** that:

- Detects `compact_boundary` messages
- Tracks token usage from `compact_metadata.pre_tokens`
- Responds to `status: "compacting"` messages
- Monitors context window usage in any way

#### 4. Terminal Message Detection: Unrelated

The `isTerminalMessage()` function checks for `result`, `error`, and system messages with subtypes `end`, `complete`, or `session_end`. The `compact_boundary` subtype is not a terminal message -- execution continues after compaction.

#### Summary: herdctl Is Completely Passive

| Aspect | Current Behavior |
|--------|-----------------|
| `compact_boundary` messages | Logged to job output as a system message, no further action |
| `status: "compacting"` messages | Logged to job output as a system message, no further action |
| `pre_tokens` from compact metadata | Not extracted, not tracked |
| Token usage from assistant messages | Not tracked |
| Context window size | Not tracked |
| Any compaction response | None -- Claude handles it internally |

**This is actually the ideal starting point for the hooks approach.** Since herdctl currently does nothing with compaction signals, we can add the hook system cleanly without disrupting existing behavior. The hooks fire at a lower threshold (e.g., 90%) BEFORE Claude's auto-compact would trigger (at ~95%), and if no hooks are configured, Claude's auto-compact continues to handle things silently just as it does today.

### How Hooks Interact with Auto-Compact

The interaction model is:

```
Context Usage Timeline:
  0% ─────── 90% (configurable) ──── ~95% ────── 100%
                    |                    |
          on_context_threshold     Claude auto-compact
              hooks fire           (if not prevented)

Scenario A: No hooks configured
  - Context grows naturally
  - Claude auto-compacts around 95% (herdctl is passive, as today)
  - If context fills again, Claude auto-compacts again
  - No herdctl intervention at any point

Scenario B: Hooks configured
  - on_context_threshold fires at 90%
  - Hooks execute (save handoff doc, notify, etc.)
  - If hooks return "abort": herdctl stops the current session, starts a new one
  - If hooks return "continue": execution continues, Claude may auto-compact later
  - on_session_start fires when the new session begins

Scenario C: Built-in handoff (no hooks, but handoff enabled in config)
  - on_context_threshold fires at 90%
  - Built-in handoff executes (ask agent for summary, start new session)
  - This is the behavior described in Sections 4-5
  - on_session_start fires for the new session
```

---

## 12. Hook Interface Design

### Existing Hook Patterns in herdctl

The current hook system (in `packages/core/src/hooks/`) provides:

**Hook Events** (from `config/schema.ts`):
```typescript
export const HookEventSchema = z.enum(["completed", "failed", "timeout", "cancelled"]);
```

**Hook Types** (four runner implementations):
- `shell` -- Executes a shell command, pipes `HookContext` JSON to stdin (`packages/core/src/hooks/runners/shell.ts`)
- `webhook` -- POSTs `HookContext` JSON to a URL (`packages/core/src/hooks/runners/webhook.ts`)
- `discord` -- Posts a rich notification to a Discord channel (`packages/core/src/hooks/runners/discord.ts`)
- `slack` -- Posts a rich notification to a Slack channel (`packages/core/src/hooks/runners/slack.ts`)

**Hook Lifecycle** (from `config/schema.ts`):
```typescript
export const AgentHooksSchema = z.object({
  after_run: z.array(HookConfigSchema).optional(),
  on_error: z.array(HookConfigSchema).optional(),
});
```

**Execution Model** (from `hook-executor.ts`):
- Hooks are executed sequentially in defined order
- Each hook receives a `HookContext` with job, result, and agent information via JSON on stdin (shell) or request body (webhook)
- Hooks can filter by event type via `on_events`
- Hooks can conditionally execute via `when` (dot-notation path to boolean in context)
- Failed hooks can either stop subsequent hooks (`continue_on_error: false`) or allow them to proceed (`continue_on_error: true`, the default)

**Base Hook Config**:
```typescript
const BaseHookConfigSchema = z.object({
  name: z.string().optional(),
  continue_on_error: z.boolean().optional().default(true),
  on_events: z.array(HookEventSchema).optional(),
  when: z.string().optional(),
});
```

### Proposed Context Hook Schema

Following the exact same patterns, context hooks are added to the `AgentHooksSchema`:

```typescript
// Extended HookEventSchema to include context lifecycle events
export const HookEventSchema = z.enum([
  "completed",
  "failed",
  "timeout",
  "cancelled",
  // NEW: Context lifecycle events
  "context_threshold",
  "session_start",
]);

// Extended AgentHooksSchema
export const AgentHooksSchema = z.object({
  after_run: z.array(HookConfigSchema).optional(),
  on_error: z.array(HookConfigSchema).optional(),
  // NEW: Context lifecycle hooks
  on_context_threshold: z.array(HookConfigSchema).optional(),
  on_session_start: z.array(HookConfigSchema).optional(),
});
```

### Context Hook Configuration in Agent YAML

#### Example 1: Custom handoff using a shell script

```yaml
agents:
  - name: coder
    session:
      timeout: "24h"
      context_threshold: 0.10  # Fire hooks when 10% context remaining (default)
    hooks:
      # Existing hooks (unchanged)
      after_run:
        - type: slack
          channel_id: C1234567890
          on_events: [completed]

      # NEW: Context threshold hook
      on_context_threshold:
        - type: shell
          name: "Save handoff document"
          command: ./scripts/save-handoff.sh
          timeout: 30000

      # NEW: Session start hook
      on_session_start:
        - type: shell
          name: "Load handoff context"
          command: ./scripts/load-handoff.sh
          timeout: 10000
```

The `save-handoff.sh` script receives `ContextThresholdHookPayload` as JSON on stdin:

```bash
#!/bin/bash
# save-handoff.sh -- Triggered when context window is nearly full
PAYLOAD=$(cat)

AGENT_NAME=$(echo "$PAYLOAD" | jq -r '.session.agent_name')
JOB_ID=$(echo "$PAYLOAD" | jq -r '.session.job_id')
WORKING_DIR=$(echo "$PAYLOAD" | jq -r '.session.working_directory')
USAGE_PCT=$(echo "$PAYLOAD" | jq -r '.context.usage_percent')

HANDOFF_DIR="$WORKING_DIR/specs/handoffs"
mkdir -p "$HANDOFF_DIR"

# Write a handoff marker file. The agent will see this in its next session
# and can read it for continuity.
cat > "$HANDOFF_DIR/$AGENT_NAME-handoff.json" <<EOF
{
  "agent": "$AGENT_NAME",
  "job_id": "$JOB_ID",
  "usage_percent": $USAGE_PCT,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "instructions": "Continue the work from the previous session. Check git log for recent changes."
}
EOF

echo "Handoff saved to $HANDOFF_DIR/$AGENT_NAME-handoff.json"
# Exit 0 = success, hook executor will proceed to start a new session
```

The `load-handoff.sh` script receives `SessionStartHookPayload` and returns additional context on stdout:

```bash
#!/bin/bash
# load-handoff.sh -- Triggered when a new session starts
PAYLOAD=$(cat)

AGENT_NAME=$(echo "$PAYLOAD" | jq -r '.session.agent_name')
IS_CONTINUATION=$(echo "$PAYLOAD" | jq -r '.session.is_continuation')
WORKING_DIR=$(echo "$PAYLOAD" | jq -r '.session.working_directory')

# Only load handoff context for continuation sessions
if [ "$IS_CONTINUATION" != "true" ]; then
  exit 0
fi

HANDOFF_FILE="$WORKING_DIR/specs/handoffs/$AGENT_NAME-handoff.json"
if [ -f "$HANDOFF_FILE" ]; then
  echo "# Continuation Context"
  echo ""
  echo "You are continuing work from a previous session that ran out of context space."
  echo ""
  echo "## Handoff Information"
  cat "$HANDOFF_FILE"
  echo ""
  echo "## Instructions"
  echo "Check \`git log --oneline -20\` and \`git diff\` to understand what was done."
  echo "Continue from where the previous session left off."
  echo ""

  # Clean up the handoff file
  rm "$HANDOFF_FILE"
fi
```

#### Example 2: Webhook notification on context threshold

```yaml
agents:
  - name: researcher
    session:
      context_threshold: 0.15  # More conservative: fire at 15% remaining
    hooks:
      on_context_threshold:
        - type: webhook
          name: "Notify monitoring"
          url: https://monitoring.example.com/hooks/context-alert
          headers:
            Authorization: "Bearer ${MONITORING_TOKEN}"
        - type: shell
          name: "Built-in handoff fallback"
          command: herdctl internal handoff  # Could invoke built-in behavior via CLI
```

#### Example 3: No hooks (default -- built-in handoff OR passive)

```yaml
agents:
  - name: simple-agent
    session:
      # context_threshold not set -- defaults to 0.10
      # No on_context_threshold hooks defined
      # Behavior: built-in handoff (Sections 4-5) if handoff is enabled,
      #           otherwise Claude's auto-compact handles it silently
```

### Hook Execution Flow in JobExecutor

The integration into `JobExecutor` follows this pattern:

```typescript
// In the streaming loop, when threshold is reached:

if (contextTracker.shouldHandoff()) {
  contextTracker.markHandoffTriggered();
  const stats = contextTracker.getStats();

  // Build the hook payload
  const thresholdPayload: ContextThresholdHookPayload = {
    hook_event_name: "context_threshold",
    context: {
      input_tokens: stats.inputTokens,
      context_window: stats.contextWindow!,
      usage_percent: stats.usagePercent!,
      remaining_percent: 1 - stats.usagePercent!,
      model_name: stats.modelName ?? "unknown",
    },
    session: {
      session_id: sessionId!,
      agent_name: agent.name,
      job_id: job.id,
      working_directory: resolveWorkingDirectory(agent),
      worktree_path: setupResult?.workingDirectory,
    },
    original_prompt: prompt,
  };

  // Check if custom hooks are configured
  const contextHooks = agent.hooks?.on_context_threshold;

  if (contextHooks && contextHooks.length > 0) {
    // CUSTOM BEHAVIOR: Execute user-defined hooks
    const hookExecutor = new HookExecutor({ logger: this.logger, cwd: resolveWorkingDirectory(agent) });
    const hookContext: HookContext = {
      event: "context_threshold",
      job: { /* ... */ },
      result: { success: true, output: "" },
      agent: { id: agent.name },
      metadata: thresholdPayload,
    };
    await hookExecutor.executeHooks(agent.hooks, hookContext, "on_context_threshold");

    // After hooks execute, start a new session
    // The on_session_start hooks will fire when the new session initializes
  } else {
    // DEFAULT BEHAVIOR: Use built-in handoff (Sections 4-5)
    const handoffResult = await this.performHandoff({ /* ... */ });
    // ...
  }
}
```

### Hook Runner Considerations for Context Hooks

The existing hook runners (`ShellHookRunner`, `WebhookHookRunner`, `SlackHookRunner`, `DiscordHookRunner`) work unchanged for context hooks. The `HookContext` interface already has a `metadata` field for arbitrary structured data, and the `event` field maps to `HookEvent`.

The one enhancement needed is for `on_session_start` shell hooks: their stdout should be captured and used as additional prompt context. This requires a small addition to the `HookResult` interface:

```typescript
export interface HookResult {
  success: boolean;
  hookType: "shell" | "webhook" | "discord" | "slack";
  durationMs: number;
  error?: string;
  output?: string;       // <-- Already exists. For on_session_start shell hooks,
  exitCode?: number;     //     this output becomes additional prompt context.
}
```

The `output` field already captures stdout from shell hooks. No changes to `ShellHookRunner` are needed -- the `JobExecutor` simply reads `result.output` after executing `on_session_start` hooks and prepends it to the agent's prompt.

### Schema Changes Summary

| File | Change |
|------|--------|
| `packages/core/src/config/schema.ts` | Add `"context_threshold"`, `"session_start"` to `HookEventSchema`; add `on_context_threshold`, `on_session_start` to `AgentHooksSchema`; add `context_threshold` to `SessionSchema` |
| `packages/core/src/hooks/types.ts` | Add `ContextThresholdHookPayload` and `SessionStartHookPayload` interfaces |
| `packages/core/src/hooks/hook-executor.ts` | Add `"on_context_threshold"` and `"on_session_start"` to the `hookList` parameter type |
| `packages/core/src/runner/job-executor.ts` | Integrate context tracking and hook execution (see Section 4, modified for hooks) |

---

## 13. Integration with Worktree Strategy

### The Composability Problem

When both the Git Worktree Strategy (006) and Context Handoff Hooks are active, they interact at several points:

1. The agent is working in a **worktree directory**, not the repo root
2. A context threshold hook fires -- it needs to know the worktree path to save handoff files in the right place
3. A new session starts -- the `on_session_start` hook needs to set the working directory to the **same worktree**, not a new one
4. The handoff context needs to reference the correct branch and worktree

### How These Two Features Compose

The key insight is that the **worktree lifecycle wraps the entire job**, while **context handoff happens within a job**. A single job may span multiple sessions (due to handoff), but it always stays within the same worktree.

```
Worktree Lifecycle (one per job):
  setup() ──────────────────────────────── teardown()
    |                                        |
    |  Session 1         Session 2           |
    |  [──────────]  [──────────────]        |
    |         ^  |   |  ^                    |
    |         |  |   |  |                    |
    |    threshold  handoff  session_start   |
    |    hook fires  begins  hook fires      |
    |                                        |
    all sessions use the same worktree_path
```

### Worktree Information in Hook Payloads

Both hook payloads include worktree-aware fields:

```typescript
// In ContextThresholdHookPayload.session:
{
  working_directory: "/home/dev/myrepo",           // The repo root
  worktree_path: "/home/dev/myrepo/.worktrees/job-2026-02-16-abc123",  // The active worktree
  branch_name: "agent/coder/lin-42",               // The worktree's branch
}

// In SessionStartHookPayload.session:
{
  working_directory: "/home/dev/myrepo/.worktrees/job-2026-02-16-abc123",  // Same worktree
  worktree_path: "/home/dev/myrepo/.worktrees/job-2026-02-16-abc123",
  is_continuation: true,
  branch_name: "agent/coder/lin-42",
}
```

The `working_directory` for `on_session_start` is set to the worktree path (not the repo root), because that is where the agent should continue working. The `worktree_path` field is always present when a worktree strategy is active, giving hooks explicit access to the worktree location even if `working_directory` is used for something else.

### Implementation: WorkspaceStrategy Passes Context to Hooks

The `WorkspaceSetupResult` from the worktree strategy (see 006-worktree-strategy-research.md Section "Code Structure Proposal") already returns:

```typescript
interface WorkspaceSetupResult {
  workingDirectory: string;    // The worktree path
  branchName?: string;         // The branch checked out in the worktree
  baseBranch?: string;         // The base branch (e.g., "main")
  sessionKey?: string;         // Optional session key override
}
```

This result is stored on the `JobExecutor` and made available to the context hook payload builder:

```typescript
// In JobExecutor, when building hook payloads:
const thresholdPayload: ContextThresholdHookPayload = {
  // ...
  session: {
    // ...
    working_directory: resolveWorkingDirectory(agent),  // May be overridden by worktree
    worktree_path: workspaceSetupResult?.workingDirectory,
    branch_name: workspaceSetupResult?.branchName,
  },
};
```

### Session Continuity Across Handoffs Within a Worktree

When a context handoff occurs inside a worktree job:

1. **The worktree stays the same.** The `WorkspaceStrategy.teardown()` is NOT called during handoff -- it only runs when the entire job completes.

2. **The new session uses the same `cwd`.** The continuation query passes the worktree path as `cwd` to the runtime, ensuring the new Claude session starts in the same directory.

3. **Git state is preserved.** Since the worktree is not torn down, any uncommitted changes, staged files, and branch state remain intact across the handoff. The new session can `git status` and `git log` to understand where things stand.

4. **The `on_session_start` hook's `working_directory` is the worktree.** This means shell hooks that check for handoff files in `./specs/handoffs/` will find them in the worktree's directory, not the repo root.

```typescript
// When starting a continuation session after handoff:
const continuationMessages = this.runtime.execute({
  prompt: continuationPrompt,  // Built from handoff doc + original prompt + on_session_start hook output
  agent: {
    ...agent,
    // CRITICAL: Use the worktree path, NOT the original working_directory
    working_directory: workspaceSetupResult?.workingDirectory ?? resolveWorkingDirectory(agent),
  },
  abortController: options.abortController,
});
```

### Example: Full Configuration with Both Features

```yaml
agents:
  - name: coder
    working_directory:
      root: /home/dev/myrepo
      default_branch: main

    # Worktree strategy: each job gets its own branch and directory
    workspace:
      strategy: git_worktree
      worktree_dir: .worktrees
      branch_pattern: "agent/{agent}/{workItem}"
      push_on_success: true
      create_pr: true

    session:
      timeout: "24h"
      context_threshold: 0.10

    hooks:
      # Context threshold: save handoff doc in the worktree's specs dir
      on_context_threshold:
        - type: shell
          name: "Save handoff to worktree"
          command: |
            PAYLOAD=$(cat)
            WORKTREE=$(echo "$PAYLOAD" | jq -r '.session.worktree_path // .session.working_directory')
            AGENT=$(echo "$PAYLOAD" | jq -r '.session.agent_name')
            BRANCH=$(echo "$PAYLOAD" | jq -r '.session.branch_name // "unknown"')
            mkdir -p "$WORKTREE/specs/handoffs"
            echo "$PAYLOAD" | jq '{
              agent: .session.agent_name,
              branch: .session.branch_name,
              usage: .context.usage_percent,
              timestamp: (now | todate),
              note: "Check git log and git diff for context"
            }' > "$WORKTREE/specs/handoffs/$AGENT-handoff.json"

      # Session start: load handoff context from worktree specs dir
      on_session_start:
        - type: shell
          name: "Load handoff from worktree"
          command: |
            PAYLOAD=$(cat)
            IS_CONTINUATION=$(echo "$PAYLOAD" | jq -r '.session.is_continuation')
            if [ "$IS_CONTINUATION" != "true" ]; then exit 0; fi
            WORKING_DIR=$(echo "$PAYLOAD" | jq -r '.session.working_directory')
            AGENT=$(echo "$PAYLOAD" | jq -r '.session.agent_name')
            HANDOFF="$WORKING_DIR/specs/handoffs/$AGENT-handoff.json"
            if [ -f "$HANDOFF" ]; then
              echo "# Continuation from Previous Session"
              echo ""
              echo "Previous session context:"
              cat "$HANDOFF"
              echo ""
              echo "Run 'git log --oneline -20' and 'git diff' to understand current state."
              echo "Continue working on the same branch. Do NOT create a new branch."
              rm "$HANDOFF"
            fi

      # Normal post-job hooks still work
      after_run:
        - type: slack
          channel_id: C1234567890
          on_events: [completed, failed]
```

### Composition Rules Summary

| Aspect | Worktree Only | Handoff Only | Both Together |
|--------|--------------|--------------|---------------|
| Working directory | Worktree path per job | Static (unchanged) | Worktree path, preserved across handoffs |
| Branch | Created per job | N/A | Same branch across all sessions in a job |
| Session | Fresh per worktree (different cwd) | New session per handoff | Fresh per worktree; multiple sessions share the worktree |
| Cleanup | On job completion | N/A | On job completion (after all handoffs) |
| Hook cwd | Worktree path | Agent working_directory | Worktree path |

The two features compose cleanly because they operate at different lifecycle levels: worktrees are per-job, while context handoffs are per-session within a job. Neither needs to know about the other's internals -- they communicate through the `working_directory` and `worktree_path` fields in the hook payloads.
