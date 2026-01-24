# Plan: FleetManager Cleanup - Remove Delegation Boilerplate

## Problem

`fleet-manager.ts` is 1464 lines (target: <500). The extracted modules are good, but FleetManager has excessive boilerplate:

1. **5 `getDeps()` methods** (~200 lines) - Build dependency objects for each module
2. **12 delegating wrapper methods** (~300 lines) - Public methods that just call extracted modules
3. **`handleScheduleTrigger`** (~180 lines) - Runner code not extracted

## Solution

Replace the verbose delegation pattern with direct composition. The extracted modules should be instantiated once and their methods called directly.

---

## Step 1: Create a Shared Context Class (~50 lines)

Create `packages/core/src/fleet-manager/context.ts`:

```typescript
import type { ResolvedConfig } from "../config/index.js";
import type { StateDirectory } from "../state/index.js";
import type { Scheduler } from "../scheduler/index.js";
import type { FleetManagerLogger, FleetManagerStatus } from "./types.js";
import type { EventEmitter } from "node:events";

export interface FleetManagerContext {
  // Getters for current state
  getConfig(): ResolvedConfig | null;
  getStateDir(): string;
  getStateDirInfo(): StateDirectory | null;
  getLogger(): FleetManagerLogger;
  getScheduler(): Scheduler | null;
  getStatus(): FleetManagerStatus;

  // Event emission
  emit(event: string, ...args: unknown[]): boolean;
}
```

---

## Step 2: Refactor Extracted Modules to Use Context

Each extracted module should:
- Take `FleetManagerContext` in constructor (not individual deps)
- Store context reference
- Access what it needs via context getters

Example refactor for `status-queries.ts`:

**Before:**
```typescript
export interface StatusQueryDependencies {
  config: ResolvedConfig | null;
  stateDir: string;
  stateDirInfo: StateDirectory | null;
  scheduler: Scheduler | null;
  logger: FleetManagerLogger;
}

export async function getFleetStatus(deps: StatusQueryDependencies): Promise<FleetStatus> {
  // uses deps.config, deps.stateDir, etc.
}
```

**After:**
```typescript
export class StatusQueries {
  constructor(private ctx: FleetManagerContext) {}

  async getFleetStatus(): Promise<FleetStatus> {
    const config = this.ctx.getConfig();
    const stateDir = this.ctx.getStateDir();
    // ... rest of implementation
  }

  async getAgentInfo(): Promise<AgentInfo[]> { ... }
  async getAgentInfoByName(name: string): Promise<AgentInfo> { ... }
}
```

---

## Step 3: Refactor Each Module

### 3a. `status-queries.ts`
- Convert to `StatusQueries` class
- Constructor takes `FleetManagerContext`
- Move `getFleetStatus`, `getAgentInfo`, `getAgentInfoByName` as methods
- Move helper methods (`readFleetStateSnapshot`, `buildAgentInfo`, etc.) as private methods

### 3b. `schedule-management.ts`
- Convert to `ScheduleManagement` class
- Methods: `getSchedules`, `getSchedule`, `enableSchedule`, `disableSchedule`

### 3c. `config-reload.ts`
- Convert to `ConfigReload` class
- Methods: `reload`, `computeConfigChanges`
- Private helpers: `isAgentModified`, `isScheduleModified`, etc.

### 3d. `job-control.ts`
- Convert to `JobControl` class
- Methods: `trigger`, `cancelJob`, `forkJob`
- Private helpers: `cancelRunningJobs`, `persistShutdownState`

### 3e. `log-streaming.ts`
- Convert to `LogStreaming` class
- Methods: `streamLogs`, `streamJobOutput`, `streamAgentLogs`
- Private helpers: `jobOutputToLogEntry`, `shouldYieldLog`

### 3f. `event-emitters.ts`
- Keep as functions (they're already lean)
- Or convert to `EventEmitters` class with emit methods

---

## Step 4: Extract `handleScheduleTrigger` to Runner Module

Create `packages/core/src/fleet-manager/schedule-executor.ts` (~200 lines):

```typescript
export class ScheduleExecutor {
  constructor(
    private ctx: FleetManagerContext,
    private sdkQuery: SDKQueryFunction | undefined
  ) {}

  async executeSchedule(info: TriggerInfo): Promise<void> {
    // Move all of handleScheduleTrigger here
    // Including mapMessageTypeToOutputType, extractMessageContent
  }
}
```

---

## Step 5: Simplify FleetManager

FleetManager becomes a thin orchestrator:

```typescript
export class FleetManager extends EventEmitter implements FleetManagerContext {
  // State
  private status: FleetManagerStatus = "uninitialized";
  private config: ResolvedConfig | null = null;
  private stateDirInfo: StateDirectory | null = null;
  private scheduler: Scheduler | null = null;
  private readonly stateDir: string;
  private readonly logger: FleetManagerLogger;

  // Composed modules (instantiated in initialize())
  private statusQueries!: StatusQueries;
  private scheduleManagement!: ScheduleManagement;
  private configReload!: ConfigReload;
  private jobControl!: JobControl;
  private logStreaming!: LogStreaming;
  private scheduleExecutor!: ScheduleExecutor;

  // Context interface implementation
  getConfig() { return this.config; }
  getStateDir() { return this.stateDir; }
  getStateDirInfo() { return this.stateDirInfo; }
  getLogger() { return this.logger; }
  getScheduler() { return this.scheduler; }
  getStatus() { return this.status; }

  // Public API - direct delegation (no wrapper logic)
  getFleetStatus() { return this.statusQueries.getFleetStatus(); }
  getAgentInfo() { return this.statusQueries.getAgentInfo(); }
  getAgentInfoByName(name: string) { return this.statusQueries.getAgentInfoByName(name); }

  getSchedules() { return this.scheduleManagement.getSchedules(); }
  getSchedule(a: string, s: string) { return this.scheduleManagement.getSchedule(a, s); }
  enableSchedule(a: string, s: string) { return this.scheduleManagement.enableSchedule(a, s); }
  disableSchedule(a: string, s: string) { return this.scheduleManagement.disableSchedule(a, s); }

  trigger(...args) { return this.jobControl.trigger(...args); }
  cancelJob(...args) { return this.jobControl.cancelJob(...args); }
  forkJob(...args) { return this.jobControl.forkJob(...args); }

  reload() { return this.configReload.reload(); }

  streamLogs(...args) { return this.logStreaming.streamLogs(...args); }
  streamJobOutput(id: string) { return this.logStreaming.streamJobOutput(id); }
  streamAgentLogs(name: string) { return this.logStreaming.streamAgentLogs(name); }

  // Core lifecycle methods stay in FleetManager
  async initialize() { ... }  // ~50 lines
  async start() { ... }       // ~30 lines
  async stop() { ... }        // ~50 lines
}
```

---

## Step 6: Update Tests

- Tests should continue to pass (public API unchanged)
- May need to update imports if module exports change
- Add tests for new `FleetManagerContext` interface

---

## Expected Line Counts After Refactor

| File | Before | After |
|------|--------|-------|
| `fleet-manager.ts` | 1464 | ~300 |
| `context.ts` | 0 | ~50 |
| `status-queries.ts` | 373 | ~350 |
| `schedule-management.ts` | 409 | ~380 |
| `config-reload.ts` | 606 | ~550 |
| `job-control.ts` | 565 | ~500 |
| `log-streaming.ts` | 650 | ~600 |
| `event-emitters.ts` | 204 | ~200 |
| `schedule-executor.ts` | 0 | ~200 |

---

## Quality Gates

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (all 1819 tests)
- [ ] `fleet-manager.ts` is <400 lines
- [ ] No public API changes (method signatures identical)
- [ ] Coverage remains at or above current level

---

## Files to Modify

1. **Create**: `context.ts`
2. **Create**: `schedule-executor.ts`
3. **Modify**: `fleet-manager.ts` (major refactor)
4. **Modify**: `status-queries.ts` (convert to class)
5. **Modify**: `schedule-management.ts` (convert to class)
6. **Modify**: `config-reload.ts` (convert to class)
7. **Modify**: `job-control.ts` (convert to class)
8. **Modify**: `log-streaming.ts` (convert to class)
9. **Modify**: `index.ts` (update exports)
