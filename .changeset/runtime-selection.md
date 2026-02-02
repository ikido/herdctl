---
"@herdctl/core": minor
---

Add runtime selection between SDK and CLI for agent execution

Agents can now choose between two execution runtimes:
- **SDK Runtime** (default): Uses Claude Agent SDK with standard Claude Code features
- **CLI Runtime**: Uses `claude-p` CLI invocation to preserve Claude Max tokens

**New Configuration**:
```yaml
# Agent-level runtime selection
runtime: sdk  # or "cli"

# Or with CLI-specific options
runtime:
  type: cli
  command: claude-p  # Custom CLI command (optional)
```

**SDK Runtime** (Default):
- Full Claude Agent SDK integration
- All standard Claude Code features
- Standard token consumption

**CLI Runtime**:
- Invokes `claude-p` directly (or custom Claude CLI fork)
- Preserves Claude Max tokens instead of consuming API credits
- Parses CLI output for streaming messages
- Full feature parity with SDK runtime
- Works with both host and Docker execution

**Use Cases**:
- Preserve Claude Max tokens for long-running agents
- Use custom Claude CLI forks with modified behavior
- Switch between SDK and CLI without code changes
- Test different runtime behaviors

The runtime architecture is pluggable, making it easy to add additional runtime types in the future.
