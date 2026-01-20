---
title: Permissions
description: Control what tools and commands agents can use
---

Permissions control what an agent can do within its session. Herdctl provides fine-grained control over tool access, bash command execution, and permission approval modes. This allows you to create agents with appropriate access levels—from read-only support bots to full-access development agents.

## Quick Start

```yaml
# agents/my-agent.yaml
permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash
  denied_tools:
    - WebSearch
  bash:
    allowed_commands:
      - "git *"
      - "npm *"
    denied_patterns:
      - "rm -rf *"
      - "sudo *"
```

---

## Permission Modes

The `mode` field controls how Claude Code handles permission requests. This maps directly to the Claude Agent SDK's permission modes.

```yaml
permissions:
  mode: acceptEdits  # default
```

### Available Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `default` | Requires approval for everything | Maximum control, manual oversight |
| `acceptEdits` | Auto-approve file operations | **Recommended for most agents** |
| `bypassPermissions` | Auto-approve everything | Trusted, isolated environments |
| `plan` | Planning only, no execution | Research agents, dry runs |

### Mode Details

#### `default`

The most restrictive mode. Every tool use requires explicit approval through herdctl's permission callback system.

```yaml
permissions:
  mode: default
```

**When to use:**
- Testing new agents
- Running untrusted prompts
- Environments requiring audit trails

#### `acceptEdits`

Auto-approves file operations (Read, Write, Edit, mkdir, rm, mv, cp) while still requiring approval for other tools like Bash execution. This is the **default mode** if not specified.

```yaml
permissions:
  mode: acceptEdits
```

**When to use:**
- Standard development agents
- Content creation agents
- Most production use cases

#### `bypassPermissions`

Auto-approves all tool requests without prompting. Use with caution.

```yaml
permissions:
  mode: bypassPermissions
```

**When to use:**
- Fully trusted agents in isolated environments
- Docker-isolated agents with resource limits
- Automated pipelines with pre-validated prompts

:::caution
Only use `bypassPermissions` in isolated environments. This mode allows the agent to execute any tool without restriction.
:::

#### `plan`

Enables planning mode where Claude analyzes and plans but doesn't execute tools. Useful for understanding what an agent would do.

```yaml
permissions:
  mode: plan
```

**When to use:**
- Previewing agent behavior before execution
- Research and analysis agents
- Generating plans for human review

---

## Tool Permissions

Control which Claude Code tools an agent can use with `allowed_tools` and `denied_tools` arrays.

### Allowed Tools

Explicitly list tools the agent can use:

```yaml
permissions:
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
    - Task
    - WebFetch
```

### Denied Tools

Explicitly block specific tools:

```yaml
permissions:
  denied_tools:
    - WebSearch
    - WebFetch
```

### Available Claude Code Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `Read` | Read files from filesystem | Low |
| `Write` | Create new files | Medium |
| `Edit` | Modify existing files | Medium |
| `Glob` | Find files by pattern | Low |
| `Grep` | Search file contents | Low |
| `Bash` | Execute shell commands | High |
| `Task` | Launch subagents | Medium |
| `WebFetch` | Fetch web content | Medium |
| `WebSearch` | Search the web | Medium |
| `TodoWrite` | Manage task lists | Low |
| `AskUserQuestion` | Request user input | Low |
| `NotebookEdit` | Edit Jupyter notebooks | Medium |

### MCP Tool Permissions

MCP (Model Context Protocol) server tools use the `mcp__<server>__<tool>` naming convention:

```yaml
permissions:
  allowed_tools:
    - Read
    - Edit
    - mcp__github__*         # All GitHub MCP tools
    - mcp__posthog__*        # All PostHog MCP tools
    - mcp__filesystem__read_file  # Specific tool only
```

**Wildcard support:**
- `mcp__github__*` — Allow all tools from the GitHub MCP server
- `mcp__*` — Allow all MCP tools (not recommended)

---

## Bash Restrictions

Fine-tune which shell commands agents can execute with the `bash` configuration.

```yaml
permissions:
  bash:
    allowed_commands:
      - "git *"
      - "npm *"
      - "pnpm *"
      - "node *"
      - "npx *"
    denied_patterns:
      - "rm -rf /"
      - "rm -rf /*"
      - "sudo *"
      - "curl * | sh"
      - "wget * | sh"
```

### Allowed Commands

Glob patterns for commands the agent can run:

```yaml
bash:
  allowed_commands:
    - "git *"           # All git commands
    - "npm run *"       # npm run scripts
    - "pnpm *"          # All pnpm commands
    - "node scripts/*"  # Node scripts in scripts/
    - "make build"      # Specific make target
```

### Denied Patterns

Patterns that are always blocked, even if they match an allowed command:

```yaml
bash:
  denied_patterns:
    - "rm -rf /"
    - "rm -rf /*"
    - "sudo *"
    - "chmod 777 *"
    - "curl * | bash"
    - "curl * | sh"
    - "wget * | bash"
    - "wget * | sh"
    - "dd if=*"
    - "mkfs *"
    - "> /dev/*"
    - ":(){ :|:& };:"
```

---

## Common Permission Patterns

### Development Agent (Standard)

Full development capabilities with sensible restrictions:

```yaml
permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
    - Task
    - TodoWrite
  bash:
    allowed_commands:
      - "git *"
      - "npm *"
      - "pnpm *"
      - "node *"
      - "npx *"
      - "tsc *"
      - "eslint *"
      - "prettier *"
      - "vitest *"
      - "jest *"
    denied_patterns:
      - "rm -rf /"
      - "rm -rf /*"
      - "sudo *"
      - "chmod 777 *"
```

### Read-Only Support Agent

Can read and search but cannot modify:

```yaml
permissions:
  mode: default
  allowed_tools:
    - Read
    - Glob
    - Grep
    - WebFetch
  denied_tools:
    - Write
    - Edit
    - Bash
```

### Content Writer

Can read/write files, no shell access:

```yaml
permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Glob
    - Grep
    - WebFetch
    - WebSearch
  denied_tools:
    - Bash
    - Task
```

### Isolated Full-Access Agent

Maximum permissions in a Docker container:

```yaml
permissions:
  mode: bypassPermissions
  allowed_tools: []  # Empty = all tools allowed

docker:
  enabled: true
  base_image: node:20-slim
```

### Research/Planning Agent

Plan and research without execution:

```yaml
permissions:
  mode: plan
  allowed_tools:
    - Read
    - Glob
    - Grep
    - WebFetch
    - WebSearch
```

### Git-Only Agent

Can only perform git operations:

```yaml
permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Glob
    - Grep
    - Bash
  bash:
    allowed_commands:
      - "git status"
      - "git diff *"
      - "git log *"
      - "git add *"
      - "git commit *"
      - "git push *"
      - "git pull *"
      - "git checkout *"
      - "git branch *"
      - "git merge *"
      - "gh pr *"
      - "gh issue *"
    denied_patterns:
      - "git push --force *"
      - "git push -f *"
      - "git reset --hard *"
```

---

## Security Recommendations

### 1. Start Restrictive

Begin with minimal permissions and expand as needed:

```yaml
# Start here
permissions:
  mode: default
  allowed_tools:
    - Read
    - Glob
    - Grep

# Add more as you verify behavior
```

### 2. Use Mode Appropriately

| Environment | Recommended Mode |
|-------------|-----------------|
| Development/Testing | `default` |
| Production (standard) | `acceptEdits` |
| Production (Docker isolated) | `bypassPermissions` |
| Research/Preview | `plan` |

### 3. Block Dangerous Patterns

Always deny dangerous bash patterns:

```yaml
bash:
  denied_patterns:
    # Destructive commands
    - "rm -rf /"
    - "rm -rf /*"
    - "rm -rf ~"
    - "rm -rf ~/*"
    - "rm -rf ."
    - "rm -rf ./*"

    # Privilege escalation
    - "sudo *"
    - "su *"
    - "doas *"

    # Remote code execution
    - "curl * | bash"
    - "curl * | sh"
    - "wget * | bash"
    - "wget * | sh"
    - "eval *"

    # System damage
    - "dd if=*"
    - "mkfs *"
    - "fdisk *"
    - "> /dev/*"
    - "chmod -R 777 *"

    # Fork bomb
    - ":(){ :|:& };:"
```

### 4. Scope MCP Permissions

Only allow necessary MCP tools:

```yaml
permissions:
  allowed_tools:
    # Specific MCP tools, not wildcards
    - mcp__github__create_issue
    - mcp__github__list_issues
    - mcp__github__create_pull_request
    # NOT: mcp__github__*
```

### 5. Use Docker for Untrusted Workloads

Combine Docker isolation with permissions:

```yaml
permissions:
  mode: bypassPermissions

docker:
  enabled: true
  base_image: node:20-slim
```

### 6. Limit Blast Radius

Restrict workspace access when possible:

```yaml
workspace:
  root: ~/herdctl-workspace/project-a
  # Agent can only access this directory
```

### 7. Audit Regularly

Review agent permissions periodically:

```bash
# Show effective permissions for an agent
herdctl config show --agent my-agent --section permissions
```

---

## Permission Inheritance

Agent permissions inherit from fleet defaults and can be overridden:

```yaml
# herdctl.yaml (fleet defaults)
defaults:
  permissions:
    mode: acceptEdits
    denied_tools:
      - WebSearch
    bash:
      denied_patterns:
        - "sudo *"
```

```yaml
# agents/trusted-agent.yaml
permissions:
  # Override mode
  mode: bypassPermissions

  # Add to allowed tools
  allowed_tools:
    - WebSearch  # Override fleet denial

  # Inherits bash.denied_patterns from fleet
```

**Inheritance rules:**
1. Agent settings override fleet defaults
2. `denied_tools` takes precedence over `allowed_tools`
3. `bash.denied_patterns` always apply (never removed by inheritance)

---

## Validation

Validate your permission configuration:

```bash
# Validate specific agent
herdctl validate agents/my-agent.yaml

# Validate entire fleet
herdctl validate

# Show merged permissions
herdctl config show --agent my-agent --section permissions
```

---

## Schema Reference

### PermissionsSchema

```typescript
permissions:
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan"
  allowed_tools?: string[]
  denied_tools?: string[]
  bash?:
    allowed_commands?: string[]
    denied_patterns?: string[]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `"acceptEdits"` | Permission approval mode |
| `allowed_tools` | string[] | — | Tools the agent can use |
| `denied_tools` | string[] | — | Tools explicitly blocked |
| `bash.allowed_commands` | string[] | — | Allowed bash command patterns |
| `bash.denied_patterns` | string[] | — | Blocked bash command patterns |

---

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Full agent config reference
- [Fleet Configuration](/configuration/fleet-config/) — Fleet-level defaults
- [MCP Servers](/configuration/mcp-servers/) — Configure MCP tools
- [Agents Concept](/concepts/agents/) — Understanding agents
