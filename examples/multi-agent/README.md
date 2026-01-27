# Multi-Agent Fleet Example

This example demonstrates running multiple agents in a single fleet by composing existing agent configurations from other examples.

## What's Included

This fleet combines:
- **hurricane-watcher** - Monitors Atlantic hurricane activity every 6 hours
- **price-checker** - Monitors office chair prices every 4 hours

## Key Concept: Composable Agent Configs

The `herdctl.yaml` references agent configs from sibling directories:

```yaml
agents:
  - path: ../hurricane-watcher/agents/hurricane-watcher.yaml
  - path: ../price-checker/agents/price-checker.yaml
```

This pattern lets you:
- Reuse existing agent definitions
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
