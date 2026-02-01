# Phase 3: Docker Integration - Research

**Researched:** 2026-02-01
**Domain:** Docker containerization, Node.js process management, security hardening
**Confidence:** HIGH

## Summary

This phase adds optional Docker containerization to herdctl, wrapping existing runtimes (SDK or CLI) in a decorator pattern that provides security isolation, resource limits, and path translation. The implementation uses **dockerode** (the standard Node.js Docker library) to manage containers programmatically, with the ContainerRunner decorator transparently intercepting runtime execution to run inside Docker containers.

Key implementation insights:
- The decorator pattern aligns perfectly with herdctl's existing RuntimeInterface—ContainerRunner implements RuntimeInterface and wraps another runtime
- Docker containers require careful path translation between host and container paths for workspaces, auth files, and session storage
- The official `anthropic/claude-code` Docker image provides a production-ready base with Claude Code pre-installed
- Security hardening uses established Docker flags: `--security-opt=no-new-privileges`, `--cap-drop ALL`, and non-root user execution

**Primary recommendation:** Use dockerode for programmatic Docker control, implement ContainerRunner as a RuntimeInterface decorator, and store container sessions in `.herdctl/docker-sessions/` to avoid path conflicts with host sessions.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| [dockerode](https://github.com/apocas/dockerode) | ^4.0.0 | Docker Remote API client | De facto standard for Node.js Docker control; full API coverage, stream support, TypeScript types |
| [@types/dockerode](https://www.npmjs.com/package/@types/dockerode) | ^3.3.0 | TypeScript definitions | DefinitelyTyped maintained, updated Jan 2026 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| docker-modem | (via dockerode) | Docker daemon communication | Automatically used by dockerode |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| dockerode | child_process + docker CLI | More direct but loses stream demuxing, entity abstraction, and promise support |
| dockerode | testcontainers | Designed for testing, not production runtime management |

**Installation:**
```bash
pnpm add dockerode @types/dockerode
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── runner/
│   └── runtime/
│       ├── interface.ts          # Existing RuntimeInterface
│       ├── sdk-runtime.ts        # Existing SDKRuntime
│       ├── cli-runtime.ts        # Existing CLIRuntime
│       ├── container-runner.ts   # NEW: ContainerRunner decorator
│       ├── docker-config.ts      # NEW: Docker configuration types
│       └── factory.ts            # Updated to wrap with ContainerRunner
├── state/
│   └── docker-sessions/          # Container session storage
└── config/
    └── schema.ts                 # Extended docker schema
```

### Pattern 1: Decorator Pattern for ContainerRunner
**What:** ContainerRunner wraps any RuntimeInterface (SDK or CLI) and transparently executes inside Docker containers
**When to use:** When agent.docker.enabled is true
**Example:**
```typescript
// Source: Based on RuntimeInterface pattern from existing codebase
export class ContainerRunner implements RuntimeInterface {
  constructor(
    private wrapped: RuntimeInterface,
    private dockerConfig: DockerConfig,
    private docker: Docker
  ) {}

  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    // 1. Create or reuse container
    const container = await this.ensureContainer(options);

    // 2. Translate paths for container
    const containerOptions = this.translatePaths(options);

    // 3. Execute wrapped runtime inside container
    const exec = await container.exec({
      Cmd: this.buildCommand(containerOptions),
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    // 4. Stream output and yield SDKMessages
    const stream = await exec.start({ hijack: true });
    for await (const message of this.parseStream(stream)) {
      yield message;
    }

    // 5. Handle cleanup based on config (ephemeral vs persistent)
  }
}
```

### Pattern 2: RuntimeFactory Extension
**What:** Factory wraps runtime with ContainerRunner when docker is enabled
**When to use:** Always in RuntimeFactory.create()
**Example:**
```typescript
// Source: Extension of existing factory.ts
export class RuntimeFactory {
  static create(agent: ResolvedAgent): RuntimeInterface {
    // Create base runtime
    const runtimeType = agent.runtime ?? 'sdk';
    let runtime: RuntimeInterface;

    switch (runtimeType) {
      case 'sdk':
        runtime = new SDKRuntime();
        break;
      case 'cli':
        runtime = new CLIRuntime();
        break;
    }

    // Wrap with ContainerRunner if docker enabled
    if (agent.docker?.enabled) {
      const docker = new Docker();
      runtime = new ContainerRunner(runtime, agent.docker, docker);
    }

    return runtime;
  }
}
```

### Pattern 3: Path Translation
**What:** Map host paths to container paths consistently
**When to use:** For workspace, auth files, and session storage
**Example:**
```typescript
// Source: Container path mapping patterns
interface PathMapping {
  hostPath: string;
  containerPath: string;
  mode: 'ro' | 'rw';
}

function createMounts(agent: ResolvedAgent, stateDir: string): PathMapping[] {
  const mounts: PathMapping[] = [];

  // Workspace (read-write by default, configurable)
  const workspace = typeof agent.workspace === 'string'
    ? agent.workspace
    : agent.workspace?.root;
  if (workspace) {
    mounts.push({
      hostPath: workspace,
      containerPath: '/workspace',
      mode: agent.docker?.workspaceReadOnly ? 'ro' : 'rw',
    });
  }

  // Auth - prefer env var, fallback to mounted file
  if (!process.env.ANTHROPIC_API_KEY) {
    mounts.push({
      hostPath: path.join(os.homedir(), '.claude'),
      containerPath: '/home/agent/.claude',
      mode: 'ro',  // Always read-only for security
    });
  }

  // Docker sessions (separate from host sessions)
  mounts.push({
    hostPath: path.join(stateDir, 'docker-sessions'),
    containerPath: '/home/agent/.herdctl/sessions',
    mode: 'rw',
  });

  return mounts;
}
```

### Pattern 4: Container Lifecycle Management
**What:** Handle ephemeral vs persistent containers based on agent config
**When to use:** Container creation and cleanup
**Example:**
```typescript
// Source: dockerode container patterns
class ContainerManager {
  private runningContainers = new Map<string, Container>();

  async getOrCreateContainer(
    agentName: string,
    config: DockerConfig
  ): Promise<Container> {
    // For persistent containers, check if already running
    if (!config.ephemeral) {
      const existing = this.runningContainers.get(agentName);
      if (existing) {
        const info = await existing.inspect();
        if (info.State.Running) {
          return existing;
        }
      }
    }

    // Create new container
    const container = await this.docker.createContainer({
      Image: config.image ?? 'anthropic/claude-code:latest',
      name: `herdctl-${agentName}-${Date.now()}`,
      HostConfig: {
        AutoRemove: config.ephemeral ?? false,
        Memory: this.parseMemory(config.memory ?? '2g'),
        CpuShares: config.cpuShares,
        NetworkMode: config.network ?? 'bridge',
        Binds: this.buildBinds(config.mounts),
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
      },
      User: config.user ?? '1000:1000',  // Match host UID/GID
      Env: this.buildEnv(config),
    });

    if (!config.ephemeral) {
      this.runningContainers.set(agentName, container);
    }

    return container;
  }
}
```

### Anti-Patterns to Avoid
- **Direct Docker CLI calls:** Don't spawn `docker run` via child_process—use dockerode for proper stream handling and error management
- **Root user in containers:** Always configure non-root user; default to matching host UID/GID to avoid permission issues
- **Shared session directories:** Never share `.herdctl/sessions/` between host and container—path incompatibility causes resume failures
- **Missing AutoRemove for ephemeral:** Forgetting `--rm` leaves orphaned containers consuming resources

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Docker communication | Custom socket/HTTP client | dockerode | Complex stream demuxing, TLS, proxy support already solved |
| Container health checks | Manual polling | dockerode's wait strategies | Race conditions in readiness detection |
| Memory limit parsing | Regex string parsing | dockerode's built-in handling | Units like "2g", "512m" need proper conversion |
| stdout/stderr demuxing | Manual stream splitting | `container.modem.demuxStream()` | Docker multiplexes streams in non-TTY mode |

**Key insight:** Docker's Remote API has many edge cases (stream framing, health checks, signal handling). dockerode handles all of these with years of battle-testing.

## Common Pitfalls

### Pitfall 1: Session Path Mismatch
**What goes wrong:** Host session files reference host paths; container sessions reference container paths. Attempting to resume a host session from a container fails because paths don't exist.
**Why it happens:** Sessions store absolute paths for Claude's working directory.
**How to avoid:** Store Docker sessions in `.herdctl/docker-sessions/<agent>.json`, completely separate from host sessions in `.herdctl/sessions/`. Never attempt to resume host sessions from containers.
**Warning signs:** "Session not found" errors when docker.enabled changes, or path-related errors during resume.

### Pitfall 2: Permission Denied on Mounted Volumes
**What goes wrong:** Container runs as non-root user but can't write to workspace or session directories.
**Why it happens:** Host directories owned by host UID; container user has different UID.
**How to avoid:** Configure container user to match host UID/GID with `User: '${process.getuid()}:${process.getgid()}'` or use numeric values from config.
**Warning signs:** EACCES errors on file writes, empty output directories.

### Pitfall 3: Orphaned Containers After Crashes
**What goes wrong:** herdctl crashes mid-job, leaving containers running. Resources leak, port conflicts occur.
**Why it happens:** Container not created with AutoRemove, and cleanup code didn't run.
**How to avoid:** Use `AutoRemove: true` for ephemeral containers. For persistent containers, implement cleanup on startup that removes containers matching `herdctl-*` pattern older than configured threshold.
**Warning signs:** `docker ps` shows many herdctl containers, port binding errors.

### Pitfall 4: Auth File Not Found in Container
**What goes wrong:** Claude CLI can't authenticate—no API key available.
**Why it happens:** Auth file (~/.claude/) not mounted, and ANTHROPIC_API_KEY not passed.
**How to avoid:** Always pass ANTHROPIC_API_KEY via environment variable (preferred), OR mount ~/.claude/ read-only. Never both—env var takes precedence.
**Warning signs:** Authentication prompts in non-interactive container, exit code 1 with auth errors.

### Pitfall 5: Network Isolation Breaks MCP Servers
**What goes wrong:** Agent can't reach MCP servers configured in agent config.
**Why it happens:** NetworkMode: 'none' blocks all network access.
**How to avoid:** Default to 'bridge' mode. Only use 'none' when agent genuinely doesn't need network (rare). Document that MCP servers may need network access.
**Warning signs:** MCP connection timeouts, "could not connect" errors in logs.

## Code Examples

Verified patterns from official sources:

### Container Creation with Security Hardening
```typescript
// Source: OWASP Docker Security Cheat Sheet + dockerode docs
async function createSecureContainer(
  docker: Docker,
  config: DockerConfig,
  mounts: PathMapping[]
): Promise<Docker.Container> {
  const container = await docker.createContainer({
    Image: config.image ?? 'anthropic/claude-code:latest',
    name: config.containerName,

    HostConfig: {
      // Resource limits
      Memory: parseBytes(config.memory ?? '2g'),
      MemorySwap: parseBytes(config.memory ?? '2g'),  // Same as memory = no swap
      CpuShares: config.cpuShares ?? 512,

      // Network isolation
      NetworkMode: config.network ?? 'bridge',

      // Volume mounts
      Binds: mounts.map(m => `${m.hostPath}:${m.containerPath}:${m.mode}`),

      // Security hardening
      SecurityOpt: ['no-new-privileges:true'],
      CapDrop: ['ALL'],
      ReadonlyRootfs: false,  // Claude needs to write temp files

      // Cleanup
      AutoRemove: config.ephemeral ?? false,
    },

    // Non-root user
    User: config.user ?? `${process.getuid()}:${process.getgid()}`,

    // Working directory
    WorkingDir: '/workspace',

    // Environment variables
    Env: [
      ...(process.env.ANTHROPIC_API_KEY
        ? [`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`]
        : []),
      'TERM=xterm-256color',
    ],
  });

  return container;
}
```

### Stream Demultiplexing for Command Output
```typescript
// Source: dockerode documentation
async function executeInContainer(
  container: Docker.Container,
  command: string[]
): Promise<AsyncIterable<Buffer>> {
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,  // Non-TTY mode for proper stream separation
  });

  const stream = await exec.start({ hijack: true });

  // Demultiplex stdout/stderr
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  container.modem.demuxStream(stream, stdout, stderr);

  // Merge for unified output (or handle separately)
  return stdout;
}
```

### Cleanup Old Containers
```typescript
// Source: dockerode listContainers + remove patterns
async function cleanupOldContainers(
  docker: Docker,
  agentName: string,
  maxCount: number
): Promise<void> {
  const containers = await docker.listContainers({
    all: true,
    filters: {
      name: [`herdctl-${agentName}-`],
    },
  });

  // Sort by creation time, oldest first
  const sorted = containers.sort((a, b) => a.Created - b.Created);

  // Remove oldest until under limit
  const toRemove = sorted.slice(0, Math.max(0, sorted.length - maxCount));

  for (const info of toRemove) {
    const container = docker.getContainer(info.Id);
    try {
      await container.remove({ force: true });
    } catch (error) {
      // Ignore errors for already-removed containers
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `docker run` via CLI | dockerode programmatic API | 2020+ | Better error handling, stream control |
| Root user in containers | Non-root with UID mapping | 2022+ | Security best practice |
| Privileged mode | Minimal capabilities | 2020+ | Reduced attack surface |
| Single auth method | Env var preferred, file fallback | 2025+ | API key management aligned with Anthropic recommendations |

**Deprecated/outdated:**
- **Docker-in-Docker for isolation:** Not needed; bind mounts provide sufficient isolation for this use case
- **Custom Dockerfile per agent:** Use official `anthropic/claude-code` image with runtime configuration

## Open Questions

Things that couldn't be fully resolved:

1. **Container reuse across herdctl restarts**
   - What we know: Config allows ephemeral vs persistent containers
   - What's unclear: Should persistent containers survive herdctl daemon restarts? How to reconnect?
   - Recommendation: For v1, treat persistent as "reuse within session" but clean up on daemon stop. Future enhancement for true persistence.

2. **Claude CLI auth in containers**
   - What we know: ANTHROPIC_API_KEY works for SDK. CLI may need ~/.claude/ directory.
   - What's unclear: Does CLI runtime work with only env var, or does it require config files?
   - Recommendation: Test both approaches; prefer env var, document file mount fallback.

3. **MCP server port conflicts**
   - What we know: MCP servers may bind to localhost ports
   - What's unclear: How to handle port mapping when multiple containers run same agent?
   - Recommendation: For v1, assume agents don't run concurrently. Document port conflict risk.

## Sources

### Primary (HIGH confidence)
- [dockerode GitHub](https://github.com/apocas/dockerode) - API patterns, stream handling, createContainer options
- [Docker Official Docs - Claude Code](https://docs.docker.com/ai/sandboxes/claude-code/) - Official image, configuration
- [Anthropic claude-code devcontainer](https://github.com/anthropics/claude-code/blob/main/.devcontainer/Dockerfile) - Base image setup, security model
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) - Security flags, capability dropping

### Secondary (MEDIUM confidence)
- [OWASP NodeJS Docker Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NodeJS_Docker_Cheat_Sheet.html) - Process handling, signal forwarding
- [Testcontainers Wait Strategies](https://node.testcontainers.org/features/wait-strategies/) - Container readiness patterns

### Tertiary (LOW confidence)
- Web search results for Docker best practices 2026 - Verified against official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - dockerode is the established Node.js Docker client with extensive documentation
- Architecture: HIGH - Decorator pattern directly maps to existing RuntimeInterface
- Pitfalls: HIGH - Based on official security documentation and common patterns
- Path translation: MEDIUM - Logic is clear but needs validation against actual Claude CLI behavior

**Research date:** 2026-02-01
**Valid until:** 60 days (Docker patterns stable, but verify anthropic/claude-code image updates)
