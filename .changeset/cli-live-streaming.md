---
"herdctl": minor
---

Add live streaming output to trigger command

- Stream assistant messages in real-time during job execution
- Display output as it's generated instead of waiting for completion
- Add `--quiet` flag support for suppressing streaming output
- Extract content from nested SDK message structure
