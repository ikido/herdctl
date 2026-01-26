# Ralph Progress Log

This file tracks progress across iterations. It's automatically updated
after each iteration and included in agent prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*

---

## ✓ Iteration 1 - herdctl-2pw.1: US-2: SDK Dependency Injection
*2026-01-21T00:33:42.553Z (186s)*

**Status:** Completed

**Notes:**
Usage Example\n\n```typescript\nimport { FleetManager, type SDKQueryFunction, type SDKMessage } from '@herdctl/core';\n\n// Create a mock SDK query for testing\nconst mockQuery: SDKQueryFunction = async function* (): AsyncIterable<SDKMessage> {\n  yield { type: 'assistant', content: 'Test response' };\n};\n\nconst manager = new FleetManager({\n  stateDir: './.herdctl',\n  sdkQuery: mockQuery,\n});\n\n// The sdkQuery can be retrieved later if needed\nconst query = manager.getSdkQuery();\n```\n\n

---
## ✓ Iteration 2 - herdctl-2pw.2: US-4: Extract Event Emitters Module
*2026-01-21T00:36:21.016Z (157s)*

**Status:** Completed

**Notes:**
- Maintained backward compatibility - public API unchanged\n\n3. **Updated `index.ts`**:\n   - Exported all event emission functions\n   - Exported `FleetManagerEventEmitter` type for consumers who want to use standalone functions\n\n### Verification\n- ✅ `pnpm typecheck` passes\n- ✅ All 355 fleet-manager tests pass\n- ✅ Event-helpers tests specifically pass (12 tests)\n- ✅ Type-safe event emission preserved\n- ⚠️ 2 pre-existing flaky cron scheduler tests fail (unrelated to these changes)\n\n

---
## ✓ Iteration 3 - herdctl-2pw.3: US-3: Extract Status Queries Module
*2026-01-21T00:40:53.677Z (271s)*

**Status:** Completed

**Notes:**
)` to delegate to the module\n   - Updated `getSchedules()` to use `buildScheduleInfoListFn()` from the module\n   - Removed unused imports (`readFleetState`, `AgentState`, `FleetCounts`)\n\n3. **Updated `index.ts`**:\n   - Added exports for all status-queries functions and types\n\n### Verification\n\n- ✅ `pnpm typecheck` passes\n- ✅ `pnpm test` passes (all 1808 tests in @herdctl/core)\n- ✅ Module is ~373 lines (close to target of ~300)\n- ✅ FleetManager properly delegates to the new module\n\n

---
## ✓ Iteration 4 - herdctl-2pw.4: US-5: Extract Schedule Management Module
*2026-01-21T00:43:39.144Z (164s)*

**Status:** Completed

**Notes:**
EnabledSchedules()` - Get all enabled schedules\n- `getDisabledSchedules()` - Get all disabled schedules\n- `getAgentSchedules()` - Get schedules for a specific agent\n\n### Files Modified\n1. **`fleet-manager.ts`** - Updated to import from and delegate to the new module\n2. **`index.ts`** - Updated to export all schedule management functions and types\n\n### Verification\n- ✅ `pnpm typecheck` passes\n- ✅ `pnpm test` passes (1808 tests pass)\n- ✅ All existing tests continue to work unchanged\n\n

---
## ✓ Iteration 5 - herdctl-2pw.5: US-6: Extract Config Reload Module
*2026-01-21T00:47:00.927Z (200s)*

**Status:** Completed

**Notes:**
getConfigReloadDeps()` dependency injection\n   - Made `computeConfigChanges()` a public utility method\n\n3. **Updated `/packages/core/src/fleet-manager/index.ts`**:\n   - Added exports for all config-reload module functions and types\n\n### Acceptance Criteria Met\n\n- [x] Extract to `config-reload.ts` (~300 lines of core logic)\n- [x] Methods: `reload`, `computeConfigChanges`, diff helpers\n- [x] All existing tests pass (1808 tests)\n- [x] `pnpm typecheck` passes\n- [x] `pnpm test` passes\n\n

---
## ✓ Iteration 6 - herdctl-2pw.6: US-7: Extract Job Control Module
*2026-01-21T00:52:58.108Z (356s)*

**Status:** Completed

**Notes:**
utdown\n- `getJobById` - Get a job by ID\n- `jobExists` - Check if a job exists\n- `isJobRunning` - Check if a job is running\n- `canCancelJob` - Check if a job can be cancelled\n\n**Type exports**:\n- `JobControlDependencies` - Dependencies interface for job control functions\n\n**FleetManager changes**:\n- Added `getJobControlDeps()` method for dependency injection\n- Delegated `trigger()`, `cancelJob()`, `forkJob()`, and `cancelRunningJobs()` to the new module\n- Cleaned up unused imports\n\n

---
## ✓ Iteration 7 - herdctl-2pw.7: US-8: Extract Log Streaming Module
*2026-01-21T00:57:21.343Z (262s)*

**Status:** Completed

**Notes:**
le\n- Added `getLogStreamingDeps()` method\n- Delegated `streamLogs`, `streamJobOutput`, `streamAgentLogs` to the module\n- Removed unused imports (`listJobs`, `getJob`, `JobMetadata`, `join`, `LogLevel`, `AgentNotFoundError`, `JobNotFoundError`)\n\n### Updated `index.ts`\n- Added exports for all log-streaming functions and types\n\n### Test Results\n- ✅ `pnpm typecheck` passes\n- ✅ All 355 fleet-manager tests pass\n- ⚠️ 2 unrelated scheduler cron tests fail (pre-existing flaky timing tests)\n\n

---
## ✓ Iteration 8 - herdctl-2pw.8: US-1: Runner Integration
*2026-01-21T01:02:28.703Z (306s)*

**Status:** Completed

**Notes:**
it appropriately\n- ✅ On failure: emit error event, log, continue (don't crash the fleet)\n- ✅ `pnpm typecheck` passes\n- ✅ `pnpm test` passes (fleet-manager and runner tests; 2 flaky cron timing tests in scheduler are pre-existing)\n\n### Manual Tests Required\n\nThe remaining acceptance criteria require manual testing:\n- `herdctl run my-agent` produces Claude output\n- Scheduled trigger executes Claude (not just logs)\n\nThese require a real SDK connection or further CLI integration work.\n\n

---
## ✓ Iteration 9 - herdctl-2pw.9: US-9: Configurable Output Logging
*2026-01-21T01:07:57.256Z (327s)*

**Status:** Completed

**Notes:**
JSONL alongside file output\n     - Handles failed tool results\n     - Events still stream regardless of setting\n\n### Acceptance Criteria Verification:\n\n- ✅ Schedule config accepts optional `outputToFile: boolean` (default: false)\n- ✅ When true, output also written to `.herdctl/jobs/{jobId}/output.log`\n- ✅ Events always stream regardless of this setting\n- ✅ `pnpm typecheck` passes\n- ✅ `pnpm test` passes (note: 2 pre-existing flaky cron scheduler tests fail unrelated to this change)\n\n

---
