---
title: Docker Configuration
description: Run agents in isolated Docker containers for security
---

Herdctl supports running agents inside Docker containers for security isolation, resource limits, and clean execution environments. This page covers the Docker security model, configuration options, and best practices.

## Overview

Docker containerization provides multiple benefits for agent execution:

- **Security isolation** — Untrusted prompts run in isolated containers
- **Resource limits** — Control memory and CPU usage per agent
- **Network isolation** — Optional network restrictions (none/bridge/host)
- **Clean environment** — Fresh or ephemeral containers per job
- **Reproducibility** — Consistent execution environment across hosts

## Tiered Security Model

Docker configuration options are split into two tiers based on security risk:

### Agent-Level Options (Safe)

These options can be set in agent config files (`herdctl-agent.yaml`). They control resources and behavior but cannot grant dangerous capabilities:

| Option | Description |
|--------|-------------|
| `enabled` | Enable Docker execution |
| `ephemeral` | Fresh container per job |
| `memory` | Memory limit |
| `cpu_shares` | CPU relative weight |
| `cpu_period` / `cpu_quota` | Hard CPU limits |
| `max_containers` | Container pool limit |
| `workspace_mode` | Workspace mount mode (`rw` or `ro`) |
| `tmpfs` | Tmpfs mounts for in-memory temp storage |
| `pids_limit` | Maximum number of processes |
| `labels` | Container labels for organization |

### Fleet-Level Options (Potentially Dangerous)

These options can **only** be set in fleet config (`herdctl.yaml`) or via per-agent overrides. They can grant capabilities that could be exploited:

| Option | Risk | Description |
|--------|------|-------------|
| `image` | Medium | Custom Docker image could contain malicious code |
| `network` | High | `host` mode bypasses network isolation |
| `volumes` | Critical | Could mount sensitive host directories |
| `user` | Medium | Could run as privileged user |
| `ports` | Medium | Exposes container ports to host/network |
| `env` | High | Could inject credentials or modify behavior |
| `host_config` | Critical | Raw dockerode passthrough, full Docker access |

### Why the Split?

Agent config files live in the agent's working directory, which the agent can modify. If dangerous options were allowed at agent level, an agent could:

- Grant itself `network: host` to bypass network isolation
- Mount `/etc/passwd` or `~/.ssh` via `volumes`
- Inject malicious environment variables
- Run as root via `user: "0:0"`

By restricting dangerous options to fleet config (which agents cannot modify), you maintain security even if an agent is compromised.

### Per-Agent Overrides

To set fleet-level options for specific agents, use overrides in your fleet config:

```yaml
# herdctl.yaml
agents:
  - path: ./agents/trusted-agent.yaml
    overrides:
      docker:
        network: host           # This agent needs host network
        env:
          GITHUB_TOKEN: "${GITHUB_TOKEN}"

  - path: ./agents/standard-agent.yaml
    # Uses fleet defaults, no overrides needed
```

## Prerequisites

Before using Docker runtime, you must build the herdctl Docker image:

```bash
# From the herdctl repository root
docker build -t herdctl/runtime:latest .
```

This image includes:
- Node.js 22
- Claude CLI (`@anthropic-ai/claude-code`)
- Git and essential tools
- Workspace directory at `/workspace`

**Note:** The image must be built locally - there is no pre-built image on Docker Hub yet.

## Security Model

Herdctl's Docker implementation follows security best practices to isolate agents and protect the host system.

### Security Guarantees

When Docker is enabled, the following security measures are enforced:

1. **Non-root execution**
   - Containers run as non-root user (matches host UID:GID by default)
   - Prevents privilege escalation inside container
   - Files created match host user ownership

2. **Capability dropping**
   - `--cap-drop=ALL` removes all Linux capabilities
   - Prevents container from gaining elevated privileges
   - Limits kernel-level operations

3. **No new privileges**
   - `--security-opt no-new-privileges` prevents privilege escalation
   - Blocks setuid/setgid executables from gaining privileges
   - Prevents container breakout via SUID binaries

4. **Read-only auth mounts**
   - Authentication files mounted read-only at `~/.claude/`
   - Container cannot modify API keys or credentials
   - Prevents credential tampering

5. **Configurable workspace access**
   - Workspace mounted read-write by default (`workspace_mode: rw`)
   - Can be set to read-only (`workspace_mode: ro`) for maximum isolation
   - Prevents file modification when read-only

6. **Network isolation options**
   - `none` — No network access (maximum isolation)
   - `bridge` — Standard Docker networking with NAT (default)
   - `host` — Share host network (performance-critical, trusted only)

### Security Trade-offs

| Configuration | Security | Use Case |
|---------------|----------|----------|
| `network: none` + `workspace_mode: ro` | **Maximum** | Untrusted prompts, read-only analysis |
| `network: bridge` + `workspace_mode: rw` | **Balanced** | Standard agents, API access needed |
| `network: host` + `workspace_mode: rw` | **Minimal** | Trusted agents, performance-critical |

## Configuration Reference

All Docker configuration is optional. Defaults provide secure, sensible behavior.

### Agent-Level Example

Options available in agent config files:

```yaml
# herdctl-agent.yaml
docker:
  enabled: true
  memory: "2g"
  cpu_shares: 1024
  cpu_period: 100000
  cpu_quota: 50000        # 50% CPU limit
  workspace_mode: "rw"
  ephemeral: true
  max_containers: 5
  tmpfs:
    - "/tmp"
    - "/run"
  pids_limit: 100
  labels:
    team: backend
    environment: staging
```

### Fleet-Level Example

Full options available in fleet config:

```yaml
# herdctl.yaml
defaults:
  docker:
    enabled: true
    image: "herdctl/runtime:latest"
    network: "bridge"
    memory: "2g"
    user: "1000:1000"
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
    volumes:
      - "/host/data:/container/data:ro"
    ports:
      - "8080:80"
```

### Advanced: host_config Passthrough

For dockerode options not in our schema, use `host_config` at fleet level:

```yaml
# herdctl.yaml
defaults:
  docker:
    enabled: true
    memory: "2g"
    host_config:           # Raw dockerode HostConfig
      ShmSize: 67108864    # 64MB shared memory
      Privileged: true     # Use with extreme caution!
      Devices:
        - PathOnHost: "/dev/nvidia0"
          PathInContainer: "/dev/nvidia0"
          CgroupPermissions: "rwm"
```

Values in `host_config` override any translated options. See [dockerode HostConfig](https://github.com/apocas/dockerode) for available options.

:::caution[host_config Security]
`host_config` provides unrestricted access to Docker's HostConfig. Only use for advanced scenarios where our schema doesn't provide the option you need. Review all options carefully.
:::

### Field Reference

#### Agent-Level Fields (Safe)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Docker execution |
| `ephemeral` | boolean | `true` | Fresh container per job vs reuse |
| `memory` | string | `2g` | Memory limit (e.g., `"512m"`, `"4g"`) |
| `cpu_shares` | integer | — | CPU relative weight (soft limit) |
| `cpu_period` | integer | — | CPU CFS period in microseconds |
| `cpu_quota` | integer | — | CPU CFS quota in microseconds |
| `max_containers` | integer | `5` | Container pool limit |
| `workspace_mode` | string | `rw` | Workspace mount: `rw` or `ro` |
| `tmpfs` | string[] | — | Tmpfs mounts (e.g., `["/tmp", "/run"]`) |
| `pids_limit` | integer | — | Max processes (prevents fork bombs) |
| `labels` | object | — | Container labels (key-value pairs) |

#### Fleet-Level Fields (Potentially Dangerous)

These fields are **only** available in fleet config or per-agent overrides:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `image` | string | `herdctl/runtime:latest` | Docker image to use |
| `network` | string | `bridge` | Network mode: `none`, `bridge`, `host` |
| `user` | string | Host UID:GID | Container user (e.g., `"1000:1000"`) |
| `volumes` | string[] | `[]` | Additional volume mounts |
| `ports` | string[] | — | Port bindings (e.g., `["8080:80"]`) |
| `env` | object | — | Environment variables |
| `host_config` | object | — | Raw dockerode HostConfig passthrough |

## Network Modes

Choose the appropriate network isolation level for your security requirements.

| Mode | Description | Use Case | Security Level |
|------|-------------|----------|----------------|
| `bridge` | Full network access via NAT | Agents needing internet/APIs | **Medium** |
| `host` | Share host network | Performance-critical, trusted agents | **Low** |
| `none` | No network access | Maximum isolation, offline tasks | **High** |

### Network Mode Examples

**Bridge (Default) — Standard isolation:**
```yaml
docker:
  enabled: true
  network: bridge  # Full network via NAT
```

Use for:
- Agents calling external APIs
- GitHub operations (clone, push, PR creation)
- Web scraping or data fetching
- Most standard agent workloads

**None — Maximum isolation:**
```yaml
docker:
  enabled: true
  network: none  # No network access
  workspace_mode: ro  # Read-only workspace
```

Use for:
- Untrusted prompts or experimental agents
- Static analysis tasks
- Local-only operations
- Security-critical environments

**Host — Performance-critical:**
```yaml
docker:
  enabled: true
  network: host  # Share host network
```

Use for:
- Trusted agents only
- Performance-critical networking
- Local service access (localhost APIs)
- Development environments

:::caution[Host Network Security]
`network: host` bypasses container network isolation. Only use for trusted agents in controlled environments.
:::

## Volume Mounts

Herdctl automatically mounts required paths and supports additional custom volumes.

### Automatic Mounts

The following are mounted automatically when Docker is enabled:

1. **Workspace** — Agent's working directory
   - Host: Agent workspace path
   - Container: `/workspace`
   - Mode: `rw` (or `ro` if `workspace_mode: ro`)

2. **Auth files** — Claude authentication
   - Host: `~/.claude/`
   - Container: `~/.claude/`
   - Mode: `ro` (always read-only)

### Additional Volumes

Add custom volume mounts via the `volumes` array:

```yaml
docker:
  enabled: true
  volumes:
    - "/host/models:/models:ro"           # Read-only model files
    - "/host/data:/data:rw"                # Read-write data directory
    - "/host/cache:/cache:rw"              # Shared cache
```

**Volume format:** `"host:container:mode"`
- **host** — Absolute path on host system
- **container** — Path inside container
- **mode** — `ro` (read-only) or `rw` (read-write)

### Volume Examples

**Shared model files:**
```yaml
volumes:
  - "/data/models:/models:ro"
```

**Shared cache directory:**
```yaml
volumes:
  - "${HOME}/.cache/agent:/cache:rw"
```

**Multiple volumes:**
```yaml
volumes:
  - "/data/models:/models:ro"
  - "/data/outputs:/outputs:rw"
  - "/data/config:/config:ro"
```

## Resource Limits

Control container resource usage to prevent runaway processes.

### Memory Limits

Memory format: `"<number><unit>"` where unit is `k`, `m`, `g`, `t`, or `b`.

```yaml
docker:
  memory: "2g"    # 2 gigabytes (default)
  memory: "512m"  # 512 megabytes
  memory: "4g"    # 4 gigabytes
  memory: "2048"  # 2048 bytes (no unit = bytes)
```

**Default:** `2g` (2 gigabytes)

**Recommended values:**
- Light agents: `512m` - `1g`
- Standard agents: `2g` - `4g`
- Heavy workloads: `4g` - `8g`

### CPU Shares (Soft Limit)

CPU shares control relative CPU weight when contention occurs.

```yaml
docker:
  cpu_shares: 1024  # Normal priority
  cpu_shares: 512   # Half priority
  cpu_shares: 2048  # Double priority
```

**Default:** No limit (full CPU access)

**How it works:**
- Value is relative, not absolute
- `1024` is "normal" weight
- Higher values = more CPU when contended
- No effect when CPU is idle

**When to use:**
- Multiple containers competing for CPU
- Prioritize critical agents
- Limit background agents

### CPU Period/Quota (Hard Limit)

For precise CPU limiting, use `cpu_period` and `cpu_quota` together:

```yaml
docker:
  cpu_period: 100000   # 100ms period (default)
  cpu_quota: 50000     # 50ms quota = 50% CPU
```

**How it works:**
- `cpu_period` is the scheduling period in microseconds (typically 100000 = 100ms)
- `cpu_quota` is the max CPU time allowed per period
- Ratio `cpu_quota / cpu_period` = CPU limit (0.5 = 50% of one core)

**Examples:**
| Period | Quota | CPU Limit |
|--------|-------|-----------|
| 100000 | 100000 | 100% (1 core) |
| 100000 | 50000 | 50% (0.5 cores) |
| 100000 | 200000 | 200% (2 cores) |
| 100000 | 25000 | 25% (0.25 cores) |

**When to use:**
- Need guaranteed CPU limits (not just priority)
- Multi-tenant environments
- Cost control (limit API-heavy agents)

### Tmpfs Mounts

Mount temporary filesystems in memory for fast temp storage:

```yaml
docker:
  tmpfs:
    - "/tmp"
    - "/run"
```

**Benefits:**
- Faster than disk I/O
- Automatically cleared on container stop
- No disk space usage
- Good for build caches, temp files

### Process Limits

Prevent fork bombs and runaway processes:

```yaml
docker:
  pids_limit: 100  # Max 100 processes
```

**Recommended values:**
- Standard agents: `100-200`
- Build agents (many npm processes): `500-1000`
- Minimal agents: `50`

### Container Labels

Add labels for organization and filtering:

```yaml
docker:
  labels:
    team: backend
    environment: production
    cost-center: engineering
```

Use labels with Docker commands:
```bash
docker ps --filter "label=team=backend"
docker stats --filter "label=environment=production"
```

## Path Translation

Herdctl automatically translates paths between host and container contexts.

### How It Works

When Docker is enabled:
1. Agent receives workspace path (e.g., `/home/user/projects/my-app`)
2. Runtime translates to container path (`/workspace`)
3. All file operations use container path
4. Results translated back to host path

### Session Storage Separation

Docker sessions are stored separately from host sessions to prevent path conflicts:

- **Host sessions:** `.herdctl/sessions/`
- **Docker sessions:** `.herdctl/docker-sessions/`

This prevents issues when the same agent runs in both Docker and host modes.

## Container Lifecycle

Control whether containers are reused or recreated per job.

### Ephemeral Containers (Default)

```yaml
docker:
  enabled: true
  # ephemeral: true is the default (can be omitted)
```

**Behavior:**
- New container created for each job
- Container removed after job completes (AutoRemove)
- Clean state every run
- No container accumulation
- ~300-400ms overhead with cached images

**Use for:**
- Production environments (recommended)
- Maximum isolation
- Avoiding state leakage between jobs
- Most use cases

### Persistent Containers

```yaml
docker:
  enabled: true
  ephemeral: false  # Opt-in to container reuse
  max_containers: 5  # Keep last 5 containers
```

**Behavior:**
- Container created on first job
- Reused for subsequent jobs (same agent)
- Faster execution (~100-150ms overhead)
- Containers kept for inspection
- Old containers cleaned when limit reached

**Use for:**
- Development and debugging
- Very frequent jobs (every few seconds)
- When startup time is critical
- Preserving installed tools between runs

### Container Pool Management

The `max_containers` setting limits how many containers are kept per agent:

```yaml
docker:
  max_containers: 5  # Keep last 5 containers (default)
```

When the limit is reached, the oldest container is removed before creating a new one.

## User Mapping

Containers run as a specific user to align file permissions with the host.

### Default User (Recommended)

By default, containers run as the host user:

```yaml
docker:
  enabled: true
  # user defaults to host UID:GID automatically
```

**How it works:**
- Detects host user's UID and GID
- Runs container as `{UID}:{GID}`
- Files created have correct host ownership
- No permission issues accessing workspace

### Custom User

Override the user for specific requirements:

```yaml
docker:
  user: "1000:1000"  # Specific UID:GID
```

**Format:** `"UID:GID"` where both are numeric IDs.

**When to use:**
- Shared environments with specific users
- Rootless Docker configurations
- Custom security requirements

:::caution[User Mismatch]
If container user doesn't match host user, you may encounter permission issues accessing workspace files.
:::

## Complete Examples

### High Security Configuration

Maximum isolation for untrusted prompts. Agent-level options only:

```yaml
# herdctl-agent.yaml (agent config)
docker:
  enabled: true
  workspace_mode: ro         # Read-only workspace
  memory: "1g"               # Limited memory
  cpu_shares: 512            # Lower priority
  pids_limit: 50             # Limit processes
  # ephemeral: true is default (fresh container each run)
```

Fleet config sets the secure defaults:

```yaml
# herdctl.yaml (fleet config)
defaults:
  docker:
    network: none            # No network access (maximum isolation)
    user: "1000:1000"        # Non-root user
```

### Balanced Configuration

Standard security with API access:

```yaml
# herdctl-agent.yaml (agent config)
docker:
  enabled: true
  workspace_mode: rw         # Read-write workspace
  memory: "2g"               # Standard memory
  ephemeral: false           # Container reuse for speed
  max_containers: 5          # Keep last 5 containers
  tmpfs:
    - "/tmp"                 # Fast temp storage
```

Fleet config provides network and credentials:

```yaml
# herdctl.yaml (fleet config)
defaults:
  docker:
    network: bridge          # Full network via NAT
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
```

### Development Configuration

Fast iteration with debugging. Use fleet-level overrides for dangerous options:

```yaml
# herdctl.yaml (fleet config)
agents:
  - path: ./agents/dev-agent.yaml
    overrides:
      docker:
        network: host              # Full network access
        volumes:
          - "${HOME}/.cache:/cache:rw"  # Shared cache
```

```yaml
# ./agents/dev-agent.yaml (agent config)
name: dev-agent
docker:
  enabled: true
  workspace_mode: rw         # Read-write access
  memory: "4g"               # Generous memory
  ephemeral: false           # Container reuse for faster iteration
  max_containers: 10         # Keep more containers for debugging
```

### Infrastructure Agent (Homelab)

Agents managing local infrastructure need host network access:

```yaml
# herdctl.yaml (fleet config)
agents:
  - path: ./agents/homelab.yaml
    overrides:
      docker:
        network: host        # Required for SSH to local machines
        env:
          SSH_AUTH_SOCK: "${SSH_AUTH_SOCK}"
```

```yaml
# ./agents/homelab.yaml (agent config)
name: homelab
docker:
  enabled: true
  memory: "2g"
```

:::caution[Host Network Security]
`network: host` bypasses container network isolation. Only use for trusted agents managing local infrastructure.
:::

## Combining with Runtime Selection

Docker works with both SDK and CLI runtimes. You can switch between runtimes within Docker and sessions will resume seamlessly.

### SDK Runtime + Docker (Default)

```yaml
name: sdk-dockerized
runtime: sdk  # SDK runtime (default, can be omitted)
docker:
  enabled: true
  network: bridge
  memory: "2g"
```

**Characteristics:**
- Standard API pricing
- Requires only `ANTHROPIC_API_KEY`
- Full SDK features available
- Sessions stored in `.herdctl/docker-sessions/`

### CLI Runtime + Docker

```yaml
name: cli-dockerized
runtime: cli  # CLI runtime
docker:
  enabled: true
  network: bridge
  memory: "2g"
```

**Characteristics:**
- Max plan pricing (if subscribed)
- Requires Claude CLI authentication
- Full Claude Code capabilities
- Sessions stored in `.herdctl/docker-sessions/` (same as SDK)

### Runtime Switching Within Docker

Sessions are compatible when switching runtimes within Docker:

```yaml
# Job 1: SDK runtime in Docker
runtime: sdk
docker:
  enabled: true

# Job 2: Switch to CLI runtime
runtime: cli
docker:
  enabled: true
# ✅ Session resumes from Job 1
```

Both runtimes share the same Docker session storage, enabling seamless runtime switching without losing conversation context.

:::tip[Cross-Runtime Sessions]
Within Docker, SDK and CLI runtimes share session storage. You can switch between them without losing context. However, Docker sessions are separate from local (non-Docker) sessions.
:::

See [Runtime Configuration](/configuration/runtime/) for detailed runtime comparison and [Execution Modes](/configuration/runtime/#execution-modes) for session compatibility across all modes.

## Troubleshooting

### Docker Not Available

**Error:** `Docker daemon not running`
- **Solution:** Start Docker Desktop or Docker daemon

**Error:** `Cannot connect to Docker socket`
- **Solution:** Verify Docker is installed and user has permissions

### Permission Issues

**Problem:** Cannot access workspace files
- **Cause:** User mismatch between container and host
- **Solution:** Check `user` setting matches host UID:GID

**Problem:** Files created by container have wrong owner
- **Cause:** Container running as different user
- **Solution:** Set `user: "{UID}:{GID}"` matching host user

### Network Issues

**Problem:** Cannot reach external APIs
- **Cause:** `network: none` blocks all network
- **Solution:** Change to `network: bridge` for API access

**Problem:** Cannot access localhost services
- **Cause:** Bridge network isolates from host
- **Solution:** Use `network: host` (trusted agents only)

### Resource Issues

**Error:** Container killed (OOM)
- **Cause:** Memory limit too low
- **Solution:** Increase `memory` setting

**Problem:** Container consuming too much memory
- **Cause:** No memory limit set
- **Solution:** Add `memory` limit

## Security Best Practices

1. **Use the tiered model** — Keep dangerous options (`network`, `volumes`, `env`) in fleet config only
2. **Start with maximum isolation** — Use `network: none` + `workspace_mode: ro` initially
3. **Relax as needed** — Only grant network/write access when required
4. **Prefer ephemeral containers** — Default `ephemeral: true` provides best isolation
5. **Set resource limits** — Always configure `memory` and consider `pids_limit`
6. **Avoid host network** — Only use `network: host` for trusted infrastructure agents
7. **Use per-agent overrides** — Grant dangerous capabilities to specific agents, not all
8. **Audit host_config usage** — Review any `host_config` settings carefully
9. **Read-only auth** — Auth files are always read-only (automatic)

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Complete agent config reference
- [Runtime Configuration](/configuration/runtime/) — SDK vs CLI runtime selection
- [Fleet Configuration](/configuration/fleet-config/) — Global fleet settings
