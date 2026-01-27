---
"@herdctl/core": minor
"@herdctl/discord": minor
---

Add Claude Agent SDK session resumption for Discord conversation continuity

- Add `resume` option to `TriggerOptions` to pass session ID for conversation continuity
- Add `sessionId` to `TriggerResult` to return the SDK session ID after job completion
- Update `JobControl.trigger()` to pass `resume` through to job executor
- Add `setSession()` method to Discord SessionManager for storing SDK session IDs
- Update `DiscordManager.handleMessage()` to:
  - Get existing session ID before triggering (via `getSession()`)
  - Pass session ID as `resume` option to `trigger()`
  - Store returned SDK session ID after job completion (via `setSession()`)

This enables conversation continuity in Discord DMs and channels - Claude will remember
the context from previous messages in the conversation.
