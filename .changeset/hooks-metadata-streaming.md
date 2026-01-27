---
"@herdctl/core": minor
---

Add hooks metadata feature and fix SDK message streaming

**Hooks Metadata:**
- Add `when` field for conditional hook execution using dot-notation paths
- Add `name` field for human-readable hook names in logs
- Add `metadata_file` agent config for reading agent-provided metadata
- Include agent metadata in HookContext for conditional execution
- Display metadata in Discord embed notifications

**SDK Message Streaming:**
- Fix content extraction from nested SDK message structure
- Add support for `stream_event`, `tool_progress`, `auth_status` message types
- Add `onMessage` callback to `TriggerOptions` for real-time message streaming

**Output Extraction:**
- Fix `extractJobOutput` to prefer assistant text over raw tool results
- Discord notifications now show agent's text summary instead of JSON
