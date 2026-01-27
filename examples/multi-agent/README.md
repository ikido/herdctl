# Multi-Agent Fleet Example

This example demonstrates running multiple agents in a single fleet by composing existing agent configurations from other examples, with per-agent overrides.

## What's Included

This fleet combines:
- **hurricane-watcher** - Monitors Atlantic hurricane activity (overridden to 2h instead of 6h)
- **price-checker** - Monitors office chair prices (overridden to 1h instead of 4h, Discord hooks disabled)

## Key Concept: Composable Agent Configs with Overrides

The `herdctl.yaml` references agent configs from sibling directories and applies per-agent overrides:

```yaml
agents:
  - path: ../hurricane-watcher/agents/hurricane-watcher.yaml
    overrides:
      schedules:
        check:
          interval: 2h  # Override the default 6h

  - path: ../price-checker/agents/price-checker.yaml
    overrides:
      schedules:
        check:
          interval: 1h  # Override the default 4h
      hooks:
        after_run:
          - type: shell
            command: "echo 'Custom hook'"  # Replace all hooks
```

This pattern lets you:
- Reuse existing agent definitions
- Customize behavior per-fleet without modifying the original agent
- Override schedules, hooks, permissions, or any other config
- Build fleets by composition
- Keep agent configs in dedicated directories with their own context files

## Running

```bash
cd examples/multi-agent

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Discord bot token (optional, for notifications)

# Start the fleet
herdctl start

# Check status
herdctl status

# Manually trigger an agent
herdctl trigger hurricane-watcher
herdctl trigger price-checker
```

## Notes

- Each agent maintains its own `context.md` in its original directory
- The price-checker requires Discord environment variables for notifications
- The hurricane-watcher has Discord hooks commented out by default
