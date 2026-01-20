# CLI PRD Prompt Draft

Use this prompt with ralph-tui to generate the CLI PRD.

---

## Prompt

Create a PRD for `herdctl-cli` - a thin CLI wrapper on FleetManager that provides command-line access to all fleet management operations.

### Context

herdctl is a TypeScript-based system for managing fleets of autonomous Claude Code agents. The core library (`@herdctl/core`) provides `FleetManager` as the orchestration layer. The CLI is a **thin wrapper** that:
- Parses command-line arguments (using commander.js)
- Calls FleetManager methods
- Formats output for the terminal

**CRITICAL**: The CLI contains NO business logic. All operations delegate to FleetManager. This ensures feature parity across CLI, Web UI, and HTTP API.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI (herdctl)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  commander  │  │   Output    │  │  FleetManager       │  │
│  │  (parsing)  │→ │ (formatting)│→ │  (from @herdctl/core)│ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Existing Infrastructure

The CLI package already exists at `packages/cli/` with:
- `package.json` - configured with `herdctl` as the binary name
- `bin/herdctl.js` - entry point (placeholder)
- `src/index.ts` - main file (placeholder)
- commander.js already installed as dependency
- Depends on `@herdctl/core` via workspace

### FleetManager API Available

From `@herdctl/core`, the CLI can use:

```typescript
import { FleetManager } from "@herdctl/core";

const fleet = new FleetManager({
  configPath: "./herdctl.yaml",  // or directory with agents/
  stateDir: "./.herdctl",
});

// Lifecycle
await fleet.initialize();
await fleet.start();
await fleet.stop();
await fleet.reload();

// Queries
fleet.getStatus(): Promise<FleetStatus>;
fleet.getAgentInfo(): Promise<AgentInfo[]>;
fleet.getAgentInfoByName(name): Promise<AgentInfo>;
fleet.getSchedules(): Promise<ScheduleInfo[]>;

// Actions
await fleet.trigger(agentName, scheduleName?, options?);
await fleet.cancelJob(jobId);
await fleet.forkJob(jobId, modifications?);
fleet.enableSchedule(agentName, scheduleName);
fleet.disableSchedule(agentName, scheduleName);

// Streaming (async generators)
fleet.streamLogs(options?): AsyncGenerator<LogEntry>;
fleet.streamJobOutput(jobId): AsyncGenerator<JobOutputPayload>;
fleet.streamAgentLogs(agentName): AsyncGenerator<LogEntry>;

// Events
fleet.on('job:created', (payload) => {});
fleet.on('job:output', (payload) => {});
fleet.on('job:completed', (payload) => {});
fleet.on('job:failed', (payload) => {});
// ... and more
```

### User Stories

#### US-1: Start Fleet
**As a** user running herdctl
**I want** `herdctl start` to start the fleet
**So that** my agents begin running their schedules

**Commands**:
```bash
herdctl start              # Start all agents
herdctl start --config ./path/to/config  # Custom config path
herdctl start --state ./path/to/state    # Custom state directory
```

**Implementation**:
- Parse arguments
- Create FleetManager with config/state paths
- Call `fleet.initialize()` then `fleet.start()`
- Keep process running (fleet runs scheduler loop)
- Stream logs to stdout
- Handle SIGINT/SIGTERM for graceful shutdown

#### US-2: Stop Fleet
**As a** user with a running fleet
**I want** `herdctl stop` to gracefully stop the fleet
**So that** running jobs complete before shutdown

**Commands**:
```bash
herdctl stop               # Graceful stop (wait for jobs)
herdctl stop --force       # Immediate stop (cancel jobs)
herdctl stop --timeout 30  # Wait max 30 seconds
```

**Note**: If `herdctl start` is running in foreground, Ctrl+C should trigger graceful stop. The `herdctl stop` command is for when running as daemon (future).

#### US-3: Fleet Status
**As a** user monitoring my fleet
**I want** `herdctl status` to show fleet and agent status
**So that** I can see what's running and what's scheduled

**Commands**:
```bash
herdctl status             # Overview of all agents
herdctl status <agent>     # Detailed status of specific agent
herdctl status --json      # JSON output for scripting
```

**Output format (default)**:
```
Fleet Status: running
Uptime: 2h 15m
Agents: 3 total, 1 running, 2 idle

AGENT              STATUS    CURRENT JOB       NEXT SCHEDULE
bragdoc-coder      running   job-abc123        -
bragdoc-marketer   idle      -                 daily-analytics in 45m
turtle-content     idle      -                 issue-check in 3m
```

**Output format (agent detail)**:
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

#### US-4: View Logs
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
herdctl logs -n 100        # Last 100 lines
```

**Output format**:
```
[12:05:01] [bragdoc-coder] Starting job job-abc123 (schedule: issue-check)
[12:05:02] [bragdoc-coder] [assistant] I'll check for ready issues...
[12:05:03] [bragdoc-coder] [tool] Bash: gh issue list --label ready
[12:05:04] [bragdoc-coder] [result] Found 2 issues
[12:05:05] [turtle-content] Starting job job-def456 (schedule: issue-check)
```

#### US-5: Trigger Agent
**As a** user wanting to run an agent immediately
**I want** `herdctl trigger <agent>` to start a job
**So that** I don't have to wait for the schedule

**Commands**:
```bash
herdctl trigger <agent>                    # Trigger default schedule
herdctl trigger <agent> --schedule <name>  # Trigger specific schedule
herdctl trigger <agent> --prompt "..."     # Custom prompt
herdctl trigger <agent> --wait             # Wait for job to complete
```

**Output**:
```
Triggered bragdoc-coder (schedule: issue-check)
Job ID: job-2024-01-19-abc123

Use 'herdctl logs --job job-2024-01-19-abc123' to view output
```

With `--wait`:
```
Triggered bragdoc-coder (schedule: issue-check)
Job ID: job-2024-01-19-abc123

[12:05:01] [assistant] I'll check for ready issues...
[12:05:02] [tool] Bash: gh issue list --label ready
...
Job completed successfully (duration: 2m 15s)
```

#### US-6: Initialize Project
**As a** new user
**I want** `herdctl init` to scaffold a new project
**So that** I can get started quickly

**Commands**:
```bash
herdctl init                    # Interactive setup
herdctl init --name my-fleet    # With name
herdctl init --example simple   # From example template
```

**Creates**:
```
./herdctl.yaml                  # Fleet config
./agents/
  example-agent.yaml            # Example agent config
./.herdctl/                     # State directory (gitignored)
```

#### US-7: Validate Config
**As a** user editing configuration
**I want** `herdctl config validate` to check my config
**So that** I can catch errors before running

**Commands**:
```bash
herdctl config validate         # Validate current config
herdctl config show             # Show merged/resolved config
herdctl config show --json      # JSON output
```

#### US-8: Job Management
**As a** user managing jobs
**I want** commands to view and control jobs
**So that** I can monitor and intervene when needed

**Commands**:
```bash
herdctl jobs                    # List recent jobs
herdctl jobs --agent <name>     # Jobs for specific agent
herdctl jobs --status running   # Filter by status
herdctl job <id>                # Show job details
herdctl job <id> --logs         # Show job output
herdctl cancel <id>             # Cancel running job
```

#### US-9: Changesets & npm Publishing Setup
**As a** maintainer of herdctl
**I want** automated versioning and npm publishing via changesets
**So that** releases are automated and consistent on merge to main

**Implementation**:

1. **Initialize changesets** in the monorepo root:
```bash
pnpm add -D @changesets/cli
pnpm changeset init
```

2. **Configure `.changeset/config.json`**:
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

3. **Update `packages/cli/package.json`** for publishing:
```json
{
  "name": "herdctl",
  "files": ["dist", "bin", "README.md"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "release": "pnpm build && changeset publish"
  }
}
```

4. **Update `packages/core/package.json`** for publishing:
```json
{
  "name": "@herdctl/core",
  "private": false,  // REMOVE or set to false - currently blocks publishing!
  "files": ["dist", "README.md"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "release": "pnpm build && changeset publish"
  }
}
```

5. **Create `.github/workflows/release.yml`** (using OIDC trusted publishing):
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
      contents: write      # For creating releases
      pull-requests: write # For creating version PRs
      id-token: write      # For OIDC npm publishing
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
          node-version: "24"  # Required for OIDC (npm >= 11.5.1)
          cache: "pnpm"
          registry-url: "https://registry.npmjs.org"

      - name: Install Dependencies
        run: pnpm install

      - name: Build
        run: pnpm build

      - name: Run Tests
        run: pnpm test

      - name: Create Release Pull Request or Publish to npm
        id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm run release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # No NPM_TOKEN needed! OIDC handles authentication
```

6. **Add root-level release script** to `package.json`:
```json
{
  "scripts": {
    "release": "turbo run release",
    "changeset": "changeset",
    "version": "changeset version"
  }
}
```

7. **Update package release scripts** to use `--provenance`:
```json
{
  "scripts": {
    "release": "pnpm build && npm publish --provenance --access public"
  }
}
```

**Note on OIDC**: As of December 2025, npm uses OIDC trusted publishing instead of long-lived tokens. This requires:
- Node.js 24+ (or npm >= 11.5.1)
- `id-token: write` permission in GitHub Actions
- Configuring trusted publishers on npmjs.com after initial publish (see Prerequisites)

### CLI Structure

```
packages/cli/
├── bin/
│   └── herdctl.js              # Entry point (#!/usr/bin/env node)
├── src/
│   ├── index.ts                # Main CLI setup
│   ├── commands/
│   │   ├── start.ts            # herdctl start
│   │   ├── stop.ts             # herdctl stop
│   │   ├── status.ts           # herdctl status
│   │   ├── logs.ts             # herdctl logs
│   │   ├── trigger.ts          # herdctl trigger
│   │   ├── init.ts             # herdctl init
│   │   ├── config.ts           # herdctl config
│   │   └── jobs.ts             # herdctl jobs, job, cancel
│   ├── output/
│   │   ├── formatters.ts       # Status/log formatting
│   │   ├── colors.ts           # Terminal colors (chalk)
│   │   └── tables.ts           # Table formatting
│   └── utils/
│       ├── config.ts           # Config path resolution
│       └── process.ts          # Signal handling
├── package.json
└── tsconfig.json
```

### Dependencies to Add

**CLI package (`packages/cli/package.json`)**:
```json
{
  "dependencies": {
    "@herdctl/core": "workspace:*",
    "commander": "^12",
    "chalk": "^5",
    "cli-table3": "^0.6"
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

### Quality Gates

- `pnpm typecheck` passes
- `pnpm test` passes (add CLI tests)
- `pnpm build` produces working binary
- Manual testing of each command
- `herdctl --help` shows all commands
- `herdctl <command> --help` shows command options
- CLI contains NO business logic (verified by code review)
- All operations delegate to FleetManager
- **npm publishing**: Both `herdctl` and `@herdctl/core` are published to npm
- **Changesets workflow**: GitHub Action creates release PRs automatically
- **Versioning**: `pnpm changeset` creates changeset files correctly

### Documentation Updates

After CLI is complete, update docs:
1. **CLI Reference** (`docs/src/content/docs/cli-reference/`) - All commands with examples
2. **Getting Started** (`docs/src/content/docs/getting-started.mdx`) - Complete walkthrough using CLI
3. Update any placeholder CLI examples in existing docs

### Constraints

- Use commander.js for argument parsing
- Use chalk for colored output
- Keep CLI thin - no business logic
- All errors should show helpful messages
- Support `--json` flag on relevant commands for scripting
- Exit codes: 0 = success, 1 = error
- Respect NO_COLOR environment variable

### Prerequisites (Manual Steps Before PRD Execution)

The following must be set up manually before running this PRD:

#### npm Organization Setup

1. **Verify npm organization exists**:
   - Ensure `@herdctl` org exists on npm: https://www.npmjs.com/org/herdctl
   - Your npm account must have publish access to the org

#### Initial Publish (One-Time Token)

Since OIDC trusted publishing requires packages to exist first, the **initial release** needs a temporary token:

1. **Create a short-lived granular access token**:
   - Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Click "Generate New Token" → "Granular Access Token"
   - Name: `herdctl-initial-publish`
   - Expiration: 7 days (short-lived, one-time use)
   - Packages: "All packages"
   - Organizations: `@herdctl`
   - Click "Generate Token" and **copy immediately**

2. **Add temporary secret to GitHub** (will be removed after first publish):
   - Go to https://github.com/edspencer/herdctl/settings/secrets/actions
   - Add `NPM_TOKEN` with the token value
   - **Remove this secret after packages are published**

#### OIDC Trusted Publishing Setup (After Initial Publish)

Once packages exist on npm, configure OIDC for token-free publishing:

1. **For each package** (`herdctl` and `@herdctl/core`):
   - Go to package settings on npmjs.com
   - Find "Trusted Publisher" section
   - Select "GitHub Actions"
   - Fill in:
     - Organization/user: `edspencer`
     - Repository: `herdctl`
     - Workflow filename: `release.yml`
   - Click "Set up connection"

2. **Remove NPM_TOKEN from GitHub**:
   - Go to https://github.com/edspencer/herdctl/settings/secrets/actions
   - Delete the `NPM_TOKEN` secret
   - OIDC will handle all future authentication

### Out of Scope

- Daemon mode (running as background service) - future PRD
- Web UI integration - separate PRD
- Remote API access - separate PRD
- Windows-specific handling (focus on macOS/Linux first)

---

## Notes for PRD Generation

- The CLI is the **user-facing interface** - focus on great UX
- Error messages should be actionable ("Config not found at ./herdctl.yaml. Run 'herdctl init' to create one.")
- Progress indicators for long operations
- Follow conventions from popular CLIs (docker, kubectl, gh)
- Consider adding shell completions (bash, zsh, fish) as stretch goal
