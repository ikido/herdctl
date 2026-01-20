# PRD: herdctl CLI

## Overview

**Product**: herdctl CLI (`herdctl` npm package)
**Type**: Command-line interface for fleet management
**Version**: 1.0.0

### Problem Statement

Users need a command-line interface to manage fleets of Claude Code agents. While `@herdctl/core` provides the `FleetManager` API, there's no user-facing tool to start fleets, monitor agents, view logs, or trigger jobs from the terminal.

### Solution

A thin CLI wrapper around `FleetManager` that provides intuitive commands for all fleet operations. The CLI contains **no business logic** - it parses arguments, calls FleetManager methods, and formats output for the terminal.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI (herdctl)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  commander  │  │   Output    │  │  FleetManager       │  │
│  │  (parsing)  │→ │ (formatting)│→ │  (from @herdctl/core)│  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Success Criteria

- All 9 user stories implemented and tested
- `pnpm typecheck` and `pnpm test` pass
- CLI tests achieve 85% coverage
- Both `herdctl` and `@herdctl/core` published to npm
- Changesets workflow creates release PRs automatically
- CLI contains zero business logic (all operations delegate to FleetManager)

---

## User Stories

### US-1: Start Fleet

**As a** user running herdctl
**I want** `herdctl start` to start the fleet
**So that** my agents begin running their schedules

**Commands**:
```bash
herdctl start                              # Start all agents
herdctl start --config ./path/to/config    # Custom config path
herdctl start --state ./path/to/state      # Custom state directory
```

**Acceptance Criteria**:
- [ ] Parses `--config` and `--state` arguments
- [ ] Creates FleetManager with provided paths (or defaults)
- [ ] Calls `fleet.initialize()` then `fleet.start()`
- [ ] Keeps process running (fleet runs scheduler loop)
- [ ] Streams logs to stdout using `fleet.streamLogs()`
- [ ] Writes PID to `.herdctl/herdctl.pid` for stop command
- [ ] Handles SIGINT/SIGTERM for graceful shutdown
- [ ] Shows startup message with fleet status summary
- [ ] Exits with code 0 on graceful shutdown, 1 on error

**Error Handling**:
```
[ERR_CONFIG_NOT_FOUND] Config not found at ./herdctl.yaml
→ Run 'herdctl init' to create a new configuration
```

---

### US-2: Stop Fleet

**As a** user with a running fleet
**I want** `herdctl stop` to gracefully stop the fleet
**So that** running jobs complete before shutdown

**Commands**:
```bash
herdctl stop               # Graceful stop (wait for jobs)
herdctl stop --force       # Immediate stop (cancel jobs)
herdctl stop --timeout 30  # Wait max 30 seconds
```

**Acceptance Criteria**:
- [ ] Reads PID from `.herdctl/herdctl.pid`
- [ ] Sends SIGTERM to fleet process (graceful)
- [ ] With `--force`, sends SIGKILL
- [ ] With `--timeout`, waits specified seconds before force kill
- [ ] Default timeout: 30 seconds
- [ ] Shows "Fleet stopped" message on success
- [ ] Removes PID file after successful stop
- [ ] Errors if no PID file found or process not running

**Error Handling**:
```
[ERR_FLEET_NOT_RUNNING] No running fleet found
→ Start a fleet with 'herdctl start'
```

---

### US-3: Fleet Status

**As a** user monitoring my fleet
**I want** `herdctl status` to show fleet and agent status
**So that** I can see what's running and what's scheduled

**Commands**:
```bash
herdctl status             # Overview of all agents
herdctl status <agent>     # Detailed status of specific agent
herdctl status --json      # JSON output for scripting
```

**Acceptance Criteria**:
- [ ] Calls `fleet.getStatus()` and `fleet.getAgentInfo()`
- [ ] Default output shows formatted table (see format below)
- [ ] `--json` outputs structured JSON with error codes
- [ ] Agent detail view shows schedules and recent jobs
- [ ] Relative times shown (e.g., "in 45m", "5m ago")
- [ ] Colors indicate status (green=running, yellow=idle, red=error)
- [ ] Respects NO_COLOR environment variable

**Output Format (Overview)**:
```
Fleet Status: running
Uptime: 2h 15m
Agents: 3 total, 1 running, 2 idle

AGENT              STATUS    CURRENT JOB       NEXT SCHEDULE
bragdoc-coder      running   job-abc123        -
bragdoc-marketer   idle      -                 daily-analytics in 45m
turtle-content     idle      -                 issue-check in 3m
```

**Output Format (Agent Detail)**:
```
Agent: bragdoc-coder
Status: running
Current Job: job-2024-01-19-abc123
  Started: 5 minutes ago
  Schedule: issue-check

Schedules:
  issue-check     interval  5m    last: 5m ago   next: running

Recent Jobs:
  job-abc123  running   issue-check   5m ago
  job-xyz789  completed issue-check   1h ago   (duration: 2m 15s)
  job-def456  completed issue-check   2h ago   (duration: 45s)
```

**JSON Output**:
```json
{
  "status": "running",
  "uptime": 8100,
  "agents": [
    {
      "name": "bragdoc-coder",
      "status": "running",
      "currentJob": "job-abc123",
      "nextSchedule": null
    }
  ]
}
```

---

### US-4: View Logs

**As a** user debugging agent behavior
**I want** `herdctl logs` to show agent output
**So that** I can see what agents are doing

**Commands**:
```bash
herdctl logs               # Recent logs from all agents
herdctl logs <agent>       # Logs from specific agent
herdctl logs -f            # Follow mode (stream new logs)
herdctl logs -f <agent>    # Follow specific agent
herdctl logs --job <id>    # Logs from specific job
herdctl logs -n 100        # Last 100 lines (default: 50)
herdctl logs --json        # JSON output for each log entry
```

**Acceptance Criteria**:
- [ ] Uses `fleet.streamLogs()`, `fleet.streamAgentLogs()`, `fleet.streamJobOutput()`
- [ ] Default shows last 50 log entries
- [ ] `-f` streams continuously until Ctrl+C
- [ ] `--job` filters to specific job ID
- [ ] Timestamps in local timezone
- [ ] Color-coded by log type (assistant, tool, result, error)
- [ ] `--json` outputs newline-delimited JSON

**Output Format**:
```
[12:05:01] [bragdoc-coder] Starting job job-abc123 (schedule: issue-check)
[12:05:02] [bragdoc-coder] [assistant] I'll check for ready issues...
[12:05:03] [bragdoc-coder] [tool] Bash: gh issue list --label ready
[12:05:04] [bragdoc-coder] [result] Found 2 issues
[12:05:05] [turtle-content] Starting job job-def456 (schedule: issue-check)
```

---

### US-5: Trigger Agent

**As a** user wanting to run an agent immediately
**I want** `herdctl trigger <agent>` to start a job
**So that** I don't have to wait for the schedule

**Commands**:
```bash
herdctl trigger <agent>                    # Trigger default schedule
herdctl trigger <agent> --schedule <name>  # Trigger specific schedule
herdctl trigger <agent> --prompt "..."     # Custom prompt
herdctl trigger <agent> --wait             # Wait for job to complete
herdctl trigger <agent> --json             # JSON output
```

**Acceptance Criteria**:
- [ ] Calls `fleet.trigger(agentName, scheduleName?, options?)`
- [ ] Shows job ID immediately
- [ ] `--wait` streams job output until completion
- [ ] `--prompt` overrides schedule prompt
- [ ] Exits with job's exit code when using `--wait`
- [ ] `--json` outputs structured job info

**Output (Default)**:
```
Triggered bragdoc-coder (schedule: issue-check)
Job ID: job-2024-01-19-abc123

Use 'herdctl logs --job job-2024-01-19-abc123' to view output
```

**Output (--wait)**:
```
Triggered bragdoc-coder (schedule: issue-check)
Job ID: job-2024-01-19-abc123

[12:05:01] [assistant] I'll check for ready issues...
[12:05:02] [tool] Bash: gh issue list --label ready
...
Job completed successfully (duration: 2m 15s)
```

---

### US-6: Initialize Project

**As a** new user
**I want** `herdctl init` to scaffold a new project
**So that** I can get started quickly

**Commands**:
```bash
herdctl init                    # Interactive setup
herdctl init --name my-fleet    # With fleet name
herdctl init --example simple   # From example template
herdctl init --yes              # Accept all defaults
```

**Acceptance Criteria**:
- [ ] Interactive prompts for fleet name if not provided
- [ ] Creates `herdctl.yaml` with sensible defaults
- [ ] Creates `agents/` directory with example agent
- [ ] Creates `.herdctl/` directory (adds to .gitignore if exists)
- [ ] Shows next steps after creation
- [ ] `--example` pulls from built-in templates
- [ ] Errors if config already exists (use `--force` to overwrite)

**Created Files**:
```
./herdctl.yaml                  # Fleet config
./agents/
  example-agent.yaml            # Example agent config
./.herdctl/                     # State directory
```

**Output**:
```
Created herdctl configuration:
  ./herdctl.yaml
  ./agents/example-agent.yaml
  ./.herdctl/ (state directory)

Next steps:
  1. Edit agents/example-agent.yaml to configure your first agent
  2. Run 'herdctl start' to start the fleet
  3. Run 'herdctl status' to check agent status

Documentation: https://herdctl.dev/getting-started
```

---

### US-7: Validate Config

**As a** user editing configuration
**I want** `herdctl config validate` to check my config
**So that** I can catch errors before running

**Commands**:
```bash
herdctl config validate         # Validate current config
herdctl config validate --fix   # Show suggestions for fixes
herdctl config show             # Show merged/resolved config
herdctl config show --json      # JSON output
```

**Acceptance Criteria**:
- [ ] Validates against Zod schemas from @herdctl/core
- [ ] Shows all validation errors, not just first
- [ ] `--fix` suggests corrections where possible
- [ ] `show` displays fully resolved config (env vars expanded, defaults applied)
- [ ] Exit code 0 if valid, 1 if invalid

**Output (Valid)**:
```
✓ Configuration is valid

Fleet: my-fleet
Agents: 3
Schedules: 7 total
```

**Output (Invalid)**:
```
✗ Configuration has 2 errors

agents/broken-agent.yaml:
  Line 5: schedule.interval must be a valid duration (got: "5")
  → Try: interval: "5m" or interval: "5h"

  Line 12: workdir path does not exist: ./nonexistent
  → Create the directory or update the path
```

---

### US-8: Job Management

**As a** user managing jobs
**I want** commands to view and control jobs
**So that** I can monitor and intervene when needed

**Commands**:
```bash
herdctl jobs                    # List recent jobs (last 20)
herdctl jobs --agent <name>     # Jobs for specific agent
herdctl jobs --status running   # Filter by status
herdctl jobs --limit 50         # Custom limit
herdctl jobs --json             # JSON output

herdctl job <id>                # Show job details
herdctl job <id> --logs         # Show job output
herdctl job <id> --json         # JSON output

herdctl cancel <id>             # Cancel running job
herdctl cancel <id> --force     # Force cancel (SIGKILL)
```

**Acceptance Criteria**:
- [ ] `jobs` lists recent jobs with status, agent, duration
- [ ] Filters: `--agent`, `--status` (pending, running, completed, failed, cancelled)
- [ ] `job <id>` shows detailed job info including config used
- [ ] `job <id> --logs` streams job output
- [ ] `cancel` calls `fleet.cancelJob(jobId)`
- [ ] Confirmation prompt before cancel (unless `--yes`)

**Output (jobs list)**:
```
Recent Jobs:

JOB ID                      AGENT            STATUS     SCHEDULE      STARTED       DURATION
job-2024-01-19-abc123       bragdoc-coder    running    issue-check   5m ago        -
job-2024-01-19-xyz789       bragdoc-coder    completed  issue-check   1h ago        2m 15s
job-2024-01-19-def456       turtle-content   completed  daily-post    2h ago        45s
job-2024-01-19-ghi012       bragdoc-marketer failed     analytics     3h ago        12s

Showing 4 of 127 jobs. Use --limit to see more.
```

**Output (job detail)**:
```
Job: job-2024-01-19-abc123
Agent: bragdoc-coder
Schedule: issue-check
Status: running
Started: 2024-01-19 12:05:01 (5 minutes ago)

Config:
  Prompt: Check for issues labeled 'ready' and work on them
  Model: claude-sonnet-4-20250514
  Max turns: 50

Use 'herdctl job job-2024-01-19-abc123 --logs' to view output
```

---

### US-9: Changesets & npm Publishing Setup

**As a** maintainer of herdctl
**I want** automated versioning and npm publishing via changesets
**So that** releases are automated and consistent on merge to main

**Acceptance Criteria**:
- [ ] Changesets initialized in monorepo root
- [ ] `.changeset/config.json` configured for public access
- [ ] `packages/cli/package.json` configured for npm publishing
- [ ] `packages/core/package.json` `private: false` and configured for publishing
- [ ] `.github/workflows/release.yml` created with OIDC publishing
- [ ] Root `package.json` has `changeset`, `version`, `release` scripts
- [ ] `pnpm changeset` creates changeset files correctly
- [ ] GitHub Action creates "Version Packages" PR on merge
- [ ] Packages publish with provenance attestations

**Files to Create/Modify**:

1. **Initialize changesets**:
```bash
pnpm add -D @changesets/cli
pnpm changeset init
```

2. **`.changeset/config.json`**:
```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.4/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

3. **`packages/cli/package.json`** additions:
```json
{
  "name": "herdctl",
  "files": ["dist", "bin", "README.md"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

4. **`packages/core/package.json`** changes:
```json
{
  "name": "@herdctl/core",
  "private": false,
  "files": ["dist", "README.md"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

5. **`.github/workflows/release.yml`**:
```yaml
name: Release

on:
  push:
    branches:
      - main

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "pnpm"
          registry-url: "https://registry.npmjs.org"

      - name: Install Dependencies
        run: pnpm install

      - name: Build
        run: pnpm build

      - name: Run Tests
        run: pnpm test

      - name: Create Release Pull Request or Publish
        id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm run release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

6. **Root `package.json`** additions:
```json
{
  "scripts": {
    "release": "turbo run release",
    "changeset": "changeset",
    "version": "changeset version"
  }
}
```

7. **Package release scripts** (both packages):
```json
{
  "scripts": {
    "release": "pnpm build && npm publish --provenance --access public"
  }
}
```

---

## Technical Specification

### CLI Structure

```
packages/cli/
├── bin/
│   └── herdctl.js              # Entry point (#!/usr/bin/env node)
├── src/
│   ├── index.ts                # Main CLI setup with commander
│   ├── commands/
│   │   ├── start.ts            # herdctl start
│   │   ├── stop.ts             # herdctl stop
│   │   ├── status.ts           # herdctl status
│   │   ├── logs.ts             # herdctl logs
│   │   ├── trigger.ts          # herdctl trigger
│   │   ├── init.ts             # herdctl init
│   │   ├── config.ts           # herdctl config validate/show
│   │   ├── jobs.ts             # herdctl jobs
│   │   ├── job.ts              # herdctl job <id>
│   │   └── cancel.ts           # herdctl cancel <id>
│   ├── output/
│   │   ├── formatters.ts       # Status/log/job formatting
│   │   ├── colors.ts           # Terminal colors (chalk, NO_COLOR support)
│   │   ├── tables.ts           # Table formatting (cli-table3)
│   │   └── errors.ts           # Error formatting with codes
│   └── utils/
│       ├── config.ts           # Config path resolution
│       ├── process.ts          # Signal handling, PID file management
│       └── time.ts             # Relative time formatting
├── __tests__/
│   ├── commands/
│   │   ├── start.test.ts
│   │   ├── status.test.ts
│   │   └── ...
│   ├── output/
│   │   └── formatters.test.ts
│   └── integration/
│       └── cli.test.ts         # Full CLI integration tests
├── package.json
└── tsconfig.json
```

### Dependencies

**CLI package (`packages/cli/package.json`)**:
```json
{
  "dependencies": {
    "@herdctl/core": "workspace:*",
    "commander": "^12",
    "chalk": "^5",
    "cli-table3": "^0.6"
  },
  "devDependencies": {
    "vitest": "^2"
  }
}
```

**Root workspace (`package.json`)**:
```json
{
  "devDependencies": {
    "@changesets/cli": "^2"
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `ERR_CONFIG_NOT_FOUND` | Configuration file not found |
| `ERR_CONFIG_INVALID` | Configuration validation failed |
| `ERR_FLEET_NOT_RUNNING` | No running fleet found |
| `ERR_FLEET_ALREADY_RUNNING` | Fleet is already running |
| `ERR_AGENT_NOT_FOUND` | Specified agent does not exist |
| `ERR_JOB_NOT_FOUND` | Specified job does not exist |
| `ERR_SCHEDULE_NOT_FOUND` | Specified schedule does not exist |
| `ERR_CANCEL_FAILED` | Failed to cancel job |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 130 | Interrupted (Ctrl+C) |

---

## Testing Strategy

### Unit Tests
- Mock FleetManager for all command tests
- Test argument parsing with various combinations
- Test output formatting for all data types
- Test error handling and messages
- Coverage target: 85%

### Integration Tests
- Test actual FleetManager calls with test fixtures
- Create test config files in `__tests__/fixtures/`
- Test full command execution end-to-end
- Test signal handling (SIGINT, SIGTERM)

### Test Fixtures
```
packages/cli/__tests__/fixtures/
├── valid-config/
│   ├── herdctl.yaml
│   └── agents/
│       └── test-agent.yaml
├── invalid-config/
│   └── herdctl.yaml
└── empty-config/
    └── herdctl.yaml
```

---

## Quality Gates

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes with 85% coverage
- [ ] `pnpm build` produces working binary
- [ ] `herdctl --help` shows all commands
- [ ] `herdctl <command> --help` shows command options
- [ ] All commands tested manually
- [ ] CLI contains NO business logic (code review verification)
- [ ] All operations delegate to FleetManager
- [ ] Error messages include codes and actionable suggestions
- [ ] `--json` works on all relevant commands
- [ ] NO_COLOR environment variable respected
- [ ] Both packages publish successfully to npm

---

## Prerequisites (Manual Steps)

### npm Organization Setup
1. Verify `@herdctl` org exists on npmjs.com
2. Ensure your account has publish access

### Initial Publish (One-Time Token)
1. Create short-lived granular access token (7 days)
2. Add `NPM_TOKEN` secret to GitHub repository
3. **Remove secret after first successful publish**

### OIDC Setup (After Initial Publish)
1. Configure trusted publisher for `herdctl` package
2. Configure trusted publisher for `@herdctl/core` package
3. Delete `NPM_TOKEN` secret from GitHub

---

## Out of Scope

- Daemon mode (running as background service)
- Web UI integration
- Remote API access
- Windows-specific handling
- Shell completions (bash, zsh, fish) - stretch goal for future

---

## Documentation Updates

After CLI completion:
1. **CLI Reference** - All commands with examples in `docs/src/content/docs/cli-reference/`
2. **Getting Started** - Complete walkthrough in `docs/src/content/docs/getting-started.mdx`
3. **README.md** - Update root README with CLI usage examples