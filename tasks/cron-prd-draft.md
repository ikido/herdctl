# Cron Scheduling PRD Prompt Draft

Use this prompt with ralph-tui to generate the Cron Scheduling PRD.

---

## Prompt

Create a PRD for `herdctl-core-cron` - adding cron expression support to the scheduler alongside the existing interval-based scheduling.

### Context

herdctl is a TypeScript-based system for managing fleets of autonomous Claude Code agents. The scheduler module (`packages/core/src/scheduler/`) currently supports interval-based scheduling (e.g., "5m", "1h"). Users also need cron-based scheduling for more precise timing control.

**Good news**: The config schema already supports cron!

```typescript
// From packages/core/src/config/schema.ts
export const ScheduleTypeSchema = z.enum(["interval", "cron", "webhook", "chat"]);

export const ScheduleSchema = z.object({
  type: ScheduleTypeSchema,
  interval: z.string().optional(), // "5m", "1h", etc.
  expression: z.string().optional(), // cron expression - NOT YET IMPLEMENTED
  prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
});
```

The scheduler currently skips cron schedules with reason `"not_interval"`.

### Existing Scheduler Architecture

The scheduler module has these key files:

```
packages/core/src/scheduler/
├── interval.ts          # parseInterval(), calculateNextTrigger(), isScheduleDue()
├── schedule-runner.ts   # Runs individual schedules
├── schedule-state.ts    # Manages schedule state persistence
├── scheduler.ts         # Main Scheduler class
├── types.ts             # TypeScript interfaces
├── errors.ts            # Error classes
└── index.ts             # Exports
```

**Key functions in `interval.ts`**:
- `parseInterval(interval: string): number` - Parses "5m" → 300000ms
- `calculateNextTrigger(lastCompletedAt, interval, jitterPercent?): Date`
- `isScheduleDue(nextRunAt, now?): boolean`

### User Stories

#### US-1: Parse Cron Expressions
**As a** developer configuring agents
**I want** to use standard cron expressions in my schedule config
**So that** I can trigger agents at specific times (e.g., "every day at 9am")

**Implementation**:
- Add `cron.ts` alongside `interval.ts`
- Use `cron-parser` npm package for parsing (well-maintained, TypeScript support)
- Create `parseCronExpression(expression: string): CronExpression`
- Support standard 5-field cron: `minute hour day-of-month month day-of-week`
- Support common extensions: `@daily`, `@hourly`, `@weekly`

**Example configs**:
```yaml
schedules:
  daily-report:
    type: cron
    expression: "0 9 * * *"  # Every day at 9:00 AM
    prompt: "Generate the daily report"

  weekday-standup:
    type: cron
    expression: "30 9 * * 1-5"  # Weekdays at 9:30 AM
    prompt: "Post standup summary"
```

#### US-2: Calculate Next Cron Trigger
**As a** scheduler
**I want** to calculate when a cron schedule should next trigger
**So that** agents run at the correct times

**Implementation**:
- Create `calculateNextCronTrigger(expression: string, lastCompletedAt?: Date): Date`
- Use `cron-parser` to get next occurrence after `lastCompletedAt` (or now)
- Handle timezone (default to system timezone, future: configurable)

#### US-3: Integrate Cron into Scheduler
**As a** scheduler
**I want** to handle both interval and cron schedules
**So that** users can choose the scheduling method that fits their needs

**Implementation**:
- Update `schedule-runner.ts` to check schedule type
- If `type === "interval"`, use existing `calculateNextTrigger()`
- If `type === "cron"`, use new `calculateNextCronTrigger()`
- Remove `"not_interval"` skip reason, replace with `"unsupported_type"` for webhook/chat
- Update `ScheduleSkipReason` type

#### US-4: Validate Cron Expressions
**As a** user writing config
**I want** clear error messages for invalid cron expressions
**So that** I can fix configuration mistakes

**Implementation**:
- Add `CronParseError` to `errors.ts`
- Validate expressions at config load time
- Provide helpful error messages with examples

**Example errors**:
```
CronParseError: Invalid cron expression "0 25 * * *" - hour must be 0-23
CronParseError: Invalid cron expression "* * *" - expected 5 fields, got 3
```

#### US-5: Update Documentation
**As a** user learning herdctl
**I want** documentation on cron scheduling
**So that** I understand how to configure time-based triggers

**Documentation updates**:
- `docs/src/content/docs/configuration/agent-config.mdx` - Add cron examples
- `docs/src/content/docs/concepts/schedules.mdx` - Explain cron vs interval
- `docs/src/content/docs/internals/scheduler.mdx` - Technical details

### File Changes

**New files**:
```
packages/core/src/scheduler/cron.ts           # Cron parsing and calculation
packages/core/src/scheduler/__tests__/cron.test.ts  # Cron tests
```

**Modified files**:
```
packages/core/src/scheduler/errors.ts         # Add CronParseError
packages/core/src/scheduler/schedule-runner.ts # Handle cron type
packages/core/src/scheduler/types.ts          # Update ScheduleSkipReason
packages/core/src/scheduler/index.ts          # Export cron functions
packages/core/package.json                    # Add cron-parser dependency
```

### Dependencies to Add

```json
{
  "dependencies": {
    "cron-parser": "^4.9.0"
  }
}
```

### Quality Gates

- `pnpm typecheck` passes
- `pnpm test` passes with coverage thresholds maintained
- All cron expression edge cases tested (valid, invalid, boundaries)
- Integration test: cron schedule triggers at correct time
- Documentation builds successfully

### Example Test Cases

```typescript
// Parsing
parseCronExpression("0 9 * * *")     // Valid: 9:00 AM daily
parseCronExpression("*/15 * * * *")  // Valid: Every 15 minutes
parseCronExpression("@daily")        // Valid: Shorthand for 0 0 * * *
parseCronExpression("invalid")       // Throws CronParseError

// Next trigger calculation
const expr = "0 9 * * *";  // 9:00 AM daily
const now = new Date("2024-01-15T08:00:00");
calculateNextCronTrigger(expr, now)  // 2024-01-15T09:00:00

const afterRun = new Date("2024-01-15T09:00:00");
calculateNextCronTrigger(expr, afterRun)  // 2024-01-16T09:00:00
```

### Constraints

- Use `cron-parser` library (don't reinvent the wheel)
- Maintain backward compatibility with interval schedules
- Default timezone is system timezone (UTC configuration is future scope)
- 5-field cron only (no seconds field) - keeps it simple and standard

### Out of Scope

- 6-field cron (with seconds) - not needed for agent scheduling
- Timezone configuration per schedule - future enhancement
- Cron expression builder UI - for web dashboard later

---

## Notes for PRD Generation

- This is a focused enhancement to an existing module
- The architecture is already set up - just need to implement cron path
- Keep the same patterns as `interval.ts` for consistency
- `cron-parser` handles all the complex date math - leverage it fully
