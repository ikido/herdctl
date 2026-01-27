---
"@herdctl/core": minor
"herdctl": minor
---

Add `herdctl sessions` command to discover and resume Claude Code sessions

When agents run with session persistence enabled, herdctl tracks Claude Code session IDs. This new command makes those sessions discoverable and resumable:

```bash
# List all sessions
herdctl sessions

# Output:
# Sessions (2)
# ══════════════════════════════════════════════════════════════════════════════════════
# AGENT               SESSION ID                               LAST ACTIVE   JOBS
# ─────────────────────────────────────────────────────────────────────────────────────
# bragdoc-developer   a166a1e4-c89e-41f8-80c8-d73f6cd0d39c     5m ago        19
# price-checker       b234e5f6-a78b-49c0-d12e-3456789abcde     2h ago        3

# Resume the most recent session
herdctl sessions resume

# Resume a specific session (supports partial ID match)
herdctl sessions resume a166a1e4
herdctl sessions resume bragdoc-developer  # or by agent name

# Show full resume commands
herdctl sessions --verbose

# Filter by agent
herdctl sessions --agent bragdoc-developer

# JSON output for scripting
herdctl sessions --json
```

The `resume` command launches Claude Code with `--resume <session-id>` in the agent's configured workspace directory, making it easy to pick up where a Discord bot or scheduled agent left off.

Also adds `listSessions()` function to `@herdctl/core` for programmatic access.
