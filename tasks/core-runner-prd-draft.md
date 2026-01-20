# Context for PRD Creation: herdctl-core-runner

I'm building **herdctl** - an autonomous agent fleet management system for Claude Code.

## Project Documentation - READ THESE FILES

Please thoroughly read these files for full context:

1. **SPEC.md** - Complete technical specification, especially:
   - "Runtime: Claude Agent SDK" section
   - Permission model and allowed tools
   - MCP configuration per agent
   - Session management (resume, fork)
   - Streaming output format
   - Job data structures

2. **plan.md** - Implementation plan showing PRD sequence and dependencies

3. **packages/core/src/config/** - Config module (PRD 1):
   - `schema.ts` - AgentConfig, PermissionsSchema, McpServerSchema
   - Understand the config types the runner will consume

4. **packages/core/src/state/** - State module (PRD 2):
   - `job-metadata.ts` - Job record creation/updates
   - `job-output.ts` - JSONL streaming output
   - `session.ts` - Session state persistence
   - Understand how runner will write state

5. **tasks/config-parsing-prd.md** - Example PRD format

## What's Been Built

**PRD 1 (Config Parsing) - Complete:**
- AgentConfig schema with permissions, mcp_servers, session config
- PermissionsSchema with mode, allowed_tools, denied_tools
- McpServerSchema for HTTP and process-based MCP servers

**PRD 2 (State Management) - Complete:**
- Job metadata creation and updates
- Job output JSONL streaming (appendJobOutput)
- Session state persistence per agent
- Atomic writes for crash safety

**PRD 3 (Docs) - In Progress:**
- Documentation site being built

## PRD 4 Scope: herdctl-core-runner

Build the **agent runner** module in `packages/core/src/runner/`.

This module wraps the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to execute agents with proper configuration, permissions, and output handling.

From plan.md, the user stories are:
1. Initialize SDK with agent config
2. Pass MCP servers from agent config
3. Pass allowed tools and permission mode
4. Stream output to job log (JSONL)
5. Capture session ID for resume/fork
6. Handle SDK errors gracefully
7. **Update documentation**: Add Runner section to docs site

## Key Requirements from SPEC.md

### SDK Integration

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Check GitHub issues and fix the oldest one",
  options: {
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["project", "local"],
    mcpServers: { ... },
  }
})) {
  // Handle streaming messages
}
```

### Permission Modes
- `default` - Requires approval for everything
- `acceptEdits` - Auto-approve file operations
- `bypassPermissions` - Auto-approve everything
- `plan` - No tool execution, planning only

### MCP Server Configuration
```typescript
mcpServers: {
  "posthog": {
    type: "http",
    url: "https://your-posthog-mcp.com"
  },
  "filesystem": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  }
}
```

### Message Types to Handle
- `system` (subtype: `init`) - Capture session_id
- `assistant` - Claude's text responses
- `tool_use` - Tool invocation
- `tool_result` - Tool output
- `error` - SDK errors

### Session Management
- Capture session ID from init message for resume/fork
- Support `resume: sessionId` option to continue sessions
- Support `forkSession: true` to branch without modifying original

## File Structure

```
packages/core/src/runner/
├── index.ts              # Public exports
├── runner.ts             # Main AgentRunner class
├── types.ts              # RunnerOptions, RunnerResult, etc.
├── errors.ts             # RunnerError, SDKError, etc.
├── message-handler.ts    # Process SDK messages, write to job log
└── __tests__/
    ├── runner.test.ts
    └── message-handler.test.ts
```

## Public API

```typescript
// Main runner interface
export interface RunnerOptions {
  agent: ResolvedAgentConfig;
  prompt: string;
  jobId: string;
  stateDir: string;           // .herdctl/ path
  resume?: string;            // Session ID to resume
  fork?: boolean;             // Fork the session
}

export interface RunnerResult {
  success: boolean;
  sessionId: string;
  error?: Error;
  summary?: string;           // Extracted from final assistant message
}

export async function runAgent(options: RunnerOptions): Promise<RunnerResult>;

// Or class-based:
export class AgentRunner {
  constructor(stateDir: string);

  async run(options: Omit<RunnerOptions, 'stateDir'>): Promise<RunnerResult>;
  async resume(sessionId: string, prompt: string): Promise<RunnerResult>;
  async fork(sessionId: string, prompt: string): Promise<RunnerResult>;
}
```

## Integration with State Module

The runner should:
1. Create job record when starting (`createJob`)
2. Update job status to 'running' (`updateJob`)
3. Stream messages to job output (`appendJobOutput`)
4. Update job with final status, session ID, summary (`updateJob`)
5. Save session info for resume capability (`saveSessionInfo`)

## Error Handling

```typescript
export class RunnerError extends Error {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}

export class SDKError extends RunnerError {
  constructor(
    message: string,
    jobId: string,
    public readonly sdkMessage?: unknown
  ) {
    super(message, jobId);
    this.name = 'SDKError';
  }
}
```

## Testing Strategy

Since the Claude Agent SDK makes real API calls, tests should:
- Mock the SDK's `query` function
- Test message handling with fixture data
- Test error scenarios
- Test integration with state module (can use real state module with temp dirs)

## Quality Gates

For every user story:
- `pnpm typecheck` passes in packages/core
- `pnpm test` passes with >90% coverage of runner module
- Documentation updated and builds successfully

## Documentation Updates

Add to docs site:
- **Runner** section under Internals covering:
  - How agents are executed
  - SDK integration details
  - Permission modes explained
  - MCP server configuration
  - Session management (resume/fork)
  - Output streaming format
  - Error handling

## Dependencies

- `@anthropic-ai/claude-agent-sdk` - Already in package.json
- herdctl-core-config - For agent config types
- herdctl-core-state - For job/session state
- herdctl-docs - For documentation updates

## Notes

- The SDK is async iterator based - use `for await...of`
- Each message should be written to job output immediately (streaming)
- Session ID is critical - must be captured and persisted
- Consider timeout handling for long-running agents
- May need to handle SDK not being installed (graceful error)

Please create a detailed PRD with user stories, acceptance criteria, file structure, and test plan - following the same quality and structure as ./tasks/config-parsing-prd.md
