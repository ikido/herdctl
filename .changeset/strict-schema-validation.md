---
"@herdctl/core": minor
---

Add strict schema validation to catch misconfigured agent YAML files

Agent and fleet configs now reject unknown/misplaced fields instead of silently ignoring them. For example, putting `allowed_tools` at the root level (instead of under `permissions`) now produces a clear error:

```
Agent configuration validation failed in 'agent.yaml':
  - (root): Unrecognized key(s) in object: 'allowed_tools'
```
