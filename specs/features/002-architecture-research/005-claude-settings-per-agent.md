# Claude Settings Per Agent in herdctl

## Overview

This document describes how Claude Code settings (model, system prompt, CLAUDE.md, allowed tools, permissions, MCP servers, etc.) are configured per agent in a herdctl fleet, what is currently supported, what gaps exist, and recommended approaches for the missing pieces.

---

## 1. Current herdctl Agent Configuration Options

The agent config schema (`AgentConfigSchema` in `packages/core/src/config/schema.ts`) already supports a rich set of Claude-specific settings per agent:

```yaml
# Agent config file (e.g., agents/my-agent.yaml)
name: my-agent
description: What this agent does

# Claude model selection
model: claude-sonnet-4-20250514

# System prompt (replaces Claude Code's default prompt entirely)
system_prompt: |
  You are a code reviewer. Focus on security issues.

# Default prompt when triggered without --prompt
default_prompt: "Review the latest changes."

# Maximum agentic turns before stopping
max_turns: 25

# Session settings
session:
  max_turns: 25        # Alternative location for max_turns
  timeout: 30m         # Session expiry timeout
  model: claude-sonnet-4-20250514  # Alternative location for model

# Permission mode
permission_mode: acceptEdits  # default | acceptEdits | bypassPermissions | plan | delegate | dontAsk

# Tool access control
allowed_tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
denied_tools:
  - "Bash(sudo *)"
  - TodoWrite
  - Task

# MCP servers
mcp_servers:
  my-server:
    command: node
    args: ["./my-mcp-server.js"]
    env:
      API_KEY: "${MY_API_KEY}"
  remote-server:
    url: "https://mcp.example.com/sse"

# Setting sources (controls CLAUDE.md / .claude/ loading)
setting_sources: ["project"]  # user | project | local

# Runtime backend
runtime: sdk  # sdk | cli

# Identity (used for display, not passed to Claude SDK)
identity:
  name: CodeBot
  role: Senior Developer
  personality: Thorough and methodical

# Working directory (also affects setting_sources default)
working_directory: /path/to/project

# Docker containerization
docker:
  enabled: true
  image: "anthropic/claude-code:latest"
  # ... resource limits, volumes, etc.
```

### Fleet-Level Defaults

Settings can be specified at the fleet level in `herdctl.yaml` under `defaults:` and are merged into every agent:

```yaml
# herdctl.yaml
defaults:
  model: claude-sonnet-4-20250514
  permission_mode: acceptEdits
  max_turns: 25
  session:
    timeout: 30m
  allowed_tools:
    - Read
    - Write
    - Edit
  denied_tools:
    - TodoWrite
  docker:
    enabled: true
    memory: 2g
  working_directory: /shared/workspace
```

Agent-level values override fleet defaults. For objects, deep merge is used. For arrays, agent arrays replace default arrays entirely (no merge).

### Per-Agent Overrides in Fleet Config

Individual agents can be overridden directly in the fleet config:

```yaml
agents:
  - path: agents/coder.yaml
    overrides:
      model: claude-opus-4-20250514
      max_turns: 100
      schedules:
        check:
          interval: 1h
```

---

## 2. Claude Code Configuration Mechanisms

Claude Code has multiple configuration layers. Here is how each one works and how herdctl interacts with it.

### 2.1 SDK `query()` Options (Primary mechanism for SDK runtime)

The Claude Agent SDK's `query()` function accepts an `Options` object. herdctl translates agent config to SDK options via `toSDKOptions()` in `packages/core/src/runner/sdk-adapter.ts`.

**Currently mapped by herdctl:**

| SDK Option | herdctl Agent Config | Notes |
|---|---|---|
| `model` | `model` | Direct passthrough |
| `systemPrompt` | `system_prompt` | String or `{type:'preset', preset:'claude_code', append:'...'}` |
| `permissionMode` | `permission_mode` | Defaults to `acceptEdits` |
| `allowedTools` | `allowed_tools` | Direct passthrough |
| `disallowedTools` | `denied_tools` | Direct passthrough |
| `maxTurns` | `max_turns` or `session.max_turns` | Agent-level takes precedence |
| `settingSources` | `setting_sources` | Controls CLAUDE.md loading |
| `mcpServers` | `mcp_servers` | Transformed to SDK format |
| `cwd` | `working_directory` | Resolved to absolute path |
| `resume` | (managed internally) | Session resume |
| `forkSession` | (managed internally) | Session forking |

**SDK options NOT currently mapped by herdctl:**

| SDK Option | Purpose | Priority |
|---|---|---|
| `agents` | Define custom subagents (Task tool delegates) | Medium |
| `tools` | Restrict base tool set (different from allowedTools) | Medium |
| `env` | Custom environment variables for the Claude process | High |
| `maxThinkingTokens` | Limit thinking/reasoning token budget | Low |
| `maxBudgetUsd` | Cost budget per query | Medium |
| `fallbackModel` | Fallback if primary model fails | Low |
| `outputFormat` | Structured JSON output schema | Medium |
| `hooks` | SDK-level hook callbacks (PreToolUse, PostToolUse, etc.) | Medium |
| `plugins` | Load SDK plugins | Low |
| `sandbox` | Sandbox settings for command isolation | Low |
| `betas` | Beta features (e.g., 1M context window) | Low |
| `additionalDirectories` | Extra directories Claude can access | Medium |
| `persistSession` | Disable session persistence to disk | Low |
| `enableFileCheckpointing` | Enable file rewind capability | Low |
| `allowDangerouslySkipPermissions` | Required with bypassPermissions mode | Low |
| `extraArgs` | Additional CLI arguments passthrough | Low |

### 2.2 CLI Flags (Primary mechanism for CLI runtime)

The CLI runtime (`packages/core/src/runner/runtime/cli-runtime.ts`) builds `claude` CLI arguments from agent config.

**Currently mapped:**

| CLI Flag | herdctl Agent Config | Notes |
|---|---|---|
| `--model` | `model` | |
| `--system-prompt` | `system_prompt` | |
| `--permission-mode` | `permission_mode` | Defaults to `acceptEdits` |
| `--allowedTools` | `allowed_tools` | Comma-separated |
| `--disallowedTools` | `denied_tools` | Comma-separated |
| `--setting-sources` | `setting_sources` | Comma-separated |
| `--mcp-config` | `mcp_servers` | JSON serialized |
| `--resume` | (managed internally) | |
| `--fork-session` | (managed internally) | |

**CLI flags NOT currently mapped:**

| CLI Flag | Purpose | Priority |
|---|---|---|
| `--max-turns` | Limit agentic turns | High (exists in config, not passed to CLI) |
| `--output-format` | Structured output | Medium |
| `--tools` | Base tool set | Medium |
| `--verbose` | Debug output | Low |
| `--continue` | Continue most recent session | Low |

### 2.3 Environment Variables

Claude Code uses several environment variables:

| Variable | Purpose | herdctl Handling |
|---|---|---|
| `ANTHROPIC_API_KEY` | API authentication (SDK runtime) | Passed through to containers |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth authentication (Max plan) | Passed through to containers |
| `ANTHROPIC_MODEL` | Default model | Not explicitly handled |
| `CLAUDE_CODE_MAX_TURNS` | Default max turns | Not explicitly handled |
| `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` | SDK MCP call timeout | Not handled |

**Gap:** There is no `env` field on the agent config schema for non-Docker agents. The Docker config has `env` at the fleet level (`FleetDockerSchema`) but there is no general-purpose environment variable passthrough for agents running natively (without Docker). This is a significant gap.

### 2.4 CLAUDE.md and Settings Files

Claude Code loads project instructions from a hierarchy of files:

```
~/.claude/CLAUDE.md              # User-level (loaded when setting_sources includes "user")
~/.claude/settings.json          # User-level settings
<project>/.claude/settings.json  # Project-level (loaded when setting_sources includes "project")
<project>/.claude/settings.local.json  # Local overrides (loaded when setting_sources includes "local")
<project>/CLAUDE.md              # Project-level instructions
<project>/<subdir>/CLAUDE.md     # Directory-level instructions (walked up to project root)
```

**How herdctl handles this:**

The `setting_sources` agent config controls which settings Claude loads:

- `["project"]` (default when `working_directory` is set) -- loads `.claude/settings.json` and `CLAUDE.md` from the working directory
- `["user", "project", "local"]` -- loads all settings levels
- `[]` (default when no `working_directory`) -- loads nothing from filesystem; SDK isolation mode

This means:
1. If an agent's `working_directory` points to a project with a `CLAUDE.md`, that file is automatically loaded
2. Agents with `setting_sources: []` get a clean slate (no CLAUDE.md influence)
3. Agents can opt into user-level settings with `setting_sources: ["user", "project"]`

**Important:** Setting `setting_sources` to include `"project"` is required to load CLAUDE.md files. Without it, CLAUDE.md is ignored even if present in the working directory.

---

## 3. How to Configure Each Setting Per Agent

### 3.1 Model

```yaml
# Agent config
name: expensive-agent
model: claude-opus-4-20250514

# Or via fleet defaults
defaults:
  model: claude-sonnet-4-20250514
```

Works for both SDK and CLI runtimes. For SDK, passed as `model` option. For CLI, passed as `--model` flag.

### 3.2 System Prompt

```yaml
# Option 1: Replace entirely (string)
system_prompt: |
  You are a specialized code reviewer.
  Focus only on security vulnerabilities.
```

When `system_prompt` is set, it replaces Claude Code's default system prompt entirely. When omitted, the SDK uses the `claude_code` preset (the full Claude Code system prompt with all its tool instructions).

**Gap:** There is currently no way to *append* to Claude Code's default system prompt from the agent config. The SDK supports `{ type: 'preset', preset: 'claude_code', append: 'extra instructions' }` but herdctl only passes a plain string or the preset without append. To use append mode, you would need a new config field.

**Recommended approach for append mode:**

```yaml
# Proposed new syntax (not yet implemented)
system_prompt:
  preset: claude_code
  append: |
    Additional instructions for this agent.
    Always write tests before implementing.
```

### 3.3 CLAUDE.md Content Per Agent

There are three approaches:

**Approach A: Project-resident CLAUDE.md (current, works today)**

Point the agent's `working_directory` to a project that contains a `CLAUDE.md` file, and ensure `setting_sources` includes `"project"`:

```yaml
name: my-agent
working_directory: /path/to/my-project  # Has a CLAUDE.md in it
setting_sources: ["project"]            # Default when working_directory is set
```

This is the standard approach. The CLAUDE.md is loaded automatically by Claude Code from the working directory.

**Approach B: Disable CLAUDE.md loading**

```yaml
name: standalone-agent
setting_sources: []  # Don't load any filesystem settings
system_prompt: |
  All instructions go here instead.
```

**Approach C: Custom CLAUDE.md per agent (not yet implemented)**

For agents that need a different CLAUDE.md than what exists in the project, you would need to either:
1. Create separate working directories per agent with distinct CLAUDE.md files
2. Use `system_prompt` to embed the instructions directly (what most examples do today)
3. (Future) Add a `claude_md` config field that writes a temporary CLAUDE.md before execution

**Recommendation:** For most use cases, `system_prompt` is the right mechanism. CLAUDE.md is best for project-level instructions that all agents working on that project should follow. Agent-specific instructions belong in `system_prompt`.

### 3.4 MCP Servers

```yaml
name: my-agent
mcp_servers:
  # stdio-based MCP server
  linear:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-linear"]
    env:
      LINEAR_API_KEY: "${LINEAR_API_KEY}"

  # HTTP-based MCP server
  custom-api:
    url: "https://mcp.example.com/sse"
```

Works for both SDK and CLI runtimes:
- SDK: Transformed to SDK format via `transformMcpServers()` and passed as `mcpServers` option
- CLI: Serialized to JSON and passed via `--mcp-config` flag

**Note:** The SDK also supports `type: 'sdk'` MCP servers (in-process servers defined in code), but herdctl only supports `stdio` and `http` servers from config files.

### 3.5 Permissions and Tool Access

```yaml
name: restricted-agent
permission_mode: dontAsk  # Deny anything not pre-approved

allowed_tools:
  - Read
  - Glob
  - Grep

denied_tools:
  - Bash
  - Write
  - Edit
  - Task
  - TodoWrite
```

**Tool naming patterns:**
- Simple tool name: `Read`, `Write`, `Bash`
- Tool with pattern: `"Bash(sudo *)"` -- denies Bash commands matching the pattern
- MCP tool: `mcp__servername__toolname` -- MCP tools use this naming convention

### 3.6 Max Turns

```yaml
name: my-agent
max_turns: 50

# Or via session config
session:
  max_turns: 50
```

**Gap for CLI runtime:** `max_turns` is in the agent config and passed to the SDK via `maxTurns`, but it is NOT currently passed to the CLI runtime as `--max-turns`. The CLI runtime should map this.

### 3.7 Setting Sources

```yaml
# Load project settings (CLAUDE.md, .claude/settings.json)
setting_sources: ["project"]

# Load everything
setting_sources: ["user", "project", "local"]

# Load nothing (clean slate)
setting_sources: []
```

### 3.8 Runtime Selection

```yaml
# SDK runtime (default) - uses ANTHROPIC_API_KEY, standard pricing
runtime: sdk

# CLI runtime - uses Claude CLI, Max plan pricing
runtime: cli
```

---

## 4. What herdctl Currently Supports vs What Needs to Be Added

### Fully Supported

| Feature | SDK Runtime | CLI Runtime | Config Field |
|---|---|---|---|
| Model selection | Yes | Yes | `model` |
| System prompt (replace) | Yes | Yes | `system_prompt` |
| Permission mode | Yes | Yes | `permission_mode` |
| Allowed tools | Yes | Yes | `allowed_tools` |
| Denied tools | Yes | Yes | `denied_tools` |
| MCP servers | Yes | Yes | `mcp_servers` |
| Setting sources | Yes | Yes | `setting_sources` |
| Max turns (SDK) | Yes | No | `max_turns` |
| Session resume/fork | Yes | Yes | (internal) |
| Working directory | Yes | Yes | `working_directory` |
| Docker containerization | Yes | Yes | `docker` |
| Fleet defaults + merge | Yes | Yes | `defaults` |
| Per-agent overrides | Yes | Yes | `overrides` |

### Gaps / Needs to Be Added

| Feature | What's Missing | Priority | Recommended Approach |
|---|---|---|---|
| **Max turns for CLI** | `--max-turns` not passed to CLI | High | Add to CLI arg builder |
| **System prompt append mode** | Cannot append to `claude_code` preset | Medium | New config format: `system_prompt: {preset: claude_code, append: "..."}` |
| **Agent-level env vars** | No `env` field on agent config (only Docker has it) | High | Add `env: Record<string, string>` to `AgentConfigSchema` |
| **Cost budget** | `maxBudgetUsd` not exposed | Medium | Add `max_budget_usd` to agent config |
| **Custom subagents** | `agents` option not exposed | Medium | Add `agents` to agent config schema |
| **Base tool set** | `tools` option not exposed (different from `allowedTools`) | Low | Add `tools` to agent config schema |
| **Max thinking tokens** | `maxThinkingTokens` not exposed | Low | Add `max_thinking_tokens` to agent config |
| **Output format** | `outputFormat` not exposed | Medium | Add `output_format` to agent config schema |
| **SDK hooks** | SDK-level `hooks` callbacks not exposed | Low | Complex -- needs code-level integration |
| **Plugins** | SDK `plugins` not exposed | Low | Add `plugins` to agent config schema |
| **Fallback model** | `fallbackModel` not exposed | Low | Add `fallback_model` to agent config |
| **Beta features** | `betas` not exposed | Low | Add `betas` to agent config |
| **Additional directories** | `additionalDirectories` not exposed | Medium | Add `additional_directories` to agent config |
| **Per-agent CLAUDE.md content** | No way to specify CLAUDE.md inline | Low | Use `system_prompt` instead; or add `claude_md` field |
| **Persist session** | `persistSession` not exposed | Low | Add `persist_session` to agent config |

---

## 5. Recommended Approach

### Phase 1: Fix Immediate Gaps (High Priority)

1. **Pass `max_turns` to CLI runtime** -- Add `--max-turns` to the CLI arg builder in `cli-runtime.ts`

2. **Add agent-level `env` field** -- Add `env: z.record(z.string(), z.string()).optional()` to `AgentConfigSchema`. Pass these environment variables to the SDK's `env` option and to the CLI runtime's process environment.

3. **Support system prompt append mode** -- Extend `system_prompt` to accept either a string (current behavior) or an object:
   ```yaml
   system_prompt:
     preset: claude_code
     append: |
       Additional instructions here.
   ```
   Update `buildSystemPrompt()` in `sdk-adapter.ts` to handle this.

### Phase 2: Expose Key SDK Options (Medium Priority)

4. **Add `max_budget_usd`** to agent config and pass to SDK/CLI

5. **Add `additional_directories`** to agent config

6. **Add `output_format`** to agent config for structured output use cases

7. **Add `agents` (subagent definitions)** to agent config for Task tool delegation

### Phase 3: Advanced Options (Low Priority)

8. Add `max_thinking_tokens`, `fallback_model`, `betas`, `plugins`, `persist_session`

9. Consider SDK-level hooks integration (complex, may need code-level plugin system)

### Design Principles

- **Agent config is the single source of truth** for per-agent settings. Fleet defaults provide baseline values.
- **Both runtimes should support the same config fields** where possible. The SDK adapter and CLI arg builder should both handle every agent config field.
- **Prefer `system_prompt` over CLAUDE.md for agent-specific instructions.** CLAUDE.md is a project-level mechanism; agent identity and behavior belong in `system_prompt`.
- **Environment variables should be explicit** in agent config, not relying on ambient process.env inheritance. This makes fleet configs reproducible and auditable.

---

## 6. Implementation Details

### Where the code lives

| File | Purpose |
|---|---|
| `packages/core/src/config/schema.ts` | Zod schemas for all config (AgentConfigSchema, DefaultsSchema, etc.) |
| `packages/core/src/config/merge.ts` | Deep merge logic for fleet defaults into agent configs |
| `packages/core/src/config/loader.ts` | Config loading, agent resolution, ResolvedAgent type |
| `packages/core/src/runner/sdk-adapter.ts` | `toSDKOptions()` -- transforms agent config to SDK query options |
| `packages/core/src/runner/runtime/sdk-runtime.ts` | SDKRuntime -- calls SDK `query()` with transformed options |
| `packages/core/src/runner/runtime/cli-runtime.ts` | CLIRuntime -- builds CLI args and spawns `claude` process |
| `packages/core/src/runner/runtime/factory.ts` | RuntimeFactory -- creates SDK or CLI runtime based on config |
| `packages/core/src/runner/runtime/container-runner.ts` | ContainerRunner -- wraps runtime with Docker execution |
| `packages/core/src/runner/runtime/container-manager.ts` | Docker container lifecycle, mount building, env building |
| `packages/core/src/runner/job-executor.ts` | JobExecutor -- orchestrates job lifecycle, session management |
| `packages/core/src/runner/types.ts` | SDKQueryOptions, SDKMcpServerConfig, SDKSystemPrompt types |

### Adding a new agent config field (checklist)

1. Add the field to `AgentConfigSchema` in `packages/core/src/config/schema.ts`
2. Add it to `DefaultsSchema` if it should be inheritable from fleet defaults
3. Add merge logic in `packages/core/src/config/merge.ts` (scalar = agent wins, object = deep merge, array = agent replaces)
4. Map it in `toSDKOptions()` in `packages/core/src/runner/sdk-adapter.ts` for SDK runtime
5. Map it in `CLIRuntime.execute()` in `packages/core/src/runner/runtime/cli-runtime.ts` for CLI runtime
6. Update `SDKQueryOptions` type in `packages/core/src/runner/types.ts` if needed
7. Add tests for the new field in sdk-adapter tests and CLI runtime tests
8. Update examples if relevant

### Claude Agent SDK `Options` Reference (v0.1.77)

For reference, here is the complete `Options` type from the SDK, showing all available fields:

```typescript
type Options = {
  abortController?: AbortController;
  additionalDirectories?: string[];
  agents?: Record<string, AgentDefinition>;
  allowedTools?: string[];
  allowDangerouslySkipPermissions?: boolean;
  betas?: SdkBeta[];
  canUseTool?: CanUseTool;
  continue?: boolean;
  cwd?: string;
  disallowedTools?: string[];
  enableFileCheckpointing?: boolean;
  env?: Record<string, string | undefined>;
  executable?: 'bun' | 'deno' | 'node';
  executableArgs?: string[];
  extraArgs?: Record<string, string | null>;
  fallbackModel?: string;
  forkSession?: boolean;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  includePartialMessages?: boolean;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  maxTurns?: number;
  mcpServers?: Record<string, McpServerConfig>;
  model?: string;
  outputFormat?: OutputFormat;
  pathToClaudeCodeExecutable?: string;
  permissionMode?: PermissionMode;
  permissionPromptToolName?: string;
  persistSession?: boolean;
  plugins?: SdkPluginConfig[];
  resume?: string;
  resumeSessionAt?: string;
  sandbox?: SandboxSettings;
  settingSources?: SettingSource[];
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
  stderr?: (data: string) => void;
  strictMcpConfig?: boolean;
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
};
```
