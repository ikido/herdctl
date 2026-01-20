# PRD 6: Scheduler (Interval-Based MVP)

## Overview

Implement the interval-based scheduler for herdctl in `packages/core/src/scheduler/`. This module orchestrates agent execution by monitoring schedule configurations, tracking schedule state, and triggering jobs when intervals elapse. The scheduler integrates with the Runner (PRD 4) to execute agents and Work Sources (PRD 5) to optionally fetch work items.

**Key Design Principle**: Interval timers start after job **completion**, not when the job starts. This prevents job pile-up if execution takes longer than the interval.

## User Stories

### US-1: Parse Interval Strings
**As a** fleet operator
**I want to** specify intervals in human-readable format like "5m", "1h", "30s"
**So that** I don't have to calculate milliseconds manually

**Acceptance Criteria:**
- Parse `{number}{unit}` format where unit is s/m/h/d
- `5s` → 5000ms, `5m` → 300000ms, `1h` → 3600000ms, `1d` → 86400000ms
- Support integer values only (no "1.5h")
- Throw descriptive `SchedulerError` for invalid formats
- Handle edge cases: empty string, missing unit, invalid unit, negative numbers
- Export `parseInterval(interval: string): number` function

### US-2: Track Schedule State
**As a** scheduler
**I want to** persist last_run_at and next_run_at per agent/schedule
**So that** schedules survive restarts and can be monitored

**Acceptance Criteria:**
- Store schedule state in existing fleet state (`.herdctl/state.yaml`)
- Extend `AgentState` with optional `schedules` map:
  ```typescript
  schedules?: Record<string, {
    last_run_at?: string;  // ISO timestamp
    next_run_at?: string;  // ISO timestamp
    status: 'idle' | 'running' | 'disabled';
  }>;
  ```
- Provide `getScheduleState(stateDir, agentName, scheduleName)` function
- Provide `updateScheduleState(stateDir, agentName, scheduleName, updates)` function
- Handle missing schedule state gracefully (return defaults)

### US-3: Calculate Next Trigger Time
**As a** scheduler
**I want to** calculate when each schedule should next trigger
**So that** I can efficiently wake up and trigger jobs

**Acceptance Criteria:**
- `calculateNextTrigger(lastCompletedAt: Date, interval: string): Date`
- If no `lastCompletedAt`, return `now` (trigger immediately on first run)
- Next trigger = lastCompletedAt + interval
- Handle clock skew gracefully (if next_trigger_at is in the past, trigger now)
- Optionally add jitter to prevent thundering herd (configurable 0-10% of interval)

### US-4: Scheduler Loop
**As a** scheduler
**I want to** continuously check all schedules and trigger due agents
**So that** agents run according to their configured intervals

**Acceptance Criteria:**
- `Scheduler.start()` begins the polling loop
- Check all agents' interval schedules on each iteration
- Default check interval: 1 second (configurable)
- Skip non-interval schedule types (cron, webhook, chat reserved for future PRDs)
- Skip disabled schedules
- Skip agents at max_concurrent capacity
- Log when skipping due to capacity or schedule conditions
- Efficient: don't spin-wait, use appropriate sleep

### US-5: Execute Schedule Triggers
**As a** scheduler
**I want to** invoke the runner with agent config and prompt when triggered
**So that** scheduled work actually executes

**Acceptance Criteria:**
- Call `JobExecutor.execute()` when schedule triggers
- Pass agent config, prompt from schedule config, and trigger metadata
- Set `triggerType: 'interval'` and `schedule: scheduleName`
- Update schedule state to 'running' before execution
- Update schedule state with `last_run_at` and calculate `next_run_at` after completion
- Handle work_source integration: if schedule has work_source, fetch work item first

### US-6: Respect max_concurrent Limit
**As a** fleet operator
**I want to** limit concurrent jobs per agent
**So that** resources aren't exhausted and work is manageable

**Acceptance Criteria:**
- Read `instances.max_concurrent` from agent config (default: 1)
- Track running jobs per agent in scheduler state
- Skip triggering if `runningJobs[agentName] >= max_concurrent`
- Decrement running count when job completes (success or failure)
- Expose `getRunningJobCount(agentName): number` for monitoring

### US-7: Handle Errors Gracefully
**As a** scheduler
**I want** errors in one schedule to not affect other schedules
**So that** the fleet remains operational despite individual failures

**Acceptance Criteria:**
- Catch and log errors during schedule execution
- Update schedule state to include error info
- Continue processing other schedules after error
- Implement exponential backoff for repeatedly failing schedules (optional)
- Don't mark job as complete if execution failed (let Runner handle job state)

### US-8: Graceful Shutdown
**As a** fleet operator
**I want** the scheduler to shut down cleanly
**So that** running jobs complete and state is consistent

**Acceptance Criteria:**
- `Scheduler.stop()` signals shutdown
- Stop starting new triggers immediately
- Optionally wait for running jobs to complete (configurable timeout)
- Update fleet state on shutdown
- Return Promise that resolves when shutdown complete
- Handle SIGINT/SIGTERM signals (at CLI level, not scheduler)

### US-9: Update Documentation
**As a** developer
**I want** comprehensive documentation for the scheduler
**So that** I understand how to configure and monitor scheduled agents

**Acceptance Criteria:**
- Add "Scheduling" section to docs covering:
  - Interval configuration syntax and examples
  - How interval timing works (after completion, not start)
  - Concurrency control with max_concurrent
  - Schedule state and monitoring
  - Integration with work sources
- Update existing config documentation to reference scheduling
- Add troubleshooting section for common scheduling issues

## Technical Specifications

### File Structure

```
packages/core/src/scheduler/
├── index.ts              # Public exports
├── types.ts              # Type definitions
├── scheduler.ts          # Main Scheduler class
├── interval.ts           # parseInterval(), calculateNextTrigger()
├── schedule-state.ts     # Schedule state read/write utilities
├── schedule-runner.ts    # Execute individual schedules
├── errors.ts             # SchedulerError classes
└── __tests__/
    ├── interval.test.ts
    ├── schedule-state.test.ts
    ├── schedule-runner.test.ts
    └── scheduler.test.ts
```

### Core Interfaces

```typescript
// types.ts

/**
 * Status of an individual schedule
 */
export interface ScheduleStatus {
  /** Agent this schedule belongs to */
  agent: string;
  /** Schedule name */
  schedule: string;
  /** When this schedule last completed */
  lastRunAt?: Date;
  /** When this schedule should next trigger */
  nextRunAt?: Date;
  /** Current status */
  status: 'idle' | 'running' | 'disabled';
  /** Error message if last run failed */
  lastError?: string;
}

/**
 * Overall scheduler status
 */
export interface SchedulerStatus {
  /** Whether the scheduler is running */
  running: boolean;
  /** Number of currently executing jobs */
  activeJobs: number;
  /** Status of all tracked schedules */
  schedules: ScheduleStatus[];
}

/**
 * Options for creating a Scheduler instance
 */
export interface SchedulerOptions {
  /** Path to .herdctl state directory */
  stateDir: string;
  /** Resolved configuration with all agents */
  config: ResolvedConfig;
  /** SDK query function for executing jobs */
  sdkQuery: SDKQueryFunction;
  /** Work source manager for fetching work items */
  workSourceManager?: WorkSourceManager;
  /** Logger instance */
  logger?: SchedulerLogger;
  /** Interval between scheduler checks (default: 1000ms) */
  checkInterval?: number;
  /** Jitter percentage to add to intervals (0-100, default: 0) */
  jitterPercent?: number;
}

/**
 * Options for stopping the scheduler
 */
export interface StopOptions {
  /** Wait for running jobs to complete */
  waitForJobs?: boolean;
  /** Timeout in ms for waiting (default: 30000) */
  timeout?: number;
}

/**
 * Logger interface for scheduler
 */
export interface SchedulerLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
}

/**
 * Result of triggering a schedule
 */
export interface TriggerResult {
  /** Whether the trigger succeeded */
  success: boolean;
  /** Job ID if successful */
  jobId?: string;
  /** Error message if failed */
  error?: string;
  /** Whether the schedule was skipped (capacity, disabled, etc) */
  skipped?: boolean;
  /** Reason for skipping */
  skipReason?: 'at_capacity' | 'disabled' | 'not_due' | 'no_work';
}
```

### Scheduler Class

```typescript
// scheduler.ts

export class Scheduler {
  private running = false;
  private runningJobs: Map<string, Set<string>> = new Map(); // agentName -> jobIds
  private checkLoopPromise?: Promise<void>;
  private abortController?: AbortController;
  
  constructor(options: SchedulerOptions);
  
  /**
   * Start the scheduler loop
   * Returns immediately, loop runs in background
   */
  async start(): Promise<void>;
  
  /**
   * Stop the scheduler
   * @param options - Stop options (wait for jobs, timeout)
   */
  async stop(options?: StopOptions): Promise<void>;
  
  /**
   * Manually trigger a schedule
   * @param agentName - Agent to trigger
   * @param scheduleName - Optional specific schedule (triggers first if omitted)
   */
  async trigger(agentName: string, scheduleName?: string): Promise<TriggerResult>;
  
  /**
   * Get current scheduler status
   */
  getStatus(): SchedulerStatus;
  
  /**
   * Get running job count for an agent
   */
  getRunningJobCount(agentName: string): number;
  
  /**
   * Check if the scheduler is running
   */
  isRunning(): boolean;
}
```

### Interval Parsing

```typescript
// interval.ts

/**
 * Parse an interval string into milliseconds
 * 
 * @param interval - Interval string (e.g., "5s", "10m", "1h", "2d")
 * @returns Milliseconds
 * @throws SchedulerError if format is invalid
 * 
 * @example
 * parseInterval("5s")  // 5000
 * parseInterval("10m") // 600000
 * parseInterval("1h")  // 3600000
 * parseInterval("2d")  // 172800000
 */
export function parseInterval(interval: string): number;

/**
 * Calculate the next trigger time based on last completion
 * 
 * @param lastCompletedAt - When the schedule last completed (null for never)
 * @param interval - Interval string
 * @param jitterPercent - Optional jitter (0-100)
 * @returns Date when schedule should next trigger
 */
export function calculateNextTrigger(
  lastCompletedAt: Date | null,
  interval: string,
  jitterPercent?: number
): Date;

/**
 * Check if a schedule is due to trigger
 * 
 * @param nextRunAt - When the schedule should run
 * @param now - Current time (default: new Date())
 * @returns Whether the schedule is due
 */
export function isScheduleDue(nextRunAt: Date, now?: Date): boolean;
```

### Schedule State

```typescript
// schedule-state.ts

/**
 * Persisted schedule state (extends fleet state)
 */
export interface PersistedScheduleState {
  last_run_at?: string;
  next_run_at?: string;
  status: 'idle' | 'running' | 'disabled';
  last_error?: string;
}

/**
 * Get schedule state from fleet state
 */
export async function getScheduleState(
  stateDir: string,
  agentName: string,
  scheduleName: string
): Promise<PersistedScheduleState | null>;

/**
 * Update schedule state in fleet state
 */
export async function updateScheduleState(
  stateDir: string,
  agentName: string,
  scheduleName: string,
  updates: Partial<PersistedScheduleState>
): Promise<void>;

/**
 * Get all schedule states for an agent
 */
export async function getAgentScheduleStates(
  stateDir: string,
  agentName: string
): Promise<Record<string, PersistedScheduleState>>;
```

### Schedule Runner

```typescript
// schedule-runner.ts

/**
 * Options for running a schedule
 */
export interface RunScheduleOptions {
  agent: ResolvedAgent;
  scheduleName: string;
  schedule: Schedule;
  stateDir: string;
  sdkQuery: SDKQueryFunction;
  workSourceManager?: WorkSourceManager;
  logger?: SchedulerLogger;
}

/**
 * Execute a single schedule
 * 
 * Handles:
 * 1. Optionally fetching work item if schedule has work_source
 * 2. Building the prompt (from schedule or work item)
 * 3. Calling JobExecutor
 * 4. Updating schedule state
 */
export async function runSchedule(
  options: RunScheduleOptions
): Promise<RunnerResult>;

/**
 * Build prompt for a schedule execution
 * 
 * If work item is provided, incorporates work item details into prompt
 */
export function buildSchedulePrompt(
  schedule: Schedule,
  workItem?: WorkItem
): string;
```

### Error Classes

```typescript
// errors.ts

export class SchedulerError extends Error {
  constructor(message: string, public readonly cause?: Error);
}

export class IntervalParseError extends SchedulerError {
  constructor(message: string, public readonly interval: string);
}

export class ScheduleTriggerError extends SchedulerError {
  constructor(
    message: string,
    public readonly agentName: string,
    public readonly scheduleName: string,
    cause?: Error
  );
}

export class SchedulerShutdownError extends SchedulerError {
  constructor(message: string, public readonly timedOut: boolean);
}
```

### Scheduler Loop Algorithm

```typescript
// Pseudocode for scheduler loop
async function checkLoop() {
  while (this.running) {
    const now = new Date();
    
    for (const agent of this.config.agents.values()) {
      if (!agent.schedules) continue;
      
      for (const [scheduleName, schedule] of Object.entries(agent.schedules)) {
        // Skip non-interval schedules (cron is PRD 9)
        if (schedule.type !== 'interval') continue;
        
        // Check schedule state
        const state = await getScheduleState(this.stateDir, agent.name, scheduleName);
        
        // Skip disabled schedules
        if (state?.status === 'disabled') continue;
        
        // Skip if already running
        if (state?.status === 'running') continue;
        
        // Check capacity
        const runningCount = this.getRunningJobCount(agent.name);
        const maxConcurrent = agent.instances?.max_concurrent ?? 1;
        if (runningCount >= maxConcurrent) {
          this.logger?.debug?.(
            `Skipping ${agent.name}/${scheduleName}: at capacity (${runningCount}/${maxConcurrent})`
          );
          continue;
        }
        
        // Calculate next trigger time
        const lastRunAt = state?.last_run_at ? new Date(state.last_run_at) : null;
        const nextRunAt = state?.next_run_at 
          ? new Date(state.next_run_at)
          : calculateNextTrigger(lastRunAt, schedule.interval!);
        
        // Check if due
        if (!isScheduleDue(nextRunAt, now)) continue;
        
        // Trigger the schedule
        try {
          await this.executeSchedule(agent, scheduleName, schedule);
        } catch (error) {
          this.logger?.error(
            `Error executing ${agent.name}/${scheduleName}: ${error.message}`
          );
          // Continue with other schedules
        }
      }
    }
    
    // Wait before next check
    await this.sleep(this.checkInterval);
  }
}
```

### Fleet State Schema Extension

Extend the existing `AgentStateSchema` in `packages/core/src/state/schemas/fleet-state.ts`:

```typescript
// Add to existing AgentStateSchema
export const ScheduleStateSchema = z.object({
  last_run_at: z.string().nullable().optional(),
  next_run_at: z.string().nullable().optional(),
  status: z.enum(['idle', 'running', 'disabled']).default('idle'),
  last_error: z.string().nullable().optional(),
});

export const AgentStateSchema = z.object({
  status: AgentStatusSchema.default("idle"),
  current_job: z.string().nullable().optional(),
  last_job: z.string().nullable().optional(),
  next_schedule: z.string().nullable().optional(),
  next_trigger_at: z.string().nullable().optional(),
  container_id: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  // NEW: Per-schedule state tracking
  schedules: z.record(z.string(), ScheduleStateSchema).optional(),
});
```

### Integration with Work Sources

When a schedule has a `work_source` configured:

```typescript
async function executeSchedule(agent, scheduleName, schedule) {
  let prompt = schedule.prompt ?? 'Execute scheduled task';
  let workItem: WorkItem | undefined;
  
  // If schedule has work_source, try to fetch work
  if (schedule.work_source && this.workSourceManager) {
    const result = await this.workSourceManager.getNextWorkItem(agent, {
      // Use schedule's work_source config
    });
    
    if (!result.item) {
      this.logger?.info(`No work available for ${agent.name}/${scheduleName}`);
      // Update next_run_at and skip this trigger
      await updateScheduleState(this.stateDir, agent.name, scheduleName, {
        next_run_at: calculateNextTrigger(new Date(), schedule.interval!).toISOString(),
      });
      return { success: true, skipped: true, skipReason: 'no_work' };
    }
    
    workItem = result.item;
    prompt = buildSchedulePrompt(schedule, workItem);
  }
  
  // Execute the job
  const result = await this.executor.execute({
    agent,
    prompt,
    stateDir: this.stateDir,
    triggerType: 'interval',
    schedule: scheduleName,
  });
  
  // Report outcome to work source if we claimed a work item
  if (workItem && this.workSourceManager) {
    await this.workSourceManager.reportOutcome(
      workItem.id,
      {
        outcome: result.success ? 'success' : 'failure',
        summary: result.summary ?? 'Job completed',
        error: result.error?.message,
      },
      { agent }
    );
  }
  
  return result;
}
```

### Public API

```typescript
// index.ts

// Types
export type {
  SchedulerOptions,
  SchedulerStatus,
  ScheduleStatus,
  StopOptions,
  TriggerResult,
  SchedulerLogger,
  PersistedScheduleState,
  RunScheduleOptions,
} from './types.js';

// Scheduler class
export { Scheduler } from './scheduler.js';

// Interval utilities
export {
  parseInterval,
  calculateNextTrigger,
  isScheduleDue,
} from './interval.js';

// Schedule state utilities
export {
  getScheduleState,
  updateScheduleState,
  getAgentScheduleStates,
} from './schedule-state.js';

// Schedule runner
export {
  runSchedule,
  buildSchedulePrompt,
} from './schedule-runner.js';

// Errors
export {
  SchedulerError,
  IntervalParseError,
  ScheduleTriggerError,
  SchedulerShutdownError,
} from './errors.js';
```

## Test Plan

### Unit Tests

```typescript
// __tests__/interval.test.ts
describe('parseInterval', () => {
  it('parses seconds (5s → 5000)');
  it('parses minutes (10m → 600000)');
  it('parses hours (1h → 3600000)');
  it('parses days (2d → 172800000)');
  it('throws for invalid format (empty string)');
  it('throws for invalid format (no unit)');
  it('throws for invalid format (invalid unit)');
  it('throws for invalid format (negative number)');
  it('throws for invalid format (decimal number)');
  it('handles large values (30d)');
});

describe('calculateNextTrigger', () => {
  it('returns now if lastCompletedAt is null');
  it('returns lastCompletedAt + interval');
  it('adds jitter when jitterPercent > 0');
  it('jitter is within expected range');
  it('handles past dates (trigger is in past)');
});

describe('isScheduleDue', () => {
  it('returns true when nextRunAt is in the past');
  it('returns true when nextRunAt equals now');
  it('returns false when nextRunAt is in the future');
});

// __tests__/schedule-state.test.ts
describe('getScheduleState', () => {
  it('returns null for non-existent schedule');
  it('returns persisted state');
  it('handles missing agent in state');
  it('handles corrupted state gracefully');
});

describe('updateScheduleState', () => {
  it('creates schedule state if not exists');
  it('updates existing schedule state');
  it('preserves other schedules');
  it('handles concurrent updates (atomic)');
});

// __tests__/schedule-runner.test.ts
describe('runSchedule', () => {
  it('executes schedule with prompt');
  it('updates schedule state before execution');
  it('updates schedule state after completion');
  it('fetches work item when work_source configured');
  it('skips when no work available');
  it('reports outcome to work source');
  it('handles execution errors');
});

describe('buildSchedulePrompt', () => {
  it('returns schedule prompt when no work item');
  it('incorporates work item title and description');
  it('includes work item URL');
  it('handles missing prompt (uses default)');
});

// __tests__/scheduler.test.ts
describe('Scheduler', () => {
  describe('start/stop', () => {
    it('starts the check loop');
    it('stops when stop() called');
    it('waits for running jobs when stopOptions.waitForJobs');
    it('times out if jobs take too long');
    it('is idempotent (multiple start/stop calls)');
  });
  
  describe('trigger', () => {
    it('manually triggers a schedule');
    it('respects max_concurrent');
    it('returns TriggerResult with jobId on success');
    it('returns error for non-existent agent');
    it('returns error for non-existent schedule');
    it('triggers first schedule if scheduleName omitted');
  });
  
  describe('check loop', () => {
    it('checks all agents on each iteration');
    it('skips non-interval schedules');
    it('skips disabled schedules');
    it('skips schedules at capacity');
    it('triggers due schedules');
    it('continues after schedule error');
    it('respects checkInterval');
  });
  
  describe('getStatus', () => {
    it('returns running state');
    it('returns activeJobs count');
    it('returns all schedule statuses');
  });
  
  describe('concurrency', () => {
    it('tracks running jobs per agent');
    it('decrements on job completion');
    it('decrements on job failure');
    it('enforces max_concurrent limit');
  });
});
```

### Integration Tests

```typescript
describe('Scheduler Integration', () => {
  it('runs interval schedule end-to-end');
  it('integrates with real JobExecutor');
  it('integrates with WorkSourceManager');
  it('persists state across restart');
  it('handles multiple agents with different intervals');
});
```

## Dependencies

Already in packages/core/package.json:
- `zod` - Schema validation (for schedule state extension)

Uses existing modules:
- `@herdctl/core/config` - ResolvedConfig, ResolvedAgent, Schedule types
- `@herdctl/core/state` - Fleet state, job metadata
- `@herdctl/core/runner` - JobExecutor, RunnerResult
- `@herdctl/core/work-sources` - WorkSourceManager, WorkItem

## Out of Scope

- **Cron scheduling**: PRD 9 - don't implement cron expression parsing
- **Webhook triggers**: Future PRD - don't implement HTTP endpoint
- **Chat triggers**: Future PRD - don't implement Discord/Slack integration
- **Web UI**: Future PRD - scheduler exposes status API only
- **Distributed scheduling**: Single-instance scheduler only (no leader election)
- **Retry with backoff**: Simple error handling, no sophisticated retry logic

## Quality Gates

These commands must pass:
- `pnpm typecheck` - Type checking passes in packages/core
- `pnpm test` - Tests pass with >90% coverage of scheduler module
- Documentation site builds successfully (`pnpm build` in docs/)

## Acceptance Criteria Summary

1. `parseInterval` correctly parses all valid formats and rejects invalid ones
2. Schedule state persists to `.herdctl/state.yaml` and survives restarts
3. Scheduler loop checks all interval schedules at configured check interval
4. Jobs execute when `now >= next_run_at` and agent has capacity
5. `max_concurrent` is respected (jobs don't start when at limit)
6. Errors in one schedule don't affect other schedules
7. `Scheduler.stop()` cleanly shuts down without data loss
8. Work source integration fetches work and reports outcomes
9. Manual `trigger()` works for testing and one-off executions
10. Documentation updated with Scheduling section

## Notes

- **Timer starts after completion**: This is critical for preventing pile-up. If an agent takes 10 minutes but interval is 5m, the next run is 15m after the first started.
- **Jitter**: Consider implementing small random jitter (0-10% of interval) to prevent all agents waking at the same instant if they share intervals.
- **State persistence**: Use atomic writes via existing state module to prevent corruption.
- **Cron is PRD 9**: The ScheduleSchema already has `type: 'cron'` but this PRD only implements `type: 'interval'`. Skip cron schedules gracefully.