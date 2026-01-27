---
"@herdctl/core": patch
---

Fix project-embedded agents to fully inherit workspace configuration

Three related changes for agents that point at existing Claude Code projects (the "Software Developer Agent" pattern):

1. **Working directory**: The `workspace` configuration is now correctly passed to the Claude SDK as the `cwd` option, so agents run in their configured workspace directory instead of wherever herdctl was launched.

2. **Settings discovery**: When `workspace` is configured, `settingSources` is now set to `["project"]` by default, enabling the agent to discover and use CLAUDE.md, skills, commands, and other Claude Code configuration from the workspace.

3. **Explicit configuration**: Added `setting_sources` option to agent YAML for explicit control over settings discovery:
   ```yaml
   setting_sources:
     - project  # Load from .claude/ in workspace
     - local    # Load from user's local Claude config
   ```

This enables herdctl agents to operate inside existing codebases with full access to project-specific Claude Code configuration - they behave as if you ran `claude` directly in that directory.
