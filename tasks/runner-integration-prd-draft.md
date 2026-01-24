# PRD: FleetManager Runner Integration & Refactoring

## Overview

Complete the runner integration in FleetManager so that scheduled triggers actually execute Claude agents, and refactor the 2300+ line FleetManager into smaller, maintainable modules (target: <500 lines each).

## Background

### The Runner Gap

The FleetManager scheduler triggers schedules correctly, but `handleScheduleTrigger` (line 2185) only logs and emits events - it doesn't execute Claude:

```typescript
// Current implementation (fleet-manager.ts:2203-2204)
// For now, just log the trigger
// In future PRDs, this will actually run the agent via the runner
```

The `JobExecutor` class already exists in `packages/core/src/runner/` and handles:
- Creating job records
- Executing agents via Claude SDK
- Streaming output to job logs
- Updating job status on completion

It just isn't wired to `handleScheduleTrigger`.

### The Size Problem

`fleet-manager.ts` is 2316 lines, which causes:
- Difficulty for humans and LLMs to reason about
- Higher risk of bugs during modifications
- Hard to test individual features in isolation
- Context limitations when AI assistants work on it

## Goals

1. **Wire runner to scheduler** - When a schedule triggers, actually run Claude
2. **Break up FleetManager** - Extract logical modules, each <500 lines
3. **Maintain all functionality** - No regressions, all tests pass
4. **Preserve API compatibility** - FleetManager public interface unchanged

## Non-Goals

- Adding new FleetManager features (beyond runner integration)
- Changing the JobExecutor implementation
- Modifying the Scheduler internals
- Changing the config schema

---

## User Stories

### US-1: Execute Agents on Schedule Trigger

**As a** user running herdctl
**I want** scheduled triggers to actually run Claude
**So that** my agents perform work autonomously

**Acceptance Criteria:**
- [ ] `handleScheduleTrigger` calls `JobExecutor.execute()` with agent config
- [ ] Creates job record before execution starts
- [ ] Streams output to job log file in real-time
- [ ] Emits `job:created`, `job:output`, `job:completed`/`job:failed` events
- [ ] Updates job status to `completed` or `failed` when done
- [ ] Handles errors gracefully (don't crash scheduler on agent failure)

**Current Behavior:**
```bash
$ herdctl run my-agent
[fleet-manager] Triggering my-agent/check-issues
[fleet-manager] Schedule check-issues triggered for agent my-agent
[fleet-manager] Completed  # <-- No Claude execution!
```

**Expected Behavior:**
```bash
$ herdctl run my-agent
[fleet-manager] Triggering my-agent/check-issues
[fleet-manager] Created job job-2024-01-15-abc123 for my-agent
[fleet-manager] Job output streaming to .herdctl/jobs/job-2024-01-15-abc123.jsonl
... Claude execution happens, output streamed ...
[fleet-manager] Job job-2024-01-15-abc123 completed in 45s
```

---

### US-2: SDK Integration via Dependency Injection

**As a** library consumer
**I want** to inject my own SDK query function
**So that** I can use custom API configurations or mock for testing

**Acceptance Criteria:**
- [ ] FleetManager accepts optional `sdkQuery` function in options
- [ ] Default implementation uses `@anthropic-ai/claude-code` SDK
- [ ] Tests can inject mock SDK for fast, deterministic tests
- [ ] Existing tests continue to work without SDK calls

**Interface:**
```typescript
interface FleetManagerOptions {
  configPath?: string;
  stateDir: string;
  logger?: FleetManagerLogger;
  checkInterval?: number;
  sdkQuery?: SDKQueryFunction;  // NEW
}
```

---

### US-3: Extract Status Queries Module

**As a** maintainer
**I want** status query methods in their own module
**So that** the code is easier to understand and modify

**Acceptance Criteria:**
- [ ] Create `fleet-manager/status-queries.ts` (~300 lines)
- [ ] Move: `getFleetStatus`, `getAgentInfo`, `getAgentInfoByName`
- [ ] Move helper methods: `readFleetStateSnapshot`, `buildAgentInfo`, `buildScheduleInfoList`, `computeFleetCounts`
- [ ] FleetManager delegates to this module
- [ ] All existing tests pass

**Pattern:**
```typescript
// status-queries.ts
export class StatusQueries {
  constructor(private context: FleetManagerContext) {}

  async getFleetStatus(): Promise<FleetStatus> { ... }
  async getAgentInfo(): Promise<AgentInfo[]> { ... }
  async getAgentInfoByName(name: string): Promise<AgentInfo> { ... }
}

// fleet-manager.ts
class FleetManager {
  private statusQueries: StatusQueries;

  async getFleetStatus() {
    return this.statusQueries.getFleetStatus();
  }
}
```

---

### US-4: Extract Schedule Management Module

**As a** maintainer
**I want** schedule management methods in their own module
**So that** schedule-related logic is consolidated

**Acceptance Criteria:**
- [ ] Create `fleet-manager/schedule-management.ts` (~200 lines)
- [ ] Move: `getSchedules`, `getSchedule`, `enableSchedule`, `disableSchedule`
- [ ] FleetManager delegates to this module
- [ ] All existing tests pass

---

### US-5: Extract Config Reload Module

**As a** maintainer
**I want** config reload logic in its own module
**So that** the complex diff logic is isolated

**Acceptance Criteria:**
- [ ] Create `fleet-manager/config-reload.ts` (~300 lines)
- [ ] Move: `reload` method
- [ ] Move: `computeConfigChanges`, `isAgentModified`, `isScheduleModified`, `getScheduleModificationDetails`
- [ ] FleetManager delegates to this module
- [ ] All existing tests pass

---

### US-6: Extract Job Control Module

**As a** maintainer
**I want** job control methods in their own module
**So that** trigger/cancel/fork logic is isolated

**Acceptance Criteria:**
- [ ] Create `fleet-manager/job-control.ts` (~350 lines)
- [ ] Move: `trigger`, `cancelJob`, `forkJob`
- [ ] Move: `cancelRunningJobs`, `persistShutdownState`
- [ ] FleetManager delegates to this module
- [ ] All existing tests pass

---

### US-7: Extract Log Streaming Module

**As a** maintainer
**I want** log streaming methods in their own module
**So that** the complex streaming logic is isolated

**Acceptance Criteria:**
- [ ] Create `fleet-manager/log-streaming.ts` (~450 lines)
- [ ] Move: `streamLogs`, `streamJobOutput`, `streamAgentLogs`
- [ ] Move: `jobOutputToLogEntry`, `shouldYieldLog`
- [ ] FleetManager delegates to this module
- [ ] All existing tests pass

---

### US-8: Extract Event Emitters Module

**As a** maintainer
**I want** event emission helpers in their own module
**So that** FleetManager core is focused on orchestration

**Acceptance Criteria:**
- [ ] Create `fleet-manager/event-emitters.ts` (~100 lines)
- [ ] Move all `emitXxx` methods
- [ ] FleetManager delegates to this module (or uses mixin pattern)
- [ ] All existing tests pass

---

## Technical Design

### File Changes

**New Files:**
| File | Lines | Purpose |
|------|-------|---------|
| `fleet-manager/status-queries.ts` | ~300 | Fleet and agent status queries |
| `fleet-manager/schedule-management.ts` | ~200 | Schedule CRUD operations |
| `fleet-manager/config-reload.ts` | ~300 | Hot reload and diff logic |
| `fleet-manager/job-control.ts` | ~350 | Trigger, cancel, fork jobs |
| `fleet-manager/log-streaming.ts` | ~450 | Log streaming async iterables |
| `fleet-manager/event-emitters.ts` | ~100 | Event emission helpers |
| `fleet-manager/context.ts` | ~50 | Shared context interface |

**Modified Files:**
| File | Changes |
|------|---------|
| `fleet-manager/fleet-manager.ts` | Reduced to ~400 lines, delegates to modules |
| `fleet-manager/index.ts` | Re-export all modules |

### Shared Context Pattern

The extracted modules need access to FleetManager internals. Use a context interface:

```typescript
// context.ts
export interface FleetManagerContext {
  // Config
  readonly config: ResolvedConfig | null;
  readonly stateDir: string;
  readonly logger: FleetManagerLogger;

  // Runtime
  readonly scheduler: Scheduler | null;
  readonly stateDirInfo: StateDirectory | null;
  readonly status: FleetManagerStatus;

  // Methods for internal use
  emit(event: string, ...args: unknown[]): boolean;
}
```

### Runner Integration Detail

```typescript
// In fleet-manager.ts
private async handleScheduleTrigger(info: TriggerInfo): Promise<void> {
  const { agent, scheduleName, schedule } = info;
  const timestamp = new Date().toISOString();

  this.logger.info(`Triggering ${agent.name}/${scheduleName}`);

  // Emit typed event
  this.emit("schedule:triggered", {
    agentName: agent.name,
    scheduleName,
    schedule,
    timestamp,
  });

  try {
    // Create and run job via JobExecutor
    const result = await this.executor.execute({
      agent,
      prompt: schedule.prompt ?? agent.system_prompt ?? "Execute your scheduled task.",
      stateDir: this.stateDir,
      triggerType: "schedule",
      schedule: scheduleName,
      onMessage: (msg) => {
        this.emit("job:output", {
          jobId: result.jobId, // Note: need to handle this differently
          agentName: agent.name,
          output: msg.content ?? "",
          timestamp: new Date().toISOString(),
        });
      },
    });

    if (result.success) {
      this.emit("job:completed", { ... });
      this.emit("schedule:complete", agent.name, scheduleName);
    } else {
      this.emit("job:failed", { ... });
      this.emit("schedule:error", agent.name, scheduleName, result.error);
    }
  } catch (error) {
    this.logger.error(`Error in ${agent.name}/${scheduleName}: ${(error as Error).message}`);
    this.emit("schedule:error", agent.name, scheduleName, error);
  }
}
```

### Module File Structure After Refactor

```
packages/core/src/fleet-manager/
├── index.ts                    # Re-exports
├── fleet-manager.ts            # ~400 lines - core orchestration
├── context.ts                  # ~50 lines - shared context interface
├── types.ts                    # (existing, unchanged)
├── errors.ts                   # (existing, unchanged)
├── event-types.ts              # (existing, unchanged)
├── status-queries.ts           # ~300 lines - NEW
├── schedule-management.ts      # ~200 lines - NEW
├── config-reload.ts            # ~300 lines - NEW
├── job-control.ts              # ~350 lines - NEW
├── log-streaming.ts            # ~450 lines - NEW
├── event-emitters.ts           # ~100 lines - NEW
├── job-manager.ts              # (existing, unchanged)
└── job-queue.ts                # (existing, unchanged)
```

---

## Quality Gates

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes with coverage thresholds (85% lines/functions/statements, 65% branches)
- [ ] No public API changes to FleetManager class
- [ ] All existing tests pass without modification
- [ ] New integration test: schedule triggers actual Claude execution
- [ ] `fleet-manager.ts` reduced to <500 lines
- [ ] Each extracted module <500 lines
- [ ] Manual test: `herdctl run my-agent` produces Claude output

---

## Test Plan

### Unit Tests

**Runner Integration:**
- Mock SDK returns expected messages
- Job created before execution
- Job status updated on completion
- Job status updated on failure
- Events emitted in correct order

**Extracted Modules:**
- Each module tested in isolation
- Context dependency injection works
- Delegation pattern works correctly

### Integration Tests

**New Test: Schedule Actually Runs Claude**
```typescript
test("schedule trigger executes agent via runner", async () => {
  const mockSdkQuery = vi.fn().mockImplementation(async function* () {
    yield { type: "system", subtype: "init", session_id: "sess-123" };
    yield { type: "assistant", content: "I completed the task." };
    yield { type: "system", subtype: "done" };
  });

  const manager = new FleetManager({
    configPath: "./test-config.yaml",
    stateDir: tempDir,
    sdkQuery: mockSdkQuery,
  });

  await manager.initialize();
  await manager.start();

  // Wait for schedule to trigger
  await waitForEvent(manager, "job:completed", 10000);

  // Verify SDK was called
  expect(mockSdkQuery).toHaveBeenCalled();

  // Verify job was created and completed
  const jobs = await listJobs(join(tempDir, "jobs"), {});
  expect(jobs.jobs).toHaveLength(1);
  expect(jobs.jobs[0].status).toBe("completed");
});
```

---

## Constraints

- Preserve all existing FleetManager public methods and events
- No changes to config schema
- No changes to JobExecutor implementation
- Each extracted module must be <500 lines
- Use composition/delegation, not inheritance
- Maintain full backward compatibility

---

## Implementation Order

Recommended sequence to minimize risk:

1. **US-2: SDK Dependency Injection** - Add `sdkQuery` option to FleetManager
2. **US-1: Runner Integration** - Wire `handleScheduleTrigger` to `JobExecutor`
3. **US-3: Status Queries** - Extract first module (lowest coupling)
4. **US-8: Event Emitters** - Extract (low risk, low coupling)
5. **US-4: Schedule Management** - Extract
6. **US-5: Config Reload** - Extract
7. **US-6: Job Control** - Extract
8. **US-7: Log Streaming** - Extract (highest complexity, do last)

---

## Future Enhancements (Out of Scope)

- Concurrent job execution for same agent (currently limited to 1)
- Job priority queue
- Resource-aware scheduling
- Agent warm-up / pre-loading
- Job dependencies (run A before B)
