---
"@herdctl/core": minor
---

Add per-agent config overrides when referencing agents in fleet config

You can now override any agent configuration field when referencing an agent in your fleet's `herdctl.yaml`:

```yaml
agents:
  - path: ./agents/my-agent.yaml
    overrides:
      schedules:
        check:
          interval: 2h  # Override the default interval
      hooks:
        after_run: []   # Disable all hooks for this fleet
```

Overrides are deep-merged after fleet defaults are applied, so you only need to specify the fields you want to change. Arrays are replaced entirely (not merged).

This enables:
- Reusing agent configs across fleets with different settings
- Customizing schedules, hooks, permissions per-fleet
- Disabling features (like Discord notifications) for specific fleets
