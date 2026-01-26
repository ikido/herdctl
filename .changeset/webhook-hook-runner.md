---
"@herdctl/core": minor
---

Add WebhookHookRunner for POST/PUT webhook integrations

- Implement WebhookHookRunner that POSTs HookContext JSON to configured URLs
- Support custom headers with ${ENV_VAR} substitution for auth tokens
- Support POST and PUT HTTP methods
- Default timeout of 10000ms (configurable)
- HTTP 2xx responses are treated as success, all others as failure
- HTTP errors are logged but don't fail the job by default (continue_on_error: true)
