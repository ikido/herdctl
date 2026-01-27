---
"@herdctl/core": minor
---

Add shell script hook execution after job completion

- Implement ShellHookRunner that executes shell commands with HookContext JSON on stdin
- Add HookExecutor to orchestrate hook execution with event filtering and error handling
- Support `continue_on_error` option (default: true) to control whether hook failures affect job status
- Support `on_events` filter to run hooks only for specific events (completed, failed, timeout, cancelled)
- Default timeout of 30 seconds for shell commands
- Integrate hooks into ScheduleExecutor to run after job completion
- Add hook configuration schemas to agent config (`hooks.after_run`, `hooks.on_error`)
- Full test coverage for ShellHookRunner and HookExecutor
