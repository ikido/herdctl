# Context for PRD Creation: herdctl-core-scheduler

I'm building **herdctl** - an autonomous agent fleet management system for Claude Code.

## Required Reading

1. **SPEC.md** - Schedule/Trigger concepts, interval behavior
2. **plan.md** - PRD sequence
3. **packages/core/src/config/schema.ts** - ScheduleSchema (interval, cron, webhook, chat)
4. **packages/core/src/runner/** - JobExecutor for executing agents
5. **packages/core/src/work-sources/** - WorkSource interface for fetching tasks
6. **packages/core/src/state/** - Job metadata, fleet state
7. **tasks/config-parsing-prd.md** - Example PRD format

PRDs 1-5 are complete (config, state, docs, runner, work-sources).

## PRD 6 Scope: Scheduler (Interval-Based MVP)

Build `packages/core/src/scheduler/` - the orchestration layer that triggers agents.

### Focus: Interval Triggers Only

- **Interval**: "Every 5m after last completion" - timer starts after job finishes
- Prevents job pile-up if execution takes longer than interval
- Cron support is PRD 9 (future)

### User Stories

1. **Parse interval strings** - Convert "5m", "1h", "30s", "2d" to milliseconds
2. **Track schedule state** - Store last_run_at, next_run_at per agent/schedule
3. **Calculate next trigger** - Based on last completion + interval
4. **Schedule loop** - Check all schedules and trigger due agents
5. **Execute triggers** - Call runner with agent config and prompt
6. **Respect max_concurrent** - Don't exceed agent's concurrent job limit
7. **Handle errors** - Log errors, update state, continue with other schedules
8. **Graceful shutdown** - Stop new triggers, wait for running jobs
9. **Update documentation** - Add Scheduling section

## Core Interface

```typescript
export interface Scheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  trigger(agentName: string, scheduleName?: string): Promise<Job>;
  getStatus(): SchedulerStatus;
}

export interface SchedulerStatus {
  running: boolean;
  activeJobs: number;
  schedules: ScheduleStatus[];
}

export interface ScheduleStatus {
  agent: string;
  schedule: string;
  lastRunAt?: Date;
  nextRunAt?: Date;
  status: 'idle' | 'running' | 'disabled';
}

export function parseInterval(interval: string): number; // returns ms
```

## File Structure

```
packages/core/src/scheduler/
├── index.ts
├── types.ts
├── scheduler.ts          # Main Scheduler class
├── interval.ts           # Interval parsing
├── schedule-runner.ts    # Execute individual schedules
├── errors.ts
└── __tests__/
```

## Interval Format

```
5s → 5000ms    5m → 300000ms    1h → 3600000ms    1d → 86400000ms
```

## Schedule Configuration

```yaml
schedules:
  issue-check:
    type: interval
    interval: 5m
    prompt: "Check for ready GitHub issues and work on the oldest one"
    work_source:
      type: github
      labels:
        ready: ready-for-ai
```

## Scheduler Loop

```typescript
while (running) {
  for (const agent of agents) {
    for (const [name, schedule] of agent.schedules) {
      if (schedule.type !== 'interval') continue;
      const state = getScheduleState(agent.name, name);
      if (now >= state.nextRunAt && canRun(agent)) {
        await executeSchedule(agent, name, schedule);
      }
    }
  }
  await sleep(checkInterval);
}
```

## Concurrency Control

```yaml
instances:
  max_concurrent: 2  # Max simultaneous jobs for this agent
```

Track running jobs per agent, skip if at limit, decrement on completion.

## Integration Points

- **Runner**: Call `executeJob()` when schedule triggers
- **State**: Read/write last_run_at, next_run_at
- **Work Source**: Optionally fetch work item for prompt
- **Config**: Read agent schedules and defaults

## Quality Gates

- `pnpm typecheck` and `pnpm test` pass (>90% coverage)
- Documentation updated and builds

## Notes

- Interval timer starts after job **completes**, not when it starts
- Consider jitter to prevent thundering herd
- Persist state to survive restarts
- Cron is PRD 9 - don't implement here

Create a detailed PRD following the format in `tasks/config-parsing-prd.md`.
