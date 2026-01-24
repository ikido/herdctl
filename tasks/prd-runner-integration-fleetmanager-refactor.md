# PRD: Runner Integration & FleetManager Refactor

**Feature ID:** `herdctl-runner-integration`
**Status:** Draft
**Author:** Claude (with Ed)
**Created:** 2026-01-20

---

## Problem Statement

The herdctl FleetManager has two critical issues:

1. **Runner Gap**: The `handleScheduleTrigger` method only logs "Schedule triggered" but never executes Claude. The `JobExecutor` class exists and works, but isn't wired up to scheduled triggers.

2. **Unmaintainable File Size**: `fleet-manager.ts` is 2316 lines—too large for humans or LLMs to reliably understand and modify.

## Goals

1. Wire `handleScheduleTrigger` to `JobExecutor` so schedules actually run Claude
2. Break `fleet-manager.ts` into focused modules, each under 500 lines
3. Preserve all public APIs—existing tests must pass without modification

## Non-Goals

- Changing the config schema
- Modifying `JobExecutor` internals
- Adding new FleetManager public methods
- Retry logic for failed scheduled jobs (future work)

---

## User Stories

### US-1: Runner Integration
**As a** user with scheduled agents  
**I want** schedules to actually execute Claude  
**So that** my automated workflows run without manual intervention

**Acceptance Criteria:**
- `handleScheduleTrigger` calls `JobExecutor.execute()` with the agent and schedule prompt
- A job record is created in state before execution starts
- Job output streams to `job:output` events
- `job:started` and `job:completed`/`job:failed` events emit appropriately
- On failure: emit error event, log, continue (don't crash the fleet)

### US-2: SDK Dependency Injection
**As a** developer writing tests  
**I want** to inject a mock SDK query function  
**So that** I can test FleetManager without real Claude API calls

**Acceptance Criteria:**
- `FleetManagerOptions` accepts optional `sdkQuery` parameter
- When provided, `JobExecutor` uses it instead of real SDK
- Existing tests continue to work unchanged

### US-3: Extract Status Queries Module
**As a** maintainer  
**I want** status query methods in a separate module  
**So that** the code is easier to understand and modify

**Acceptance Criteria:**
- Extract to `status-queries.ts` (~300 lines)
- Methods: `getFleetStatus`, `getAgentInfo`, `getJobHistory`, related helpers
- FleetManager delegates to this module
- All existing tests pass

### US-4: Extract Event Emitters Module
**As a** maintainer  
**I want** event emission logic centralized  
**So that** event contracts are clear and consistent

**Acceptance Criteria:**
- Extract to `event-emitters.ts` (~100 lines)
- All `emitXxx` helper methods moved here
- Type-safe event emission preserved
- All existing tests pass

### US-5: Extract Schedule Management Module
**As a** maintainer  
**I want** schedule operations in a dedicated module  
**So that** scheduling logic is cohesive

**Acceptance Criteria:**
- Extract to `schedule-management.ts` (~200 lines)
- Methods: `getSchedules`, `enableSchedule`, `disableSchedule`, schedule helpers
- All existing tests pass

### US-6: Extract Config Reload Module
**As a** maintainer  
**I want** config reload logic isolated  
**So that** the complex diffing logic is easier to maintain

**Acceptance Criteria:**
- Extract to `config-reload.ts` (~300 lines)
- Methods: `reload`, `computeConfigChanges`, diff helpers
- All existing tests pass

### US-7: Extract Job Control Module
**As a** maintainer  
**I want** job operations in a dedicated module  
**So that** job lifecycle is clearly defined

**Acceptance Criteria:**
- Extract to `job-control.ts` (~350 lines)
- Methods: `trigger`, `cancelJob`, `forkJob`, job helpers
- All existing tests pass

### US-8: Extract Log Streaming Module
**As a** maintainer  
**I want** streaming logic separated  
**So that** the async generator patterns are isolated

**Acceptance Criteria:**
- Extract to `log-streaming.ts` (~450 lines)
- Methods: `streamLogs`, `streamJobOutput`, `streamAgentLogs`
- All existing tests pass

### US-9: Configurable Output Logging
**As a** user  
**I want** to configure whether job output is logged to files  
**So that** I can choose between disk usage and debuggability

**Acceptance Criteria:**
- Schedule config accepts optional `outputToFile: boolean` (default: false)
- When true, output also written to `.herdctl/jobs/{jobId}/output.log`
- Events always stream regardless of this setting

---

## Technical Design

### Shared Context Pattern

All extracted modules receive a shared context interface:

```typescript
// context.ts
export interface FleetManagerContext {
  readonly config: ResolvedConfig | null;
  readonly stateDir: string;
  readonly logger: FleetManagerLogger;
  readonly scheduler: Scheduler | null;
  readonly executor: JobExecutor | null;
  emit(event: string, ...args: unknown[]): boolean;
  getState(): FleetState;
  updateState(updater: (state: FleetState) => FleetState): void;
}
```

### Module Structure After Refactor

```
packages/core/src/fleet-manager/
├── fleet-manager.ts            # ~400 lines - lifecycle, init, shutdown
├── context.ts                  # ~50 lines - shared context interface
├── status-queries.ts           # ~300 lines
├── schedule-management.ts      # ~200 lines
├── config-reload.ts            # ~300 lines
├── job-control.ts              # ~350 lines
├── log-streaming.ts            # ~450 lines
├── event-emitters.ts           # ~100 lines
├── types.ts                    # (existing, unchanged)
├── errors.ts                   # (existing, unchanged)
└── index.ts                    # Re-exports (unchanged public API)
```

### Runner Integration Implementation

```typescript
// In fleet-manager.ts or job-control.ts
private async handleScheduleTrigger(
  agent: ResolvedAgentConfig,
  scheduleName: string,
  schedule: ScheduleConfig
): Promise<void> {
  const jobId = generateJobId();
  
  this.emitJobStarted(jobId, agent.name, "schedule", scheduleName);
  
  try {
    const result = await this.executor.execute({
      agent,
      prompt: schedule.prompt ?? "Execute your scheduled task.",
      stateDir: this.stateDir,
      triggerType: "schedule",
      schedule: scheduleName,
      onOutput: (chunk) => {
        this.emitJobOutput(jobId, chunk);
        if (schedule.outputToFile) {
          this.appendToJobLog(jobId, chunk);
        }
      },
    });
    
    this.emitJobCompleted(jobId, result);
  } catch (error) {
    this.logger.error(`Scheduled job failed: ${agent.name}/${scheduleName}`, error);
    this.emitJobFailed(jobId, error);
    // Don't rethrow - fleet continues running
  }
}
```

### SDK Injection

```typescript
// In fleet-manager.ts
export interface FleetManagerOptions {
  // ... existing options
  sdkQuery?: SdkQueryFunction;  // For testing
}

// Passed to JobExecutor during initialization
this.executor = new JobExecutor({
  sdkQuery: options.sdkQuery,
  // ... other config
});
```

---

## Implementation Order

Priority is **refactor completeness** over runner integration polish.

1. **US-2**: Add `sdkQuery` option to FleetManager (enables testing)
2. **US-4**: Extract event-emitters.ts (smallest, validates pattern)
3. **US-3**: Extract status-queries.ts
4. **US-5**: Extract schedule-management.ts
5. **US-6**: Extract config-reload.ts
6. **US-7**: Extract job-control.ts
7. **US-8**: Extract log-streaming.ts
8. **US-1**: Wire handleScheduleTrigger to JobExecutor
9. **US-9**: Add configurable output logging

---

## Testing Strategy

- **Unit tests for each module**: Each extracted module gets focused unit tests
- **Existing integration tests unchanged**: They validate the public API still works
- Modules are tested via their public functions with mocked context

---

## Quality Gates

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] All existing tests pass without modification
- [ ] `fleet-manager.ts` reduced to <500 lines
- [ ] Each extracted module <500 lines
- [ ] Manual test: `herdctl run my-agent` produces Claude output
- [ ] Manual test: Scheduled trigger executes Claude (not just logs)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Refactor breaks subtle behavior | Existing tests catch regressions; extract incrementally |
| Circular dependencies between modules | Context pattern provides one-way dependency |
| Performance impact from delegation | Negligible—method calls, not serialization |

---

## Future Work (Out of Scope)

- Retry logic with exponential backoff for failed scheduled jobs
- Schedule-level concurrency limits
- Job queue persistence across restarts
- Web dashboard integration