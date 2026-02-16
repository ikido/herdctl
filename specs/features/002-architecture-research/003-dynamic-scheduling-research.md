# Dynamic Scheduling Research: OpenClaw vs herdctl

## Summary

OpenClaw provides a fully dynamic, runtime-managed scheduling system where agents can create, modify, list, and delete their own scheduled jobs via a `cron` tool exposed to the LLM. This enables use cases like "remind me tomorrow at 9am," "check this URL every hour," and cross-agent task delegation -- none of which are possible in herdctl's current static, config-driven scheduler.

---

## 1. How OpenClaw's Scheduling Works

### 1.1 Architecture Overview

OpenClaw's scheduling is built as a **Gateway service** (`CronService`) that manages a persistent job store. The LLM interacts with it through a `cron` tool that proxies requests to the gateway via JSON-RPC. The architecture looks like:

```
LLM Agent
  |
  v
cron tool (agent-side)  -->  Gateway JSON-RPC  -->  CronService
                                                       |
                                                   CronJob Store (JSON file)
                                                       |
                                                   Timer-based Scheduler
                                                       |
                                                   Job Execution (systemEvent or agentTurn)
```

**Key files in OpenClaw:**
- `/home/dev/projects/openclaw/src/agents/tools/cron-tool.ts` -- The tool exposed to agents
- `/home/dev/projects/openclaw/src/cron/service.ts` -- CronService facade
- `/home/dev/projects/openclaw/src/cron/service/ops.ts` -- CRUD operations
- `/home/dev/projects/openclaw/src/cron/service/timer.ts` -- Timer-based execution engine
- `/home/dev/projects/openclaw/src/cron/service/jobs.ts` -- Job creation, patching, due-checking
- `/home/dev/projects/openclaw/src/cron/types.ts` -- Type definitions
- `/home/dev/projects/openclaw/src/gateway/server-cron.ts` -- Gateway integration

### 1.2 Schedule Types (Three Kinds)

OpenClaw supports three schedule kinds, defined in `CronSchedule`:

```typescript
type CronSchedule =
  | { kind: "at"; at: string }           // One-shot at absolute ISO-8601 time
  | { kind: "every"; everyMs: number; anchorMs?: number }  // Recurring interval
  | { kind: "cron"; expr: string; tz?: string };           // Cron expression with timezone
```

- **`at`** -- One-shot jobs. Fire once at an absolute time. By default `deleteAfterRun: true` removes the job after successful execution; on error the job is disabled rather than retried endlessly.
- **`every`** -- Recurring interval jobs. `everyMs` is the interval in milliseconds, `anchorMs` is an optional epoch anchor to align intervals.
- **`cron`** -- Standard cron expressions with optional timezone support.

### 1.3 Payload Types (What Happens When a Job Fires)

Each job specifies a `sessionTarget` and a `payload`:

```typescript
type CronPayload =
  | { kind: "systemEvent"; text: string }         // Inject text as system event into main session
  | { kind: "agentTurn"; message: string; model?: string; thinking?: string; timeoutSeconds?: number };
                                                   // Run agent in isolated session
```

- **`systemEvent` + `sessionTarget: "main"`** -- Injects text directly into the agent's main conversation context. Used for reminders: "Hey, you asked me to remind you about the meeting."
- **`agentTurn` + `sessionTarget: "isolated"`** -- Spins up a completely new, isolated agent session. The agent runs the prompt, produces output, and the result can optionally be delivered back to a chat channel.

### 1.4 The Cron Tool (Agent-Facing API)

The `cron` tool exposed to agents supports these actions:

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `status` | Check cron scheduler health | none |
| `list` | List all jobs (optionally include disabled) | `includeDisabled?` |
| `add` | Create a new job | `job` object (schedule + payload) |
| `update` | Modify an existing job | `jobId` + `patch` object |
| `remove` | Delete a job | `jobId` |
| `run` | Trigger a job immediately | `jobId`, `runMode?` (due/force) |
| `runs` | Get job run history | `jobId` |
| `wake` | Send an immediate wake event | `text`, `mode?` |

**Example: Agent creates a one-shot reminder**
```json
{
  "action": "add",
  "job": {
    "name": "morning-reminder",
    "schedule": { "kind": "at", "at": "2026-02-17T09:00:00Z" },
    "sessionTarget": "main",
    "payload": { "kind": "systemEvent", "text": "Reminder: Review the Q1 budget proposal." }
  }
}
```

**Example: Agent creates a recurring background task**
```json
{
  "action": "add",
  "job": {
    "name": "hourly-url-check",
    "schedule": { "kind": "every", "everyMs": 3600000 },
    "sessionTarget": "isolated",
    "payload": { "kind": "agentTurn", "message": "Check https://status.example.com and report any anomalies." },
    "delivery": { "mode": "announce", "channel": "slack", "to": "#ops-alerts" }
  }
}
```

### 1.5 Delivery System

For isolated `agentTurn` jobs, OpenClaw has a delivery system that routes the agent's output back to a specific chat channel:

```typescript
type CronDelivery = {
  mode: "none" | "announce";
  channel?: CronMessageChannel;  // "slack", "discord", "telegram", "last", etc.
  to?: string;                   // Channel/user ID
  bestEffort?: boolean;          // Don't fail the job if delivery fails
};
```

The tool automatically infers delivery targets from the session key when the agent creates a job. For instance, if an agent is talking in a Slack channel and creates a cron job, the delivery defaults to announcing back to that same Slack channel.

### 1.6 Cross-Agent Task Delegation

OpenClaw enables cross-agent work through two mechanisms:

1. **`sessions_spawn` tool** -- Spawns a background sub-agent run in an isolated session. The spawning agent specifies a `task`, optional `agentId` (to target a different agent), and the result is announced back. Access control is managed via `subagents.allowAgents` config.

2. **`agentId` on cron jobs** -- When creating a cron job, the `agentId` field can target a different agent. The cron service resolves the agent config for the target agent when executing, so Agent A can schedule work that runs as Agent B.

### 1.7 Timer-Based Execution (Not Polling)

Unlike herdctl's polling loop, OpenClaw uses a **timer-based** approach:

1. After any mutation (add/update/remove/job-complete), compute the earliest `nextRunAtMs` across all jobs.
2. Set a single `setTimeout` for that time (clamped to max 60 seconds for drift protection).
3. When the timer fires, find all due jobs, execute them sequentially, then re-arm the timer.

This is more efficient than polling every second: the timer sleeps for exactly as long as needed, only waking when work is due.

### 1.8 Error Handling and Backoff

OpenClaw has sophisticated error handling:
- **Exponential backoff**: 30s, 1min, 5min, 15min, 60min for consecutive errors
- **Auto-disable**: After 3 consecutive schedule computation errors, the job is automatically disabled
- **Stuck run detection**: Jobs marked as "running" for over 2 hours are automatically cleared
- **One-shot error handling**: `at` jobs are disabled after any terminal status (ok, error, skipped) to prevent retry loops

### 1.9 Context Injection for Reminders

A notable feature: when creating `systemEvent` reminders, the agent can request `contextMessages: N` (up to 10). The tool fetches the last N messages from the current conversation and appends them to the reminder text, so when the reminder fires, it includes the original context of why it was created.

---

## 2. Current herdctl Scheduling Limitations

### 2.1 Architecture

herdctl's scheduler is a **config-driven polling loop**:

**Key files:**
- `/home/dev/projects/herdctl/packages/core/src/scheduler/scheduler.ts` -- Polling loop
- `/home/dev/projects/herdctl/packages/core/src/scheduler/schedule-runner.ts` -- Job execution
- `/home/dev/projects/herdctl/packages/core/src/scheduler/types.ts` -- Type definitions
- `/home/dev/projects/herdctl/packages/core/src/config/schema.ts` -- Config schema (lines 462-476)

```typescript
// herdctl schedule config schema
const ScheduleSchema = z.object({
  type: z.enum(["interval", "cron", "webhook", "chat"]),
  interval: z.string().optional(),     // "5m", "1h"
  expression: z.string().optional(),   // cron expression
  prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
  enabled: z.boolean().optional(),
  resume_session: z.boolean().optional(),
});
```

### 2.2 Specific Limitations

1. **No runtime schedule creation** -- Schedules are defined in YAML config and loaded at startup. Agents cannot create new schedules.

2. **No one-shot/delayed tasks** -- There is no `at` schedule type. You cannot say "do this at 3pm tomorrow."

3. **No agent-to-agent delegation** -- No mechanism for Agent A to schedule work for Agent B.

4. **No schedule modification** -- Running agents cannot update, disable, or remove schedules.

5. **No delivery routing** -- Scheduled job output goes to stdout/logs, not back to a chat channel.

6. **Polling-based** -- The scheduler polls every 1 second regardless of when the next job is due. Efficient enough for a small fleet, but not architecturally elegant.

7. **No context awareness** -- Scheduled prompts are static strings from config. No ability to capture conversation context when creating a reminder.

8. **No error backoff** -- Failed schedules retry at their normal interval with no exponential backoff.

9. **No run history** -- No persistent log of when jobs ran, whether they succeeded, or what they produced.

---

## 3. Comparison Table

| Capability | OpenClaw | herdctl |
|-----------|---------|---------|
| **Schedule definition** | Runtime (agent-created via tool) | Static (YAML config only) |
| **One-shot/delayed tasks** | `at` schedule kind | Not supported |
| **Recurring intervals** | `every` (milliseconds) | `interval` (human-readable: "5m") |
| **Cron expressions** | `cron` with timezone support | `cron` (no timezone) |
| **Runtime CRUD** | Full: add/update/remove/list/status | None -- config reload only |
| **Agent self-scheduling** | Yes, via `cron` tool | No |
| **Cross-agent delegation** | Yes, via `agentId` on jobs + `sessions_spawn` | No |
| **Execution model** | Timer-based (event-driven) | Polling (1s interval) |
| **Payload types** | systemEvent (inject text) / agentTurn (isolated run) | Static prompt from config |
| **Delivery routing** | Announce to chat channel (Slack/Discord/etc.) | None (stdout/logs only) |
| **Context capture** | `contextMessages` preserves conversation context | No |
| **Error backoff** | Exponential: 30s to 60min | None |
| **One-shot cleanup** | Auto-delete or auto-disable after run | Not applicable |
| **Run history/audit** | Per-job run log with status, duration, summary | None |
| **Session management** | Isolated sessions per cron run, with session reaper | Session resume via stored session ID |
| **Manual trigger** | `run` action (force or due-only) | Not supported at runtime |
| **Persistence** | JSON file store with atomic writes | State directory files |
| **Work sources** | Not integrated with cron (separate concept) | Integrated with schedules |

---

## 4. Recommended Approach for Adding Dynamic Scheduling to herdctl

### 4.1 Design Principles

1. **Tool-first**: Expose scheduling as an MCP tool or internal tool that agents can call during execution, not just static config.
2. **Gateway pattern**: Like OpenClaw, route schedule mutations through a central service rather than having agents write directly to state files.
3. **Incremental adoption**: Keep the existing config-based schedules working, but add a runtime job store alongside them.
4. **Pre-MVP simplicity**: Start with a simple implementation and iterate.

### 4.2 Proposed Architecture

```
Agent (Claude Code)
  |
  v
FleetManager API (new methods)
  |
  v
DynamicScheduler (new, extends/replaces Scheduler)
  |
  +-- Config-based schedules (existing, from YAML)
  +-- Dynamic job store (new, JSON file in .herdctl/)
  |
  v
Timer-based execution engine
  |
  v
JobExecutor (existing)
```

### 4.3 Implementation Phases

**Phase 1: Dynamic Job Store**
- Add a `DynamicJobStore` that persists jobs to `.herdctl/cron-jobs.json`
- Define `DynamicJob` type with `at`, `every`, and `cron` schedule kinds
- Support `add`, `update`, `remove`, `list`, `get` operations
- Merge dynamic jobs with config-based schedules in the scheduler loop

**Phase 2: Agent-Facing Tool**
- Create a `schedule` MCP tool (or internal tool) with actions: `add`, `list`, `update`, `remove`, `run`
- The tool calls FleetManager methods which mutate the job store
- Support one-shot (`at`) and recurring (`every`, `cron`) schedules
- Include `agentName` parameter for cross-agent delegation (with allowlist)

**Phase 3: Timer-Based Execution**
- Replace the polling loop with timer-based execution
- Compute the next wake time after every mutation
- Use `setTimeout` with a max clamp (e.g., 60s) for drift protection
- This is an optimization, not a blocker for Phase 1/2

**Phase 4: Delivery Integration**
- When a dynamic job completes, route output back to the originating chat connector (Slack/Discord)
- Use the existing connector infrastructure to send messages
- Support `delivery` config on jobs: `{ channel: "slack", target: "#channel-name" }`

### 4.4 Suggested Type Definitions

```typescript
// Dynamic job schedule (inspired by OpenClaw, simplified for herdctl)
type DynamicSchedule =
  | { kind: "at"; at: string }                          // ISO-8601 timestamp
  | { kind: "every"; interval: string }                 // Human-readable: "5m", "1h"
  | { kind: "cron"; expression: string; tz?: string };  // Cron with timezone

// Dynamic job definition
interface DynamicJob {
  id: string;                    // UUID
  name: string;                  // Human-readable name
  createdBy: string;             // Agent name that created this job
  targetAgent: string;           // Agent name that should execute this job
  schedule: DynamicSchedule;
  prompt: string;                // What the agent should do
  enabled: boolean;
  deleteAfterRun?: boolean;      // For one-shot jobs
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  state: {
    nextRunAt?: string;
    lastRunAt?: string;
    lastStatus?: "success" | "failure" | "skipped";
    lastError?: string;
    consecutiveErrors?: number;
  };
}

// Tool actions
type ScheduleToolAction = "add" | "list" | "update" | "remove" | "run" | "status";
```

### 4.5 Key Differences from OpenClaw

| Aspect | OpenClaw Approach | Recommended herdctl Approach |
|--------|------------------|------------------------------|
| **Gateway** | Centralized gateway server | FleetManager API (simpler, no gateway) |
| **Session model** | main vs isolated sessions | Reuse existing JobExecutor (already handles sessions) |
| **Payload types** | systemEvent / agentTurn | Simple prompt string (consistent with existing schedules) |
| **Delivery** | Complex multi-channel routing | Leverage existing connector infrastructure |
| **Job store** | Custom JSON store with locks | Same, but simpler (single-process model) |
| **Intervals** | Milliseconds (`everyMs`) | Human-readable strings ("5m", "1h") consistent with existing config |
| **Error backoff** | Exponential, built into scheduler | Add to existing scheduler (straightforward) |

### 4.6 What NOT to Copy from OpenClaw

- **Gateway complexity**: OpenClaw routes everything through a JSON-RPC gateway because it supports multiple frontends (WhatsApp, Telegram, Discord, etc.). herdctl's single-process model makes this unnecessary -- FleetManager methods are sufficient.
- **Session target distinction**: OpenClaw's `main` vs `isolated` session target adds complexity. herdctl should just run dynamic jobs the same way it runs config-based scheduled jobs.
- **Legacy payload migration**: OpenClaw has extensive normalization code for backward compatibility with older payload formats. herdctl is pre-MVP and needs none of this.
- **Delivery inference from session keys**: OpenClaw infers delivery targets by parsing complex session key formats. herdctl should use explicit config.

### 4.7 Priority Order

1. **One-shot delayed tasks** (`at` kind) -- highest user value, enables "do this tomorrow"
2. **Agent self-scheduling** (the tool itself) -- enables agents to create their own schedules
3. **Cross-agent delegation** (the `targetAgent` field) -- enables multi-agent workflows
4. **Error backoff** -- prevents runaway retry loops
5. **Run history** -- audit trail for scheduled work
6. **Timer-based execution** -- optimization, not urgent
7. **Delivery routing** -- depends on connector maturity
