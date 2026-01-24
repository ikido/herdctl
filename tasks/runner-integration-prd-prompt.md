# Runner Integration PRD Prompt

Create a PRD for `herdctl-runner-integration` - completing the runner integration and refactoring FleetManager into smaller modules.

**For full details**: See `tasks/runner-integration-prd-draft.md`

## The Problem

1. **Runner Gap**: `handleScheduleTrigger` in FleetManager only logs - it doesn't execute Claude. The `JobExecutor` exists but isn't wired up.

2. **File Too Large**: `fleet-manager.ts` is 2316 lines. Too big for humans or LLMs to work with reliably.

## Goals

1. Wire `handleScheduleTrigger` to `JobExecutor` so schedules run Claude
2. Break `fleet-manager.ts` into modules, each <500 lines
3. No public API changes, all tests pass

## User Stories

1. **Runner Integration** - `handleScheduleTrigger` calls `JobExecutor.execute()`, creates jobs, streams output, emits events
2. **SDK Dependency Injection** - FleetManager accepts optional `sdkQuery` for testing
3. **Extract Status Queries** (~300 lines) - `getFleetStatus`, `getAgentInfo`, helpers
4. **Extract Schedule Management** (~200 lines) - `getSchedules`, `enableSchedule`, `disableSchedule`
5. **Extract Config Reload** (~300 lines) - `reload`, `computeConfigChanges`, diff helpers
6. **Extract Job Control** (~350 lines) - `trigger`, `cancelJob`, `forkJob`
7. **Extract Log Streaming** (~450 lines) - `streamLogs`, `streamJobOutput`, `streamAgentLogs`
8. **Extract Event Emitters** (~100 lines) - All `emitXxx` methods

## Module Structure After Refactor

```
packages/core/src/fleet-manager/
├── fleet-manager.ts            # ~400 lines - core lifecycle only
├── context.ts                  # ~50 lines - shared context interface
├── status-queries.ts           # ~300 lines
├── schedule-management.ts      # ~200 lines
├── config-reload.ts            # ~300 lines
├── job-control.ts              # ~350 lines
├── log-streaming.ts            # ~450 lines
├── event-emitters.ts           # ~100 lines
├── types.ts                    # (existing)
├── errors.ts                   # (existing)
└── index.ts                    # Re-exports
```

## Key Technical Details

**Shared Context Pattern:**
```typescript
export interface FleetManagerContext {
  readonly config: ResolvedConfig | null;
  readonly stateDir: string;
  readonly logger: FleetManagerLogger;
  readonly scheduler: Scheduler | null;
  emit(event: string, ...args: unknown[]): boolean;
}
```

**Runner Integration:**
```typescript
// handleScheduleTrigger calls:
const result = await this.executor.execute({
  agent,
  prompt: schedule.prompt ?? "Execute your scheduled task.",
  stateDir: this.stateDir,
  triggerType: "schedule",
  schedule: scheduleName,
});
```

## Implementation Order

1. Add `sdkQuery` option to FleetManager
2. Wire `handleScheduleTrigger` to `JobExecutor`
3. Extract modules in order: status-queries → event-emitters → schedule-management → config-reload → job-control → log-streaming

## Quality Gates

- `pnpm typecheck` and `pnpm test` pass
- All existing tests pass without modification
- `fleet-manager.ts` reduced to <500 lines
- Each extracted module <500 lines
- Manual test: `herdctl run my-agent` produces Claude output

## Constraints

- Preserve all FleetManager public methods and events
- No changes to config schema or JobExecutor
- Use composition/delegation, not inheritance
