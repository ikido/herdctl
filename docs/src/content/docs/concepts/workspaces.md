---
title: Workspaces
description: Isolated directories where agents operate, keeping your development clones safe
---

A **Workspace** is the directory where an agent operates. It's a dedicated clone of your repository, completely separate from your working development copy.

## The Isolation Problem

Developers have their own working clones of repositories. Agents shouldn't touch these.

**Without workspace isolation**, an agent could:
- Overwrite uncommitted changes you're working on
- Create merge conflicts with your local branches
- Push commits from "your" working directory
- Interfere with your debugging sessions
- Corrupt work-in-progress files

**With workspace isolation**, agents work in their own clones:
- Your development work remains untouched
- Agents can commit, branch, and push freely
- You review agent changes via pull requests
- Multiple agents can work on different branches
- Clean separation between human and agent work

## Directory Structure

herdctl uses a dedicated workspace root directory, separate from where you do your development work:

```
~/herdctl-workspace/           # Agent workspace root (configurable)
├── bragdoc-ai/                # Clone of edspencer/bragdoc-ai
│   ├── .git/
│   ├── CLAUDE.md              # Project's Claude config
│   ├── src/
│   └── ...
├── theturtlemoves/            # Clone of edspencer/theturtlemoves
└── edspencer-net/             # Clone of edspencer/edspencer-net

~/Code/bragdoc-ai/             # Developer's working clone (untouched by agents)
```

The agent's working directory is set to its workspace clone, giving it:
- Full access to the repo's CLAUDE.md, skills, and conventions
- Ability to create branches, commit, and push
- Complete isolation from your development work

## Workspace Root Configuration

Configure where agent workspaces live in your fleet configuration:

```yaml
# herdctl.yaml
workspace:
  root: ~/herdctl-workspace    # Where agent repos live
  auto_clone: true             # Clone repos if not present
  clone_depth: 1               # Shallow clone for faster setup
  default_branch: main         # Branch to track
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `root` | `~/herdctl-workspace` | Base directory for all agent workspaces |
| `auto_clone` | `true` | Automatically clone repositories when needed |
| `clone_depth` | `1` | Git clone depth (1 = shallow clone, faster) |
| `default_branch` | `main` | Default branch to checkout |

## Per-Agent Workspace Configuration

Each agent specifies which workspace it operates in:

```yaml
# agents/bragdoc-coder.yaml
name: bragdoc-coder
description: "Implements features and fixes bugs in Bragdoc"

# Workspace configuration
workspace: bragdoc-ai           # Directory name under workspace root
repo: edspencer/bragdoc-ai      # Repository to clone
```

The agent's workspace will be at: `~/herdctl-workspace/bragdoc-ai`

## Auto-Clone Behavior

When `auto_clone: true`, herdctl automatically clones repositories when needed:

1. **First run**: Agent starts, workspace doesn't exist
2. **Clone**: herdctl runs `git clone` to create the workspace
3. **Ready**: Agent can now operate in the workspace

```bash
# Equivalent to what herdctl does automatically:
git clone --depth 1 https://github.com/edspencer/bragdoc-ai.git \
  ~/herdctl-workspace/bragdoc-ai
```

You can also initialize workspaces manually:

```bash
# Initialize workspace for a specific agent
herdctl workspace init bragdoc-coder

# This:
# 1. Creates ~/herdctl-workspace/bragdoc-ai/
# 2. Clones the repository
# 3. Sets up any required configuration
```

## Multiple Agents, Same Workspace

Multiple agents can share the same workspace. This is useful when different agents need access to the same codebase but perform different tasks:

```yaml
# agents/bragdoc-coder.yaml
name: bragdoc-coder
workspace: bragdoc-ai           # Both agents share this workspace
repo: edspencer/bragdoc-ai
schedules:
  - name: issue-check
    trigger:
      type: interval
      every: 5m
    prompt: "Check for ready issues and implement them."
```

```yaml
# agents/bragdoc-marketer.yaml
name: bragdoc-marketer
workspace: bragdoc-ai           # Same workspace as coder
repo: edspencer/bragdoc-ai
schedules:
  - name: daily-analytics
    trigger:
      type: cron
      expression: "0 9 * * *"
    prompt: "Generate daily analytics report."
```

**Why share workspaces?**

- Both agents need access to the same project files
- They share the repo's CLAUDE.md and conventions
- Each agent has its own identity, schedules, and prompts
- Reduces disk space compared to separate clones

**Considerations when sharing:**

- Agents should work on different branches to avoid conflicts
- Use branch prefixes to identify which agent made changes
- Consider scheduling to avoid simultaneous file modifications

## Workspace Management Commands

```bash
# List all workspaces
herdctl workspace list

# Initialize a workspace (clone the repo)
herdctl workspace init <agent-name>

# Clean a workspace (reset to origin)
herdctl workspace clean <workspace-name>

# Remove a workspace entirely
herdctl workspace remove <workspace-name>

# Show workspace status
herdctl workspace status <workspace-name>
```

## How Workspaces Work at Runtime

When an agent runs, herdctl:

1. Sets the working directory to the workspace path
2. Ensures the repo is up-to-date (optional pull)
3. Invokes Claude with full access to repo context
4. Agent can read CLAUDE.md, use skills, follow conventions
5. Agent can create branches, commit, and push changes

```typescript
// Runtime sets this before invoking the Claude SDK
process.chdir('/Users/ed/herdctl-workspace/bragdoc-ai');

// Agent now has access to:
// - CLAUDE.md, .claude/ directory
// - All project skills, conventions
// - Can git commit, push, etc.
```

## Best Practices

### Use Descriptive Workspace Names

```yaml
# Good - matches repo name
workspace: bragdoc-ai
repo: edspencer/bragdoc-ai

# Good - short alias for long repo names
workspace: turtle
repo: edspencer/theturtlemoves-website-with-blog
```

### Keep Agent Workspaces Separate from Development

```
# Recommended structure
~/Code/                        # Your development work
  └── bragdoc-ai/              # Your working copy

~/herdctl-workspace/           # Agent workspaces
  └── bragdoc-ai/              # Agent's copy
```

### Use Branch Strategies

Configure agents to work on feature branches:

```yaml
workspace: my-project
branch_prefix: agent/
```

This creates branches like `agent/issue-123` for each task, making it easy to:
- Identify agent-created branches
- Review changes via pull requests
- Avoid conflicts with main branch

## Related Concepts

- [Agents](/concepts/agents/) - Operate in workspaces
- [Jobs](/concepts/jobs/) - Execute within workspaces
- [Sessions](/concepts/sessions/) - Maintain context across jobs
- [Fleet Configuration](/configuration/fleet-config/) - Configure workspace defaults
