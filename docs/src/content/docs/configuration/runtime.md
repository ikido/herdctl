---
title: Runtime Configuration
description: Choose between SDK and CLI runtimes for agent execution
---

Herdctl supports two runtime backends for executing Claude Code agents: **SDK runtime** and **CLI runtime**. This page explains when to use each and how to configure them.

## Runtime Types Overview

### SDK Runtime (Default)

The SDK runtime uses the Claude Agent SDK directly to execute agents. This is the default runtime and works out of the box with just an API key.

**Key characteristics:**
- Standard Claude API pricing
- Requires only `ANTHROPIC_API_KEY` environment variable
- Fully programmatic execution
- All SDK features available
- Sessions stored in `.herdctl/sessions/`

### CLI Runtime

The CLI runtime spawns the `claude` CLI command to execute agents. This runtime is designed for users with Claude Max plans who want to leverage their subscription benefits.

**Key characteristics:**
- Max plan pricing (if subscribed)
- Requires Claude CLI installed and logged in
- Full Claude Code capabilities
- Sessions managed by Claude CLI in `~/.claude/`
- Separate from herdctl session storage

## Decision Matrix

Choose the appropriate runtime based on your requirements:

| Factor | SDK Runtime | CLI Runtime |
|--------|-------------|-------------|
| **Pricing** | Standard API rates | Max plan rates (if subscribed) |
| **Setup** | Just API key | Claude CLI installed + logged in |
| **Features** | Full SDK support | Full Claude Code capabilities |
| **Best for** | API-only deployments, CI/CD | Max plan users wanting cost savings |
| **Session storage** | `.herdctl/sessions/` | `~/.claude/` (managed by CLI) |
| **Authentication** | `ANTHROPIC_API_KEY` | `claude login` |
| **Dependencies** | None | Claude CLI must be installed |

**When to use SDK runtime:**
- You're using standard Claude API access
- Running in CI/CD or automated environments
- Don't have Claude CLI installed
- Want simplest setup (default)

**When to use CLI runtime:**
- You have a Claude Max subscription
- Want to use Max plan pricing benefits
- Already use Claude CLI for other work
- Need full Claude Code feature parity

## Configuration

### SDK Runtime (Default)

The SDK runtime is used automatically when no runtime is specified:

```yaml
# agent.yaml
name: my-agent
# runtime: sdk  # Optional - sdk is the default

workspace: my-project
schedules:
  check:
    type: interval
    interval: 5m
    prompt: "Check for work."
```

**Requirements:**
- `ANTHROPIC_API_KEY` environment variable must be set

**No additional setup needed** - this is the default and works immediately.

### CLI Runtime

To use the CLI runtime, set `runtime: cli` in your agent configuration:

```yaml
# agent.yaml
name: cli-agent
runtime: cli

workspace: my-project
schedules:
  check:
    type: interval
    interval: 5m
    prompt: "Check for work."
```

**Requirements:**
1. Claude CLI must be installed:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. User must be logged in:
   ```bash
   claude login
   ```

3. Claude CLI manages authentication in `~/.claude/`

## Session Management

Runtime choice affects where agent sessions are stored and managed:

### SDK Runtime Sessions

- **Location:** `.herdctl/sessions/{agentName}/`
- **Format:** JSON session state files
- **Management:** herdctl creates and manages session files
- **Resumption:** Sessions can be resumed across runs

**Example session file:**
```
.herdctl/sessions/my-agent/session-2026-01-15-10-30-45.json
```

### CLI Runtime Sessions

- **Location:** `~/.claude/sessions/`
- **Format:** CLI-native session files
- **Management:** Claude CLI creates and manages sessions
- **Resumption:** Sessions managed by Claude CLI

**Example session path:**
```
~/.claude/sessions/workspace-path-hash-123abc/
```

:::note[No Session Migration]
Sessions are not portable between runtime types. If you switch an agent from SDK to CLI runtime (or vice versa), it will start a fresh session, not resume the previous one.
:::

## Runtime Switching

You can switch an agent's runtime at any time by changing the `runtime` field. The agent will use the new runtime for all subsequent executions.

```yaml
# Before (SDK runtime - default)
name: my-agent
# No runtime field specified

# After (CLI runtime)
name: my-agent
runtime: cli
```

**Important:** Existing sessions from the previous runtime will not be resumed. The agent will start fresh with the new runtime.

## Docker Compatibility

Both runtimes work with Docker containerization:

```yaml
name: containerized-agent
runtime: cli  # CLI runtime in container
docker:
  enabled: true
  image: anthropic/claude-code:latest
  network: bridge
  memory: 2g
```

When Docker is enabled:
- SDK runtime sessions stored in `.herdctl/docker-sessions/`
- CLI runtime sessions managed by Claude CLI inside the container
- Auth files mounted read-only into container

See [Docker Configuration](/configuration/docker/) for more details.

## Troubleshooting

### SDK Runtime Issues

**Error:** `Missing ANTHROPIC_API_KEY`
- **Solution:** Set the `ANTHROPIC_API_KEY` environment variable with your API key

**Error:** `Invalid API key`
- **Solution:** Verify your API key is correct and active

### CLI Runtime Issues

**Error:** `claude command not found`
- **Solution:** Install Claude CLI: `npm install -g @anthropic-ai/claude-code`

**Error:** `Not authenticated`
- **Solution:** Log in to Claude CLI: `claude login`

**Error:** `CLI runtime requires claude CLI`
- **Solution:** Ensure Claude CLI is installed and in your PATH

### Session Issues

**Problem:** Sessions not resuming
- **Check:** Verify session files exist in the correct location
- **SDK:** Check `.herdctl/sessions/{agentName}/`
- **CLI:** Check `~/.claude/sessions/`

**Problem:** Session conflicts after runtime switch
- **Explanation:** Sessions are not compatible between runtimes
- **Solution:** This is expected - the agent starts fresh with the new runtime

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Complete agent config reference
- [Docker Configuration](/configuration/docker/) — Container security and isolation
- [Fleet Configuration](/configuration/fleet-config/) — Global fleet settings
