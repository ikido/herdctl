# Context for PRD Creation: herdctl-cli

I'm building **herdctl** - an autonomous agent fleet management system for Claude Code.

## Required Reading

1. **SPEC.md** - CLI commands section, fleet management concepts
2. **plan.md** - PRD sequence
3. **packages/cli/** - Existing CLI scaffold (commander.js, bin/herdctl.js)
4. **packages/core/src/scheduler/** - Scheduler to start/stop
5. **packages/core/src/state/** - Fleet state, job metadata for status/logs
6. **packages/core/src/config/** - Config loading for agent discovery
7. **docs/src/content/docs/cli-reference/** - Placeholder CLI docs to complete

PRDs 1-6 are complete (config, state, docs, runner, work-sources, scheduler).

## PRD 7 Scope: CLI (MVP Capstone)

Build out `packages/cli/` - the command-line interface for fleet management.

After this PRD, herdctl is a fully functional tool that can load config, start/stop scheduler, show status, view logs, and manually trigger agents.

### User Stories

1. **`herdctl start [agent]`** - Start all agents or specific agent
2. **`herdctl stop [agent]`** - Stop gracefully (wait for running jobs)
3. **`herdctl status [agent]`** - Fleet table or agent details
4. **`herdctl logs [agent]`** - View logs, with `-f` follow mode
5. **`herdctl trigger <agent>`** - Manually trigger agent schedule
6. **`herdctl init`** - Create herdctl.yaml template
7. **Complete CLI Reference docs**
8. **Complete Getting Started guide**

## CLI Structure

```
packages/cli/src/
├── index.ts             # Main CLI setup with commander
├── commands/
│   ├── start.ts
│   ├── stop.ts
│   ├── status.ts
│   ├── logs.ts
│   ├── trigger.ts
│   └── init.ts
├── output/
│   ├── table.ts         # Status table formatting
│   └── colors.ts        # Terminal colors
└── utils/
    └── config.ts        # Load herdctl.yaml
```

## Command Examples

```bash
# Start/Stop
herdctl start              # Start all agents
herdctl start my-agent     # Start specific agent
herdctl stop               # Stop all gracefully
herdctl stop --force       # Force stop

# Status
herdctl status             # Fleet overview table
herdctl status my-agent    # Agent details
herdctl status --json      # JSON output

# Logs
herdctl logs               # Recent logs from all
herdctl logs my-agent      # Specific agent
herdctl logs -f            # Follow mode
herdctl logs --job <id>    # Specific job

# Manual trigger
herdctl trigger my-agent issue-check

# Init
herdctl init               # Create herdctl.yaml
```

## Status Table Output

```
Agent           Status    Last Run         Next Run        Jobs
───────────────────────────────────────────────────────────────
bragdoc-coder   running   2 min ago        in 3 min        142
bragdoc-writer  idle      1 hour ago       in 4 hours      28
support-bot     stopped   -                -               0
```

## Integration Points

- **@herdctl/core**: Import scheduler, config, state
- **commander**: CLI framework (already in package.json)
- Add: `chalk` (colors), `cli-table3` (tables), `ora` (spinners)

## Documentation Updates

1. **CLI Reference** - Complete placeholder with all commands and examples
2. **Getting Started** - Full walkthrough: install, create config, define agent, run fleet, view logs

## Quality Gates

- `pnpm typecheck` and `pnpm test` pass
- Manual test of each command
- CLI Reference and Getting Started docs complete

## Notes

- Config discovery: walk up directory tree for herdctl.yaml
- Exit codes: 0=success, 1=error, 130=interrupted
- Daemon mode is future scope - MVP runs in foreground
- Use terminal colors for status (green=running, yellow=idle, red=error)

Create a detailed PRD following the format in `tasks/config-parsing-prd.md`.
