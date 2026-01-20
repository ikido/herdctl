# PRD 4: Agent Runner (herdctl-core-runner)

## Overview

Implement the **agent runner** module in `packages/core/src/runner/`. This module wraps the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to execute agents with proper configuration, permissions, MCP server support, and output handling. It integrates with the existing config and state modules to provide a complete agent execution lifecycle.

## Dependencies

- **herdctl-core-config** (PRD 1): Provides `AgentConfig`, `PermissionsSchema`, `McpServerSchema` types
- **herdctl-core-state** (PRD 2): Provides job creation/updates, JSONL streaming output, session persistence
- **herdctl-docs** (PRD 3): Documentation site to update with Runner section

## User Stories

### US-1: Initialize SDK with Agent Config
**As a** fleet operator  
**I want to** execute an agent using the Claude Agent SDK  
**So that** I can run autonomous agents with proper configuration

**Acceptance Criteria:**
- Accepts `ResolvedAgentConfig` from the config module
- Initializes the SDK's `query` function with agent-specific options
- Passes `systemPrompt` from agent config (or uses `claude_code` preset)
- Sets `settingSources` to `["project", "local"]` for proper settings discovery
- Works with the async iterator pattern from the SDK

### US-2: Pass MCP Servers from Agent Config
**As a** fleet operator  
**I want to** configure MCP servers per-agent  
**So that** each agent has access to its required tools and integrations

**Acceptance Criteria:**
- Transforms agent's `mcp_servers` config to SDK's `mcpServers` format
- Supports HTTP-based MCP servers (`type: "http"`, `url`)
- Supports process-based MCP servers (`command`, `args`, `env`)
- Interpolates environment variables in MCP config (e.g., `${GITHUB_TOKEN}`)
- Passes empty object when no MCP servers configured

### US-3: Pass Allowed Tools and Permission Mode
**As a** fleet operator  
**I want to** control which tools an agent can use  
**So that** I can enforce security boundaries per agent

**Acceptance Criteria:**
- Maps agent's `permissions.mode` to SDK's `permissionMode`
- Supports all four modes: `default`, `acceptEdits`, `bypassPermissions`, `plan`
- Passes `permissions.allowed_tools` as SDK's `allowedTools` array
- Passes `permissions.denied_tools` as SDK's `deniedTools` array (if supported)
- Defaults to `acceptEdits` mode when not specified
- Supports MCP tool wildcards (e.g., `mcp__posthog__*`)

### US-4: Stream Output to Job Log
**As a** fleet operator  
**I want to** capture all agent output in real-time  
**So that** I can monitor agent activity and debug issues

**Acceptance Criteria:**
- Creates job record via `createJob()` before starting execution
- Updates job status to `running` via `updateJob()`
- Writes each SDK message to job output via `appendJobOutput()`
- Handles all message types: `system`, `assistant`, `tool_use`, `tool_result`, `error`
- Preserves message content and metadata in JSONL format
- Writes output immediately (no buffering) for real-time monitoring
- Updates job with final status when execution completes

### US-5: Capture Session ID for Resume/Fork
**As a** fleet operator  
**I want to** capture and persist the Claude session ID  
**So that** I can resume or fork agent sessions later

**Acceptance Criteria:**
- Extracts `session_id` from `system` message with `subtype: "init"`
- Updates job metadata with `session_id` once captured
- Persists session info via `updateSessionInfo()` for resume capability
- Stores agent name, session ID, timestamps, and job count
- Session ID available in `RunnerResult` for caller use

### US-6: Support Session Resume and Fork
**As a** fleet operator  
**I want to** resume or fork existing sessions  
**So that** agents can maintain context or branch into new conversations

**Acceptance Criteria:**
- Accepts optional `resume` parameter with session ID
- Passes `resume: sessionId` to SDK for session resumption
- Accepts optional `fork` parameter for forking sessions
- Passes `forkSession: true` to SDK when forking
- Creates job with `trigger_type: "fork"` and `forked_from` when forking
- Updates session info after resume/fork with new job count

### US-7: Handle SDK Errors Gracefully
**As a** fleet operator  
**I want to** graceful error handling when things go wrong  
**So that** failures are logged and reported properly

**Acceptance Criteria:**
- Catches SDK initialization errors (e.g., missing API key)
- Catches SDK streaming errors during execution
- Logs error messages to job output as `error` type messages
- Updates job status to `failed` with appropriate `exit_reason`
- Provides descriptive error messages with context (job ID, agent name)
- Returns error details in `RunnerResult`
- Does not crash on malformed SDK responses

### US-8: Extract Summary from Final Response
**As a** fleet operator  
**I want to** capture a summary of what the agent accomplished  
**So that** I can quickly understand job outcomes

**Acceptance Criteria:**
- Extracts summary from final `assistant` message content
- Truncates summary to reasonable length (500 chars max)
- Stores summary in job metadata via `updateJob()`
- Returns summary in `RunnerResult`
- Handles cases where no final assistant message exists

### US-9: Update Documentation
**As a** developer using herdctl  
**I want to** understand how the runner works  
**So that** I can effectively use and debug agent execution

**Acceptance Criteria:**
- Add **Runner** section to docs site under Internals
- Document SDK integration and async iterator pattern
- Explain all four permission modes with examples
- Document MCP server configuration options
- Explain session management (resume/fork)
- Document output streaming format and JSONL structure
- Include error handling patterns and troubleshooting

## Technical Specifications

### File Structure

```
packages/core/src/runner/
├── index.ts              # Public exports
├── runner.ts             # Main AgentRunner class and runAgent function
├── types.ts              # RunnerOptions, RunnerResult, SDKOptions, etc.
├── errors.ts             # RunnerError, SDKError, SessionError
├── message-handler.ts    # Process SDK messages, extract session ID, write to log
├── sdk-adapter.ts        # Transform agent config to SDK options format
└── __tests__/
    ├── runner.test.ts
    ├── message-handler.test.ts
    └── sdk-adapter.test.ts
```

### Public API

```typescript
// types.ts

import type { ResolvedAgentConfig } from "../config/index.js";
import type { TriggerType } from "../state/index.js";

/**
 * Options for running an agent
 */
export interface RunnerOptions {
  /** Fully resolved agent configuration */
  agent: ResolvedAgentConfig;
  /** The prompt to send to the agent */
  prompt: string;
  /** Path to the .herdctl directory */
  stateDir: string;
  /** How this run was triggered */
  triggerType?: TriggerType;
  /** Schedule name (if triggered by schedule) */
  schedule?: string;
  /** Session ID to resume (mutually exclusive with fork) */
  resume?: string;
  /** Fork from this session ID */
  fork?: string;
}

/**
 * Result of running an agent
 */
export interface RunnerResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** The job ID for this run */
  jobId: string;
  /** The session ID (for resume/fork) */
  sessionId?: string;
  /** Brief summary of what was accomplished */
  summary?: string;
  /** Error if the run failed */
  error?: Error;
  /** Duration in seconds */
  durationSeconds?: number;
}

/**
 * Callback for receiving messages during execution
 */
export type MessageCallback = (message: SDKMessage) => void | Promise<void>;

/**
 * Extended options including callbacks
 */
export interface RunnerOptionsWithCallbacks extends RunnerOptions {
  /** Called for each message from the SDK */
  onMessage?: MessageCallback;
}
```

```typescript
// runner.ts

import type { RunnerOptions, RunnerOptionsWithCallbacks, RunnerResult } from "./types.js";

/**
 * Run an agent with the given options
 * 
 * @param options - Runner options including agent config and prompt
 * @returns Result of the run including success status, job ID, and session ID
 * 
 * @example
 * ```typescript
 * const result = await runAgent({
 *   agent: resolvedAgent,
 *   prompt: "Check for new issues",
 *   stateDir: ".herdctl",
 *   triggerType: "schedule",
 *   schedule: "issue-check"
 * });
 * 
 * if (result.success) {
 *   console.log(`Job ${result.jobId} completed: ${result.summary}`);
 * }
 * ```
 */
export async function runAgent(options: RunnerOptionsWithCallbacks): Promise<RunnerResult>;

/**
 * AgentRunner class for more control over execution
 */
export class AgentRunner {
  constructor(stateDir: string);

  /**
   * Run an agent with the given options
   */
  async run(options: Omit<RunnerOptionsWithCallbacks, "stateDir">): Promise<RunnerResult>;

  /**
   * Resume a previous session with a new prompt
   */
  async resume(
    sessionId: string,
    agent: ResolvedAgentConfig,
    prompt: string,
    options?: { onMessage?: MessageCallback }
  ): Promise<RunnerResult>;

  /**
   * Fork a session and start a new conversation branch
   */
  async fork(
    sessionId: string,
    agent: ResolvedAgentConfig,
    prompt: string,
    options?: { onMessage?: MessageCallback }
  ): Promise<RunnerResult>;
}
```

### SDK Adapter

```typescript
// sdk-adapter.ts

import type { ResolvedAgentConfig } from "../config/index.js";

/**
 * SDK query options (matching Claude Agent SDK types)
 */
export interface SDKQueryOptions {
  allowedTools?: string[];
  deniedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  systemPrompt?: { type: "preset"; preset: string } | { type: "custom"; content: string };
  settingSources?: string[];
  mcpServers?: Record<string, SDKMcpServerConfig>;
  resume?: string;
  forkSession?: boolean;
}

/**
 * MCP server config for SDK
 */
export interface SDKMcpServerConfig {
  type?: "http";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Transform agent config to SDK query options
 */
export function toSDKOptions(
  agent: ResolvedAgentConfig,
  options?: { resume?: string; fork?: boolean }
): SDKQueryOptions;

/**
 * Transform MCP servers config to SDK format
 */
export function transformMcpServers(
  mcpServers: Record<string, McpServerConfig> | undefined
): Record<string, SDKMcpServerConfig> | undefined;
```

### Message Handler

```typescript
// message-handler.ts

import type { JobOutputInput } from "../state/index.js";

/**
 * SDK message types (as received from Claude Agent SDK)
 */
export interface SDKMessage {
  type: "system" | "assistant" | "tool_use" | "tool_result" | "error";
  subtype?: string;
  content?: string;
  session_id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  // ... other SDK-specific fields
}

/**
 * Result of processing a message
 */
export interface ProcessedMessage {
  /** The message transformed for job output */
  output: JobOutputInput;
  /** Session ID if this was an init message */
  sessionId?: string;
  /** Whether this is the final message */
  isFinal?: boolean;
}

/**
 * Process an SDK message for storage
 */
export function processMessage(message: SDKMessage): ProcessedMessage;

/**
 * Extract summary from assistant messages
 */
export function extractSummary(messages: SDKMessage[]): string | undefined;
```

### Error Classes

```typescript
// errors.ts

/**
 * Base error for runner failures
 */
export class RunnerError extends Error {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly agentName: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

/**
 * Error from the Claude Agent SDK
 */
export class SDKError extends RunnerError {
  constructor(
    message: string,
    jobId: string,
    agentName: string,
    public readonly sdkMessage?: SDKMessage
  ) {
    super(message, jobId, agentName);
    this.name = "SDKError";
  }
}

/**
 * Error related to session operations
 */
export class SessionError extends RunnerError {
  constructor(
    message: string,
    jobId: string,
    agentName: string,
    public readonly sessionId?: string
  ) {
    super(message, jobId, agentName);
    this.name = "SessionError";
  }
}

/**
 * Error when SDK is not available
 */
export class SDKNotFoundError extends Error {
  constructor() {
    super("Claude Agent SDK not found. Please install @anthropic-ai/claude-agent-sdk");
    this.name = "SDKNotFoundError";
  }
}
```

### Integration with State Module

```typescript
// Example flow in runner.ts

import { 
  createJob, 
  updateJob, 
  appendJobOutput, 
  updateSessionInfo,
  getStateDirectory 
} from "../state/index.js";

async function runAgent(options: RunnerOptionsWithCallbacks): Promise<RunnerResult> {
  const { agent, prompt, stateDir, triggerType = "manual", schedule, resume, fork } = options;
  
  // Get paths
  const jobsDir = join(stateDir, "jobs");
  const sessionsDir = join(stateDir, "sessions");
  
  // 1. Create job record
  const job = await createJob(jobsDir, {
    agent: agent.name,
    trigger_type: fork ? "fork" : triggerType,
    schedule,
    prompt,
    forked_from: fork,
  });
  
  // 2. Update to running status
  await updateJob(jobsDir, job.id, {
    status: "running",
    output_file: `${job.id}.jsonl`,
  });
  
  let sessionId: string | undefined;
  const messages: SDKMessage[] = [];
  
  try {
    // 3. Build SDK options from agent config
    const sdkOptions = toSDKOptions(agent, { resume: resume || fork, fork: !!fork });
    
    // 4. Run the agent
    for await (const message of query({ prompt, options: sdkOptions })) {
      // Store message
      messages.push(message);
      
      // Process and write to log
      const processed = processMessage(message);
      await appendJobOutput(jobsDir, job.id, processed.output);
      
      // Capture session ID from init message
      if (processed.sessionId) {
        sessionId = processed.sessionId;
        await updateJob(jobsDir, job.id, { session_id: sessionId });
      }
      
      // Call user callback if provided
      if (options.onMessage) {
        await options.onMessage(message);
      }
    }
    
    // 5. Extract summary and update job as completed
    const summary = extractSummary(messages);
    await updateJob(jobsDir, job.id, {
      status: "completed",
      exit_reason: "success",
      finished_at: new Date().toISOString(),
      summary,
    });
    
    // 6. Update session info for future resume/fork
    if (sessionId) {
      await updateSessionInfo(sessionsDir, agent.name, {
        session_id: sessionId,
        mode: "autonomous",
      });
    }
    
    return {
      success: true,
      jobId: job.id,
      sessionId,
      summary,
    };
    
  } catch (error) {
    // Handle errors
    await appendJobOutput(jobsDir, job.id, {
      type: "error",
      message: (error as Error).message,
    });
    
    await updateJob(jobsDir, job.id, {
      status: "failed",
      exit_reason: "error",
      finished_at: new Date().toISOString(),
    });
    
    return {
      success: false,
      jobId: job.id,
      sessionId,
      error: error as Error,
    };
  }
}
```

## Test Plan

### Unit Tests

```typescript
// __tests__/sdk-adapter.test.ts

describe("toSDKOptions", () => {
  it("maps permission mode correctly");
  it("defaults to acceptEdits when mode not specified");
  it("passes allowed_tools as allowedTools");
  it("passes denied_tools as deniedTools");
  it("uses claude_code preset for system prompt by default");
  it("uses custom system prompt when specified in agent config");
  it("passes resume option when provided");
  it("sets forkSession true when fork option provided");
});

describe("transformMcpServers", () => {
  it("transforms HTTP MCP server config");
  it("transforms process MCP server config");
  it("transforms MCP server with env vars");
  it("returns undefined for empty config");
  it("handles mixed HTTP and process servers");
});
```

```typescript
// __tests__/message-handler.test.ts

describe("processMessage", () => {
  it("extracts session_id from system init message");
  it("transforms assistant message to output format");
  it("transforms tool_use message with tool_name and input");
  it("transforms tool_result message");
  it("transforms error message");
  it("preserves all message fields");
});

describe("extractSummary", () => {
  it("extracts summary from last assistant message");
  it("truncates summary to 500 chars");
  it("returns undefined when no assistant messages");
  it("handles empty content in assistant messages");
});
```

```typescript
// __tests__/runner.test.ts

describe("runAgent", () => {
  // Note: These tests mock the SDK's query function
  
  it("creates job record before starting");
  it("updates job status to running");
  it("streams messages to job output");
  it("captures session ID from init message");
  it("updates job with session ID");
  it("extracts and stores summary on completion");
  it("updates session info on completion");
  it("handles SDK errors gracefully");
  it("marks job as failed on error");
  it("calls onMessage callback for each message");
});

describe("AgentRunner.resume", () => {
  it("passes resume option to SDK");
  it("creates job with correct trigger_type");
  it("increments session job_count");
});

describe("AgentRunner.fork", () => {
  it("passes forkSession true to SDK");
  it("creates job with trigger_type fork");
  it("sets forked_from in job metadata");
});
```

### Integration Tests

```typescript
// __tests__/runner.integration.test.ts

describe("Runner Integration", () => {
  // These tests use real state module with temp directories
  // but mock the SDK
  
  it("creates all expected state files");
  it("job output contains all messages");
  it("session file is created/updated");
  it("handles concurrent job writes");
});
```

### Test Fixtures

Create mock SDK message fixtures for consistent testing:

```typescript
// __tests__/fixtures/sdk-messages.ts

export const initMessage = {
  type: "system",
  subtype: "init",
  session_id: "claude-session-abc123",
};

export const assistantMessage = {
  type: "assistant",
  content: "I'll help you fix the bug in auth.ts",
};

export const toolUseMessage = {
  type: "tool_use",
  name: "Read",
  tool_use_id: "tool-123",
  input: { file_path: "src/auth.ts" },
};

export const toolResultMessage = {
  type: "tool_result",
  tool_use_id: "tool-123",
  content: "// auth.ts content...",
};

export const errorMessage = {
  type: "error",
  message: "Rate limit exceeded",
  code: "RATE_LIMIT",
};

export const fullConversation = [
  initMessage,
  assistantMessage,
  toolUseMessage,
  toolResultMessage,
  { type: "assistant", content: "I found the bug and fixed it." },
];
```

### Mock SDK

```typescript
// __tests__/mocks/sdk.ts

import type { SDKMessage } from "../../message-handler.js";

/**
 * Create a mock query function that yields given messages
 */
export function createMockQuery(messages: SDKMessage[]) {
  return async function* mockQuery(options: { prompt: string; options: unknown }) {
    for (const message of messages) {
      yield message;
    }
  };
}

/**
 * Create a mock query that throws an error
 */
export function createErrorQuery(error: Error) {
  return async function* mockQuery() {
    throw error;
  };
}
```

## Documentation Updates

Add the following to the docs site:

### New Page: `docs/src/content/docs/internals/runner.md`

```markdown
---
title: Agent Runner
description: How herdctl executes agents using the Claude Agent SDK
---

# Agent Runner

The runner module executes agents using the Claude Agent SDK. It handles configuration,
permissions, MCP servers, output streaming, and session management.

## How Agents Execute

1. **Job Creation**: A job record is created before execution starts
2. **SDK Initialization**: Agent config is transformed to SDK options
3. **Execution**: The SDK's `query()` function runs with the agent's prompt
4. **Output Streaming**: Each message is written to the job's JSONL log in real-time
5. **Session Capture**: The session ID is extracted and stored for resume/fork
6. **Completion**: Job is marked complete with summary extracted from final response

## Permission Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `default` | Requires approval for everything | Interactive debugging |
| `acceptEdits` | Auto-approve file operations | Standard autonomous agents |
| `bypassPermissions` | Auto-approve everything | Fully trusted agents |
| `plan` | No tool execution | Planning-only agents |

## MCP Server Configuration

Configure MCP servers per-agent for tool access:

```yaml
mcp_servers:
  posthog:
    type: http
    url: https://your-posthog-mcp.com
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    env:
      API_KEY: ${MCP_API_KEY}
```

## Session Management

### Resume
Continue a previous session with full context preserved:
```typescript
const result = await runner.resume(sessionId, agent, "Continue the previous task");
```

### Fork
Branch into a new conversation without modifying the original:
```typescript
const result = await runner.fork(sessionId, agent, "Try a different approach");
```

## Output Format

Job output is stored as JSONL with message types:
- `system`: SDK system messages (includes session init)
- `assistant`: Claude's responses
- `tool_use`: Tool invocations
- `tool_result`: Tool outputs
- `error`: Error messages

## Error Handling

The runner handles errors gracefully:
- SDK initialization failures
- Streaming errors during execution
- Timeout errors
- API rate limits

All errors are logged to the job output and the job is marked as failed.
```

## Quality Gates

For every user story:
- `pnpm typecheck` passes in packages/core
- `pnpm test` passes with >90% coverage of runner module
- Documentation updated and builds successfully (`pnpm build` in docs/)

## Acceptance Criteria Summary

1. `pnpm typecheck` passes in packages/core
2. `pnpm test` passes with >90% coverage of runner module
3. Can execute an agent with `runAgent()` function
4. Job lifecycle: creates job → updates to running → streams output → completes
5. Session ID captured from init message and stored
6. Resume and fork work with existing session IDs
7. Errors handled gracefully without crashing
8. Summary extracted from final assistant message
9. Documentation section added and builds successfully
10. Integration with state module verified (creates expected files)

## Out of Scope

- Timeout handling for long-running agents (will be addressed in scheduler PRD)
- Web UI integration (separate PRD)
- CLI commands (PRD 7: herdctl-cli)
- Multiple runtime backends (future consideration)
- Agent concurrency/queuing (scheduler responsibility)

## Notes

- The SDK uses async iterators - use `for await...of` pattern
- Write output immediately for real-time monitoring (no buffering)
- Session ID is critical - must be captured and persisted
- SDK may not be installed - handle gracefully with `SDKNotFoundError`
- Test using mocked SDK to avoid real API calls