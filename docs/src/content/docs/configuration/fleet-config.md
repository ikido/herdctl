---
title: Fleet Configuration
description: Complete reference for herdctl.yaml fleet configuration schema
---

The fleet configuration file (`herdctl.yaml`) is the root configuration for your entire agent fleet. This document covers every available configuration option.

## Basic Structure

A minimal configuration requires only the `version` field:

```yaml
version: 1
```

A typical configuration includes workspace settings and agent references:

```yaml
version: 1

workspace:
  root: ~/herdctl-workspace
  auto_clone: true

agents:
  - path: ./agents/coder.yaml
  - path: ./agents/reviewer.yaml
```

## Configuration Reference

### version

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `1` |
| **Required** | No |

The configuration schema version. Currently only version `1` is supported.

```yaml
version: 1
```

---

### fleet

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Fleet metadata for identification and documentation purposes.

#### fleet.name

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Human-readable name for the fleet.

#### fleet.description

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Description of the fleet's purpose.

```yaml
fleet:
  name: production-fleet
  description: Production agent fleet for automated code review and deployment
```

---

### defaults

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default settings applied to all agents in the fleet. Individual agent configurations can override these defaults.

#### defaults.model

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Default Claude model for all agents.

```yaml
defaults:
  model: claude-sonnet-4-20250514
```

#### defaults.max_turns

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `undefined` |
| **Required** | No |

Default maximum conversation turns per session.

```yaml
defaults:
  max_turns: 50
```

#### defaults.permission_mode

| Property | Value |
|----------|-------|
| **Type** | `enum` |
| **Default** | `undefined` |
| **Required** | No |
| **Valid Values** | `"default"`, `"acceptEdits"`, `"bypassPermissions"`, `"plan"` |

Default permission mode for all agents.

- `default` - Standard permission prompts
- `acceptEdits` - Automatically accept file edits
- `bypassPermissions` - Skip all permission checks
- `plan` - Planning mode only

```yaml
defaults:
  permission_mode: acceptEdits
```

#### defaults.docker

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default Docker settings. See [docker](#docker) for field details.

```yaml
defaults:
  docker:
    enabled: true
    base_image: node:20-alpine
```

#### defaults.permissions

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default permission settings for all agents.

##### defaults.permissions.mode

| Property | Value |
|----------|-------|
| **Type** | `enum` |
| **Default** | `"acceptEdits"` |
| **Required** | No |
| **Valid Values** | `"default"`, `"acceptEdits"`, `"bypassPermissions"`, `"plan"` |

##### defaults.permissions.allowed_tools

| Property | Value |
|----------|-------|
| **Type** | `string[]` |
| **Default** | `undefined` |
| **Required** | No |

List of tools the agent is allowed to use.

##### defaults.permissions.denied_tools

| Property | Value |
|----------|-------|
| **Type** | `string[]` |
| **Default** | `undefined` |
| **Required** | No |

List of tools the agent is not allowed to use.

##### defaults.permissions.bash

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Bash-specific permission controls.

- `allowed_commands` (`string[]`) - Commands the agent may execute
- `denied_patterns` (`string[]`) - Patterns to block from execution

```yaml
defaults:
  permissions:
    mode: acceptEdits
    allowed_tools:
      - Read
      - Write
      - Edit
      - Bash
    denied_tools:
      - WebFetch
    bash:
      allowed_commands:
        - npm
        - git
        - pnpm
      denied_patterns:
        - "rm -rf"
        - "sudo"
```

#### defaults.work_source

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default work source configuration for agents.

##### defaults.work_source.type

| Property | Value |
|----------|-------|
| **Type** | `enum` |
| **Default** | N/A |
| **Required** | **Yes** (if work_source is specified) |
| **Valid Values** | `"github"` |

##### defaults.work_source.labels

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

GitHub label configuration for work items.

- `ready` (`string`) - Label indicating an issue is ready for processing
- `in_progress` (`string`) - Label applied when work begins

##### defaults.work_source.cleanup_in_progress

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `undefined` |
| **Required** | No |

Whether to clean up in-progress items on startup.

```yaml
defaults:
  work_source:
    type: github
    labels:
      ready: ready-for-dev
      in_progress: in-progress
    cleanup_in_progress: true
```

#### defaults.instances

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default instance concurrency settings.

##### defaults.instances.max_concurrent

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `1` |
| **Required** | No |

Maximum number of concurrent agent instances.

```yaml
defaults:
  instances:
    max_concurrent: 3
```

#### defaults.session

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default session configuration.

- `max_turns` (`number`, positive integer) - Maximum conversation turns
- `timeout` (`string`) - Session timeout duration (e.g., `"30m"`, `"1h"`)
- `model` (`string`) - Claude model for the session

```yaml
defaults:
  session:
    max_turns: 100
    timeout: 1h
    model: claude-sonnet-4-20250514
```

---

### workspace

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Global workspace configuration for repository management.

#### workspace.root

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | N/A |
| **Required** | **Yes** (if workspace is specified) |

Root directory for all agent workspaces. Supports `~` for home directory expansion.

#### workspace.auto_clone

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `true` |
| **Required** | No |

Automatically clone repositories when needed.

#### workspace.clone_depth

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `1` |
| **Required** | No |

Git shallow clone depth. Use `1` for shallow clones (faster), or a higher number for more history.

#### workspace.default_branch

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `"main"` |
| **Required** | No |

Default branch to checkout when cloning repositories.

```yaml
workspace:
  root: ~/herdctl-workspace
  auto_clone: true
  clone_depth: 1
  default_branch: main
```

---

### agents

| Property | Value |
|----------|-------|
| **Type** | `array` of agent references |
| **Default** | `[]` |
| **Required** | No |

List of agent configuration file references.

Each agent reference is an object with a `path` field:

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | N/A |
| **Required** | **Yes** |

Path to the agent configuration file. Can be relative (to the fleet config file) or absolute.

```yaml
agents:
  - path: ./agents/coder.yaml
  - path: ./agents/reviewer.yaml
  - path: /etc/herdctl/agents/shared-agent.yaml
```

---

### chat

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Chat integration configuration.

#### chat.discord

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Discord bot integration settings.

##### chat.discord.enabled

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `false` |
| **Required** | No |

Enable Discord integration for the fleet.

##### chat.discord.token_env

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Name of the environment variable containing the Discord bot token.

```yaml
chat:
  discord:
    enabled: true
    token_env: DISCORD_BOT_TOKEN
```

---

### webhooks

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Webhook server configuration for receiving external triggers.

#### webhooks.enabled

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `false` |
| **Required** | No |

Enable the webhook server.

#### webhooks.port

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `8081` |
| **Required** | No |

Port for the webhook server to listen on.

#### webhooks.secret_env

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Name of the environment variable containing the webhook secret for request validation.

```yaml
webhooks:
  enabled: true
  port: 8081
  secret_env: WEBHOOK_SECRET
```

---

### docker

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Global Docker runtime configuration.

#### docker.enabled

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `false` |
| **Required** | No |

Enable Docker container runtime for agent execution.

#### docker.base_image

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Base Docker image for agent containers.

```yaml
docker:
  enabled: true
  base_image: node:20-alpine
```

---

## Complete Example

Here's a comprehensive example demonstrating all configuration options:

```yaml
version: 1

fleet:
  name: production-fleet
  description: Production agent fleet for automated development workflows

defaults:
  model: claude-sonnet-4-20250514
  max_turns: 50
  permission_mode: acceptEdits
  docker:
    enabled: false
  permissions:
    mode: acceptEdits
    allowed_tools:
      - Read
      - Write
      - Edit
      - Bash
      - Glob
      - Grep
    bash:
      allowed_commands:
        - npm
        - pnpm
        - git
        - node
      denied_patterns:
        - "rm -rf /"
        - "sudo"
  work_source:
    type: github
    labels:
      ready: ready-for-dev
      in_progress: in-progress
    cleanup_in_progress: true
  instances:
    max_concurrent: 2
  session:
    max_turns: 100
    timeout: 1h

workspace:
  root: ~/herdctl-workspace
  auto_clone: true
  clone_depth: 1
  default_branch: main

agents:
  - path: ./agents/coder.yaml
  - path: ./agents/reviewer.yaml
  - path: ./agents/docs-writer.yaml

chat:
  discord:
    enabled: true
    token_env: DISCORD_BOT_TOKEN

webhooks:
  enabled: true
  port: 8081
  secret_env: GITHUB_WEBHOOK_SECRET

docker:
  enabled: true
  base_image: node:20-alpine
```

## Validation

Validate your configuration with:

```bash
herdctl config validate
```

## Related

- [Agent Configuration](/configuration/agent-config/) - Individual agent settings
- [Permissions](/configuration/permissions/) - Permission system details
- [Workspaces](/concepts/workspaces/) - Workspace isolation concepts
- [Environment Variables](/configuration/environment/) - Using environment variables
