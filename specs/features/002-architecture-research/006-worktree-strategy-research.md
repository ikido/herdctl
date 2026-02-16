# Git Worktree Strategy for the Job Executor

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Job Executor Architecture](#current-job-executor-architecture)
3. [What "Strategy" Means in This Context](#what-strategy-means-in-this-context)
4. [Git Worktree Primer](#git-worktree-primer)
5. [How a Git Worktree Strategy Would Work](#how-a-git-worktree-strategy-would-work)
6. [Integration with Session Management](#integration-with-session-management)
7. [Code Structure Proposal](#code-structure-proposal)
8. [Configuration Schema](#configuration-schema)
9. [Open Questions and Design Decisions](#open-questions-and-design-decisions)

---

## Executive Summary

The phrase "git worktree strategy for the job executor" refers to a **proposed feature** -- not something that exists today. The idea is to add a lifecycle layer around job execution that:

1. **Before a job runs**: creates an isolated git worktree with a dedicated branch
2. **During the job**: the agent works inside that worktree directory (not the main repo checkout)
3. **After the job**: commits, pushes, creates a PR, and cleans up the worktree

This is particularly valuable for agents that process work items (e.g., Linear issues, GitHub issues) where each piece of work should happen on its own branch and produce its own PR.

**herdctl does NOT currently have a "strategy" pattern.** The word "strategy" here is shorthand for "a configurable workspace lifecycle behavior." This document proposes how to build one.

---

## Current Job Executor Architecture

### How Jobs Run Today

The execution flow is:

```
FleetManager / ScheduleExecutor / JobControl (trigger point)
  |
  v
RuntimeFactory.create(agent)  -->  SDKRuntime | CLIRuntime | ContainerRunner(wrapping either)
  |
  v
JobExecutor.execute(options)
  |-- Step 1: Create job record in .herdctl/jobs/
  |-- Step 2: Set up output logging (optional)
  |-- Step 3: Update job status to "running"
  |-- Step 3.5: Validate/resume session (if resuming)
  |-- Step 4: Call runtime.execute() and stream SDK messages
  |-- Step 5: Update job with final status
  |-- Step 6: Persist session info for future resume
  |
  v
Result { success, jobId, sessionId, summary, error, durationSeconds }
```

Key files:
- `/home/dev/projects/herdctl/packages/core/src/runner/job-executor.ts` -- The `JobExecutor` class
- `/home/dev/projects/herdctl/packages/core/src/runner/runtime/factory.ts` -- `RuntimeFactory` that creates runtimes
- `/home/dev/projects/herdctl/packages/core/src/runner/runtime/interface.ts` -- `RuntimeInterface` contract
- `/home/dev/projects/herdctl/packages/core/src/runner/runtime/sdk-runtime.ts` -- SDK backend
- `/home/dev/projects/herdctl/packages/core/src/runner/runtime/cli-runtime.ts` -- CLI backend
- `/home/dev/projects/herdctl/packages/core/src/runner/runtime/container-runner.ts` -- Docker decorator

### How `working_directory` Works Today

The agent config has a `working_directory` field:

```yaml
# Simple form:
working_directory: /path/to/repo

# Structured form:
working_directory:
  root: /path/to/repo
  auto_clone: true
  clone_depth: 1
  default_branch: main
```

This is **static** -- it's set once in the config and doesn't change per job. It flows through the system like this:

1. **Config loading** -- `resolveWorkingDirectory(agent)` normalizes it to a string path
2. **SDK adapter** -- `toSDKOptions()` sets `sdkOptions.cwd` to this path so the Claude SDK runs in that directory
3. **CLI runtime** -- `CLIRuntime.execute()` reads `agent.working_directory` and passes it as `cwd` to the `claude` process
4. **Session validation** -- When resuming a session, the stored `working_directory` is compared against the current one; if they differ, the session is invalidated
5. **Hooks** -- Hook executors receive the workspace path as their `cwd`

The relevant helper is at `/home/dev/projects/herdctl/packages/core/src/fleet-manager/working-directory-helper.ts`.

### The Problem

With static working directories, **all jobs for an agent work in the same directory**. This means:

- Parallel agents would conflict on the same files
- Each job's git changes pollute the next job's environment
- There's no branch isolation between work items
- An agent processing GitHub issue #42 and then issue #43 would see leftover changes from #42

---

## What "Strategy" Means in This Context

### Does herdctl Have a Strategy Pattern?

**No.** There is no formal strategy pattern, plugin system, or lifecycle hook system in the job executor today.

However, herdctl does have **two analogous patterns** that inform how a strategy could be built:

#### 1. Runtime Abstraction (Decorator Pattern)

The `RuntimeInterface` and `ContainerRunner` demonstrate a decorator/wrapper approach:

```typescript
// interface.ts
interface RuntimeInterface {
  execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage>;
}

// factory.ts -- RuntimeFactory wraps a base runtime with Docker if needed
let runtime: RuntimeInterface = new SDKRuntime(); // or CLIRuntime
if (agent.docker?.enabled) {
  runtime = new ContainerRunner(runtime, dockerConfig, stateDir);
}
```

`ContainerRunner` is a **decorator** -- it wraps another runtime and adds Docker container lifecycle around it (create container before, clean up after). This is exactly the pattern a worktree strategy would follow.

#### 2. Post-Job Hooks (After-Run Lifecycle)

The hooks system (`/home/dev/projects/herdctl/packages/core/src/hooks/`) provides **after_run** and **on_error** lifecycle callbacks. But there is no **before_run** hook today. Hooks are executed by `ScheduleExecutor` and `JobControl` after the `JobExecutor.execute()` call completes.

### What "Strategy" Would Mean

In this context, "strategy" means: **a configurable workspace lifecycle behavior that wraps job execution with setup and teardown steps.** The two envisioned strategies are:

| Strategy | Before Job | During Job | After Job |
|----------|-----------|------------|-----------|
| `static` (current default) | Nothing | Agent works in `working_directory` as-is | Nothing |
| `git_worktree` | Create worktree + branch | Agent works in worktree dir | Commit, push, PR, clean up worktree |

The strategy would be selected via agent configuration and would wrap the `JobExecutor.execute()` call with pre-job and post-job steps.

---

## Git Worktree Primer

### What is `git worktree`?

Git worktree lets you check out multiple branches simultaneously from a single repository clone. Each worktree is an independent working directory with its own checked-out branch, but they all share the same `.git` object store.

```bash
# Create a worktree at .worktrees/fix-auth on branch fix-auth
git worktree add .worktrees/fix-auth -b fix-auth

# List worktrees
git worktree list
# /repo                   abc1234 [main]
# /repo/.worktrees/fix-auth  def5678 [fix-auth]

# Remove when done
git worktree remove .worktrees/fix-auth
```

### Why Worktrees (Not Clones)?

| Aspect | Worktree | Fresh Clone |
|--------|----------|-------------|
| Speed | Near-instant creation | Minutes for large repos |
| Disk space | Minimal (shares objects) | Full duplicate |
| Git state | Shared (commits, remotes, config) | Independent |
| Network | No fetch needed | Requires network |
| Limitation | Cannot check out same branch in two worktrees | None |

For autonomous agents running many short-lived jobs against the same repo, worktrees are significantly faster and cheaper than clones.

### Key Constraints

1. **Branch uniqueness**: You cannot have the same branch checked out in two worktrees simultaneously. Each worktree must have a unique branch.
2. **Base repo must exist**: Worktrees are created relative to an existing clone.
3. **Cleanup is important**: Leftover worktree entries can cause confusion. Always `git worktree remove` or `git worktree prune`.

---

## How a Git Worktree Strategy Would Work

### Lifecycle Overview

```
Job Trigger (schedule, manual, chat)
  |
  v
[WorkspaceStrategy.setup()]  <-- NEW: Pre-job workspace setup
  |-- git fetch origin
  |-- git worktree add .worktrees/<job-id> -b <branch-name> origin/<base-branch>
  |-- Override agent.working_directory to point to worktree path
  |
  v
JobExecutor.execute(modifiedOptions)  <-- Agent works in worktree
  |
  v
[WorkspaceStrategy.teardown()]  <-- NEW: Post-job cleanup
  |-- git add -A && git commit  (in worktree)
  |-- git push origin <branch-name>
  |-- gh pr create (optional)
  |-- git worktree remove .worktrees/<job-id>
  |-- git branch -D <branch-name>  (if merged or on failure)
```

### Phase 1: Pre-Job Setup

```typescript
async setup(agent: ResolvedAgent, jobContext: JobContext): Promise<WorkspaceSetupResult> {
  const repoRoot = resolveWorkingDirectory(agent); // e.g., /home/dev/myrepo
  const branchName = this.buildBranchName(jobContext);  // e.g., "agent/coder/lin-123"
  const worktreePath = join(repoRoot, ".worktrees", jobContext.jobId);

  // 1. Fetch latest from remote
  await exec("git", ["fetch", "origin"], { cwd: repoRoot });

  // 2. Create worktree with a new branch based on origin/main
  const baseBranch = agent.working_directory?.default_branch ?? "main";
  await exec("git", [
    "worktree", "add",
    worktreePath,
    "-b", branchName,
    `origin/${baseBranch}`
  ], { cwd: repoRoot });

  return {
    workingDirectory: worktreePath,
    branchName,
    baseBranch,
  };
}
```

### Phase 2: During Job

The agent's `working_directory` is dynamically overridden to point to the worktree path. The `JobExecutor` and runtime receive this modified path transparently -- they don't need to know about worktrees at all.

```typescript
// The strategy modifies the agent config before passing to JobExecutor:
const modifiedAgent = {
  ...agent,
  working_directory: setupResult.workingDirectory,
};

const result = await executor.execute({
  agent: modifiedAgent,
  prompt,
  stateDir,
  // ... rest of options
});
```

### Phase 3: Post-Job Teardown

```typescript
async teardown(
  setupResult: WorkspaceSetupResult,
  jobResult: RunnerResult,
  options: TeardownOptions
): Promise<WorkspaceTeardownResult> {
  const { workingDirectory, branchName } = setupResult;
  const repoRoot = options.repoRoot;

  try {
    if (jobResult.success) {
      // 1. Stage and commit any remaining changes
      await exec("git", ["add", "-A"], { cwd: workingDirectory });
      const hasChanges = await hasUncommittedChanges(workingDirectory);
      if (hasChanges) {
        await exec("git", ["commit", "-m", `agent: ${jobResult.summary ?? "completed work"}`], {
          cwd: workingDirectory
        });
      }

      // 2. Push branch
      await exec("git", ["push", "-u", "origin", branchName], { cwd: workingDirectory });

      // 3. Create PR (optional, configurable)
      if (options.createPR) {
        await exec("gh", ["pr", "create",
          "--title", options.prTitle ?? `[Agent] ${branchName}`,
          "--body", jobResult.summary ?? "Automated agent work",
          "--base", setupResult.baseBranch,
        ], { cwd: workingDirectory });
      }
    }
    // If job failed, optionally clean up or leave branch for debugging

  } finally {
    // 4. Always clean up the worktree
    await exec("git", ["worktree", "remove", workingDirectory, "--force"], { cwd: repoRoot });
  }

  return { cleaned: true, branchName, pushed: jobResult.success };
}
```

---

## Integration with Session Management

### The Session Problem

Today, sessions are tied to agents and their working directories:

```typescript
// From job-executor.ts (Step 3.5):
const wdValidation = validateWorkingDirectory(existingSession, currentWorkingDirectory);
if (!wdValidation.valid) {
  // Session invalidated because working directory changed
  await clearSession(sessionsDir, agent.name);
}
```

With worktrees, every job gets a **different** working directory. This means:

1. **Sessions cannot be reused across worktree jobs** -- each worktree is a new directory, so the session validation would always fail.
2. **This is actually correct behavior** -- each work item (issue, task) should have its own conversation context, not carry over context from a different issue.

### Proposed Session Behavior

| Scenario | Session Behavior |
|----------|-----------------|
| Same work item, multiple jobs | Resume session (same worktree, same branch) |
| Different work items | Fresh session (different worktree, different branch) |
| Worktree re-created for retry | Fresh session (worktree path changed) |

For work items that span multiple jobs (e.g., an issue that requires follow-up), the session could be keyed by the **work item ID** rather than the agent name:

```typescript
// Instead of:
const session = await getSessionInfo(sessionsDir, agent.name);

// The worktree strategy would use:
const sessionKey = workItemId ? `${agent.name}:${workItemId}` : agent.name;
const session = await getSessionInfo(sessionsDir, sessionKey);
```

---

## Code Structure Proposal

### Option A: Decorator Pattern (Recommended)

Like `ContainerRunner` wraps a `RuntimeInterface`, a workspace strategy would wrap the execution orchestration. This is the most natural fit given herdctl's existing patterns.

```
packages/core/src/
  workspace/                          <-- NEW module
    index.ts                          # Public exports
    types.ts                          # WorkspaceStrategy interface, config types
    static-strategy.ts                # No-op strategy (current behavior)
    worktree-strategy.ts              # Git worktree lifecycle
    strategy-factory.ts               # Creates strategy from config
    __tests__/
      worktree-strategy.test.ts
      strategy-factory.test.ts
```

#### Interface Definition

```typescript
// workspace/types.ts

/**
 * Context about the job being set up
 */
interface WorkspaceJobContext {
  jobId: string;
  agentName: string;
  workItemId?: string;       // e.g., GitHub issue number, Linear issue ID
  workItemTitle?: string;
  prompt: string;
}

/**
 * Result of workspace setup
 */
interface WorkspaceSetupResult {
  /** The working directory the agent should use */
  workingDirectory: string;
  /** Branch name created (for worktree strategy) */
  branchName?: string;
  /** Base branch the work branch was created from */
  baseBranch?: string;
  /** Session key override (for per-work-item sessions) */
  sessionKey?: string;
}

/**
 * Result of workspace teardown
 */
interface WorkspaceTeardownResult {
  /** Whether cleanup was successful */
  cleaned: boolean;
  /** Whether changes were pushed */
  pushed?: boolean;
  /** PR URL if one was created */
  prUrl?: string;
  /** Branch name that was cleaned up */
  branchName?: string;
}

/**
 * Strategy interface for workspace lifecycle management
 */
interface WorkspaceStrategy {
  /** Called before job execution to set up the workspace */
  setup(agent: ResolvedAgent, context: WorkspaceJobContext): Promise<WorkspaceSetupResult>;

  /** Called after job execution to tear down the workspace */
  teardown(
    agent: ResolvedAgent,
    setupResult: WorkspaceSetupResult,
    jobResult: RunnerResult,
  ): Promise<WorkspaceTeardownResult>;
}
```

#### Static Strategy (Current Behavior)

```typescript
// workspace/static-strategy.ts

class StaticWorkspaceStrategy implements WorkspaceStrategy {
  async setup(agent: ResolvedAgent): Promise<WorkspaceSetupResult> {
    return {
      workingDirectory: resolveWorkingDirectory(agent) ?? process.cwd(),
    };
  }

  async teardown(): Promise<WorkspaceTeardownResult> {
    return { cleaned: true };
  }
}
```

#### Worktree Strategy

```typescript
// workspace/worktree-strategy.ts

interface WorktreeStrategyConfig {
  /** Base branch to create worktree from (default: "main") */
  baseBranch?: string;
  /** Directory relative to repo root for worktrees (default: ".worktrees") */
  worktreeDir?: string;
  /** Branch naming pattern. Supports {agent}, {workItem}, {jobId} placeholders */
  branchPattern?: string;   // default: "agent/{agent}/{workItem}"
  /** Whether to auto-create PRs on success (default: false) */
  createPR?: boolean;
  /** Whether to push on success (default: true) */
  pushOnSuccess?: boolean;
  /** Whether to clean up worktree on failure (default: true) */
  cleanupOnFailure?: boolean;
  /** Whether to fetch before creating worktree (default: true) */
  fetchBeforeSetup?: boolean;
}
```

### Option B: Middleware/Pipeline Pattern

An alternative is a middleware chain where each middleware can add pre/post behavior:

```typescript
type JobMiddleware = (
  next: (options: RunnerOptionsWithCallbacks) => Promise<RunnerResult>,
  options: RunnerOptionsWithCallbacks,
) => Promise<RunnerResult>;

// Usage:
const worktreeMiddleware: JobMiddleware = async (next, options) => {
  const worktree = await createWorktree(options);
  try {
    const result = await next({ ...options, agent: { ...options.agent, working_directory: worktree.path } });
    await pushAndCreatePR(worktree, result);
    return result;
  } finally {
    await cleanupWorktree(worktree);
  }
};
```

This is more flexible but adds complexity. Given herdctl's pre-MVP status, the simpler decorator/strategy pattern (Option A) is recommended.

### Where the Strategy Would Be Called

The strategy wraps the `JobExecutor.execute()` call. The integration points are:

1. **`ScheduleExecutor.executeSchedule()`** -- for scheduled jobs
2. **`JobControl.trigger()`** -- for manually triggered jobs
3. **`ScheduleRunner.runSchedule()`** -- for work-source-driven jobs

Rather than modifying all three, the strategy could be integrated at the `JobExecutor` level itself:

```typescript
// Modified JobExecutor constructor
class JobExecutor {
  constructor(
    private runtime: RuntimeInterface,
    private options: JobExecutorOptions = {},
    private workspaceStrategy?: WorkspaceStrategy,  // <-- NEW
  ) {}

  async execute(options: RunnerOptionsWithCallbacks): Promise<RunnerResult> {
    // Pre-job: set up workspace
    let setupResult: WorkspaceSetupResult | undefined;
    if (this.workspaceStrategy) {
      setupResult = await this.workspaceStrategy.setup(options.agent, {
        jobId: "pending", // Real ID assigned in step 1
        agentName: options.agent.name,
        prompt: options.prompt,
      });
      // Override working directory
      options = {
        ...options,
        agent: { ...options.agent, working_directory: setupResult.workingDirectory },
      };
    }

    // ... existing execute logic ...

    // Post-job: tear down workspace
    if (this.workspaceStrategy && setupResult) {
      await this.workspaceStrategy.teardown(options.agent, setupResult, result);
    }

    return result;
  }
}
```

Alternatively, it could live in `RuntimeFactory.create()` as another decorator layer:

```typescript
// factory.ts
static create(agent: ResolvedAgent, options: RuntimeFactoryOptions = {}): RuntimeInterface {
  let runtime: RuntimeInterface = new SDKRuntime(); // or CLIRuntime

  if (agent.docker?.enabled) {
    runtime = new ContainerRunner(runtime, dockerConfig, stateDir);
  }

  // Future: workspace strategy could also wrap as a decorator
  // But strategies need pre/post lifecycle, not just runtime wrapping
  return runtime;
}
```

The `JobExecutor` integration is cleaner because the strategy needs access to job-level context (job ID, work item info, job result) that the runtime layer doesn't have.

---

## Configuration Schema

### Agent-Level Configuration

```yaml
# herdctl-agent.yml
name: coder
working_directory:
  root: /home/dev/myrepo
  default_branch: main

# NEW: workspace strategy configuration
workspace:
  strategy: git_worktree          # "static" (default) or "git_worktree"
  worktree_dir: .worktrees        # relative to working_directory.root
  branch_pattern: "agent/{agent}/{workItem}"  # {agent}, {workItem}, {jobId} available
  fetch_before_setup: true
  push_on_success: true
  create_pr: true
  cleanup_on_failure: true

schedules:
  process-issues:
    type: interval
    interval: "5m"
    work_source:
      type: github
      repo: myorg/myrepo
```

### Zod Schema Addition

```typescript
// In config/schema.ts

export const WorkspaceStrategySchema = z.enum(["static", "git_worktree"]);

export const WorkspaceConfigSchema = z.object({
  /** Workspace lifecycle strategy */
  strategy: WorkspaceStrategySchema.optional().default("static"),
  /** Directory for worktrees relative to working_directory.root */
  worktree_dir: z.string().optional().default(".worktrees"),
  /** Branch naming pattern with {agent}, {workItem}, {jobId} placeholders */
  branch_pattern: z.string().optional().default("agent/{agent}/{workItem}"),
  /** Whether to git fetch before creating worktree */
  fetch_before_setup: z.boolean().optional().default(true),
  /** Whether to push branch on job success */
  push_on_success: z.boolean().optional().default(true),
  /** Whether to create a PR on job success */
  create_pr: z.boolean().optional().default(false),
  /** Whether to clean up worktree on job failure */
  cleanup_on_failure: z.boolean().optional().default(true),
  /** Custom commit message pattern. {summary} placeholder available */
  commit_message: z.string().optional().default("agent: {summary}"),
});

// Add to AgentConfigSchema:
export const AgentConfigSchema = z.object({
  // ... existing fields ...
  workspace: WorkspaceConfigSchema.optional(),
});
```

---

## Open Questions and Design Decisions

### 1. Where Does the Strategy Live in the Call Chain?

**Option A: Inside `JobExecutor`** (recommended for simplicity)
- Strategy is a constructor dependency of `JobExecutor`
- `execute()` calls `strategy.setup()` before and `strategy.teardown()` after
- Pros: Clean encapsulation, single integration point
- Cons: `JobExecutor` gains another responsibility

**Option B: In the callers (`ScheduleExecutor`, `JobControl`)**
- Each caller wraps its own `executor.execute()` call with strategy setup/teardown
- Pros: `JobExecutor` stays focused on execution
- Cons: Duplicated logic in 3+ places

**Option C: New `WorkspaceAwareExecutor` decorator**
- Wraps `JobExecutor` and adds strategy lifecycle
- Pros: Most composable, follows ContainerRunner pattern
- Cons: Another layer of indirection

### 2. Branch Naming When No Work Item Exists

If there's no work item (e.g., a simple scheduled task), what should the branch be named?
- `agent/{agentName}/{jobId}` -- unique but not meaningful
- `agent/{agentName}/{scheduleName}/{timestamp}` -- more descriptive
- Configurable via `branch_pattern`

### 3. What Happens When `git push` Fails?

Options:
- **Fail the job** -- the work was done but can't be shipped
- **Log warning and continue** -- the branch is local, operator can push manually
- **Retry** -- transient network errors
- Configurable: `on_push_failure: "fail" | "warn" | "retry"`

### 4. PR Creation Details

- Should the strategy create PRs automatically, or just push branches?
- What tool: `gh pr create`, `git push -o merge_request.create` (GitLab), or API calls?
- Should PRs be auto-merged when CI passes?
- This is probably best handled as a post-job hook rather than baked into the strategy.

### 5. Interaction with Docker Containers

When Docker is enabled, the worktree needs to be mounted into the container. The current `ContainerRunner` mounts `working_directory.root` as `/workspace`. If the worktree is a subdirectory of `root`, it would already be mounted. If it's elsewhere, additional mount configuration is needed.

### 6. Concurrent Agents and Branch Conflicts

Git worktrees enforce that each branch can only be checked out in one worktree at a time. If two agents try to work on the same work item simultaneously, the second `git worktree add` will fail. This is actually a desirable constraint -- it prevents duplicate work. The strategy should catch this error and either:
- Skip the work item (let another agent handle it)
- Queue the job for later

### 7. Stale Worktree Cleanup

What if the process crashes mid-job and worktrees are left behind? A startup cleanup routine should:
1. Run `git worktree prune` to clean orphaned worktree entries
2. Optionally remove old worktree directories that weren't cleaned up
3. This could be a `FleetManager.initialize()` step

---

## Summary

| Question | Answer |
|----------|--------|
| Does herdctl have a "strategy" pattern? | **No.** This is a proposed new pattern. |
| Are there existing strategies? | **No.** The current behavior is equivalent to an implicit "static" strategy. |
| Closest existing pattern? | `ContainerRunner` decorator and the hooks system |
| What would a worktree strategy do? | Create isolated worktree + branch before each job, clean up after |
| Where would it integrate? | Wrap `JobExecutor.execute()`, either inside the class or as a decorator |
| Config location? | New `workspace` field on `AgentConfigSchema` |
| Key dependency? | `working_directory.root` must point to a git repository |
| Session interaction? | Worktree jobs get fresh sessions (different cwd invalidates old session) |

---

## Addendum: Follow-Up Research (2026-02-16)

The following sections address specific concerns raised during review of this document and the related context handoff research (007).

---

## A1. Worktree + Context Handoff Interaction

### The Problem

The "007: Automatic Context Window Handoff Research" proposes that when an agent's context window fills up (90%+ usage), herdctl should:

1. Ask the agent to produce a handoff document
2. Start a **new session** with the handoff document as the initial prompt
3. Replace the `sessionId` in `JobExecutor.execute()` mid-flight

If the agent is using the worktree strategy, the context handoff creates a new **session** but NOT a new **job**. The risk is that the worktree lifecycle, which is tied to job boundaries, could misinterpret the new session as a new job and attempt to create a second worktree.

### Analysis of the Codebase

Looking at `JobExecutor.execute()` in `packages/core/src/runner/job-executor.ts`:

- The **job** is created once at line 161 (`createJob()`) and its ID never changes throughout execution.
- The **session ID** is a `let` binding (line 148) that gets updated from SDK `system.init` messages (line 414).
- The proposed context handoff (007, Step 5) restructures the message loop into a `while` loop that can restart with a new `AsyncIterable<SDKMessage>`, but the job ID remains constant.

The worktree strategy, as proposed in this document, wraps `JobExecutor.execute()` at the **job level** (see "Code Structure Proposal" and "Where the Strategy Would Be Called"):

```
WorkspaceStrategy.setup()     <-- runs ONCE, before execute()
  JobExecutor.execute()        <-- may have N sessions (handoffs) inside
WorkspaceStrategy.teardown()   <-- runs ONCE, after execute()
```

### Why This Is Safe

The worktree lifecycle is bound to the **job**, not the **session**. Here is why the handoff does not cause problems:

1. **Worktree creation happens before `execute()`**: The strategy's `setup()` runs before `JobExecutor.execute()` is called. By the time any context handoff occurs, the worktree already exists and the agent is working inside it.

2. **Session replacement does not change `working_directory`**: The handoff (007, Section 5: "What Stays the Same") explicitly preserves the working directory. The new session is started with the **same** `agent` configuration, which has already been modified by the strategy to point at the worktree path.

3. **Worktree teardown happens after `execute()` returns**: The strategy's `teardown()` runs after the entire `execute()` call completes, regardless of how many sessions occurred inside it.

4. **The new session is not a new trigger**: Nothing in the proposed handoff mechanism calls `FleetManager.trigger()`, `ScheduleExecutor.executeSchedule()`, or `runSchedule()`. The new session is created entirely within the inner `executeWithRetry()` / while-loop of `JobExecutor.execute()`. No external component sees a "new job" event.

### The One Caveat: Session Persistence After Handoff

After a handoff, the session ID changes (from session A to session B). At the end of `execute()`, Step 6 persists the **final** session ID to `.herdctl/sessions/<agent>.json`. This persisted session stores the `working_directory` that was active during the job.

With worktrees, the working directory is a worktree path like `/repo/.worktrees/job-abc123`. After the job completes and teardown removes the worktree, the persisted session has a `working_directory` that no longer exists. On the next job:

- A new worktree with a **different** path will be created.
- The old session's `working_directory` will not match.
- The `validateWorkingDirectory()` check (job-executor.ts line 233) will invalidate the session.
- A fresh session will start.

**This is the correct behavior.** Each worktree job should get a fresh session because it works on a different branch/task. No changes are needed.

### Recommendation

No special coordination is needed between the worktree strategy and context handoff. The existing design is sound because:

- Worktree lifecycle is per-job (outside `execute()`)
- Session lifecycle is per-session (inside `execute()`)
- These two lifecycles are properly nested and do not interfere

However, the worktree strategy should document this invariant explicitly:

```typescript
/**
 * IMPORTANT: The worktree lifecycle is bound to the JOB, not the SESSION.
 * A single job may span multiple sessions (due to context handoff).
 * The worktree must remain stable across all sessions within a job.
 * setup() is called once before execute(), teardown() once after.
 */
```

---

## A2. Naming and Branching

### When Worktrees Are Created

The strategy is set per-agent in the configuration. Every new **job** (not session) triggers worktree creation. A single agent may process many jobs over time, each getting its own worktree and branch:

```
Agent "coder" (strategy: git_worktree)
  |
  +-- Job 1: worktree at .worktrees/job-001, branch agent/coder/lin-42
  +-- Job 2: worktree at .worktrees/job-002, branch agent/coder/lin-43
  +-- Job 3: worktree at .worktrees/job-003, branch agent/coder/daily-check-20260216
```

### Branch Naming Conventions

Branches created by the worktree strategy should follow git naming conventions and be identifiable as agent-created. Proposed naming scheme:

| Scenario | Pattern | Example |
|----------|---------|---------|
| Work item from Linear | `agent/{agentName}/{workItemId}` | `agent/coder/lin-42` |
| Work item from GitHub | `agent/{agentName}/{workItemId}` | `agent/coder/gh-issue-17` |
| No work item (scheduled) | `agent/{agentName}/{scheduleName}/{date}` | `agent/coder/daily-check/2026-02-16` |
| No work item (manual) | `agent/{agentName}/job-{jobId-short}` | `agent/coder/job-a1b2c3` |

The `branch_pattern` configuration field already supports `{agent}`, `{workItem}`, and `{jobId}` placeholders. We should add `{date}` and `{scheduleName}`:

```yaml
workspace:
  strategy: git_worktree
  branch_pattern: "agent/{agent}/{workItem}"  # Default
```

### Can the Branch Be Renamed by the Agent?

**Yes, but it requires careful handling.** There are two approaches:

**Approach A: Temporary Name, Agent Renames (Not Recommended)**

The worktree is created with a temporary branch name (e.g., `agent/coder/pending-a1b2c3`), and the agent is instructed (via prompt or CLAUDE.md) to rename the branch to something meaningful.

Problems:
- Git does not support renaming a branch that is currently checked out in a worktree. The agent would need to run `git branch -m <old> <new>`, which works for the current branch but the worktree metadata would need updating.
- The strategy's `teardown()` needs to know the branch name for pushing and PR creation. If the agent renamed it, the strategy must discover the current branch name via `git branch --show-current`.
- Race conditions: the agent might be mid-rename when teardown starts.

**Approach B: Set Branch Name Up Front from Work Item (Recommended)**

The branch name is determined at `setup()` time using the available context (work item ID, schedule name, job ID). The agent does not rename it.

For work-source-driven jobs, the work item ID and title are available at job creation time (see `schedule-runner.ts` lines 278-303 where `workSourceManager.getNextWorkItem()` is called before `executor.execute()`). This means the strategy has all the information it needs to create a meaningful branch name.

For chat-driven jobs (Slack/Discord), there is no work item. The branch could use the job ID or a timestamp.

**Recommendation: Approach B.** The strategy should resolve the branch name at setup time. If a better name is needed, it can be configured via `branch_pattern` in the agent config.

### Worktree Path vs. Branch Name

The **worktree directory name** and **branch name** do not need to match. The worktree path should use the job ID (guaranteed unique), while the branch name should be human-readable:

```
Worktree path:  /repo/.worktrees/job-a1b2c3d4       (uses jobId, always unique)
Branch name:    agent/coder/lin-42                    (uses work item, human-readable)
```

This avoids path-length issues from long branch names and ensures uniqueness even if two jobs process the same work item (retry scenario -- though the branch uniqueness constraint would prevent this, which is intentional).

### Environment Variables Per Worktree

See section A4 below for detailed env var discussion.

---

## A3. Cleanup of Orphaned Worktrees

### The Problem

Worktrees will accumulate in several scenarios:

1. **Crash during execution**: The process dies mid-job, teardown never runs, worktree and branch remain.
2. **No-op jobs**: The agent runs, checks for work, finds nothing to do, and exits. The worktree was created but has no meaningful changes. Teardown runs, but if `cleanup_on_failure` is false or the agent "succeeded" without changes, the worktree might be left behind depending on configuration.
3. **Failed pushes**: The job completed, but `git push` failed. The worktree is removed locally but the branch remains.
4. **Debugging retention**: When `cleanup_on_failure` is false, failed job worktrees are intentionally kept for debugging.

### Existing Cleanup Patterns in the Codebase

After researching the codebase, here is what exists today:

**1. Session cleanup in Slack/Discord connectors**

Both the Slack and Discord session managers have a `cleanupExpiredSessions()` method (see `packages/slack/src/session-manager/session-manager.ts` lines 235-259). This method:
- Iterates all stored sessions
- Checks if each session's `lastMessageAt` exceeds `sessionExpiryHours`
- Deletes expired entries from the YAML state file

However, `cleanupExpiredSessions()` is **never called on a schedule**. It exists as a method but is only available for manual invocation. There is no periodic cleanup timer.

**2. Session expiry in core state**

The core `getSessionInfo()` function (`packages/core/src/state/session.ts` lines 106-172) validates session expiry when a `timeout` option is provided. Expired sessions are cleared at read time (lazy cleanup). But there is no background process that proactively cleans up old sessions.

**3. FleetManager initialization**

`FleetManager.initialize()` (`packages/core/src/fleet-manager/fleet-manager.ts` lines 161-203) initializes the state directory, scheduler, and connectors. It does **not** perform any cleanup of stale data. There is no startup maintenance step.

**4. FleetManager shutdown**

`FleetManager.stop()` persists shutdown state and stops connectors. It does **not** clean up any orphaned resources.

**5. Scheduler**

The scheduler (`packages/core/src/scheduler/scheduler.ts`) manages schedule triggers but has no concept of maintenance tasks or periodic cleanup.

### Summary: No Existing Cleanup Infrastructure

There is no background cleanup process, no startup cleanup step, and no periodic maintenance scheduler in herdctl today. The only cleanup is lazy (at read time for sessions).

### Proposed: WorktreeCleanupService

A new service should handle worktree cleanup. It needs two modes:

**Mode 1: Startup Cleanup (in `FleetManager.initialize()`)**

Run once at startup to clean up orphans from crashes:

```typescript
class WorktreeCleanupService {
  /**
   * Run during FleetManager.initialize() to clean up orphaned worktrees
   * from previous crashes.
   */
  async cleanupOrphans(repoRoot: string): Promise<CleanupResult> {
    // 1. Run `git worktree prune` to remove stale worktree entries
    //    (entries whose directories were deleted but git metadata remains)
    await exec("git", ["worktree", "prune"], { cwd: repoRoot });

    // 2. List remaining worktrees
    const worktrees = await this.listWorktrees(repoRoot);

    // 3. Cross-reference with active jobs in .herdctl/jobs/
    //    If a worktree's job ID maps to a completed/failed job, clean it up
    const orphans = await this.findOrphans(worktrees, jobsDir);

    // 4. Remove orphaned worktrees and their branches
    for (const orphan of orphans) {
      await exec("git", ["worktree", "remove", orphan.path, "--force"],
                 { cwd: repoRoot });
      // Optionally delete the branch too (if not pushed/merged)
    }

    return { pruned: orphans.length };
  }
}
```

**Mode 2: Periodic Cleanup (via interval timer or schedule)**

For long-running fleet managers, periodic cleanup handles:
- Worktrees from no-op jobs that accumulated over time
- Branches that were not cleaned up due to configuration (`cleanup_on_failure: false`) but are now old enough to discard
- Expired debug worktrees

This could be implemented as:

```typescript
class WorktreeCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Start periodic cleanup (e.g., every 6 hours)
   */
  startPeriodicCleanup(intervalMs: number = 6 * 60 * 60 * 1000): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOrphans(repoRoot).catch(logger.error);
    }, intervalMs);
  }

  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
```

### Should Sessions and Worktrees Be Cleaned Up Together?

**Yes, but independently.** A unified `MaintenanceService` could coordinate cleanup of multiple resource types during startup and periodically:

```typescript
class MaintenanceService {
  async runStartupMaintenance(): Promise<void> {
    // Clean up orphaned worktrees
    await this.worktreeCleanup.cleanupOrphans(repoRoot);

    // Clean up expired Slack/Discord sessions
    for (const [agentName, sessionManager] of sessionManagers) {
      await sessionManager.cleanupExpiredSessions();
    }

    // Clean up expired core sessions
    await this.cleanupExpiredCoreSessions(sessionsDir);

    // Prune old job records (if desired)
    // await this.pruneOldJobs(jobsDir, maxAge);
  }
}
```

This would be called from `FleetManager.initialize()`:

```typescript
async initialize(): Promise<void> {
  // ... existing initialization ...

  // NEW: Run startup maintenance
  const maintenance = new MaintenanceService(this);
  await maintenance.runStartupMaintenance();
  maintenance.startPeriodicCleanup();

  // ... rest of initialization ...
}
```

### Configuration

```yaml
# Fleet-level or agent-level config
maintenance:
  worktree_cleanup:
    enabled: true
    interval: "6h"               # How often to run periodic cleanup
    max_worktree_age: "7d"       # Remove worktrees older than this
    cleanup_on_startup: true     # Run cleanup during initialize()
    prune_unmerged_branches: false  # Whether to delete branches that were never merged
  session_cleanup:
    enabled: true
    interval: "1h"
```

### Integration Point

The `WorktreeCleanupService` should be registered in the proposed `workspace/` module alongside the strategy implementations:

```
packages/core/src/
  workspace/
    index.ts
    types.ts
    static-strategy.ts
    worktree-strategy.ts
    worktree-cleanup.ts          <-- NEW
    strategy-factory.ts
    __tests__/
```

---

## A4. Per-Worktree Environment Variables

### Use Case

When an agent runs inside a worktree, it may need to know:

- **Where it is**: The worktree path (different from the repo root)
- **What branch it is on**: The branch name created by the strategy
- **What it is working on**: The work item ID, if any
- **Whether it is in a worktree**: To adjust its behavior (e.g., not modifying `.git/config`)

These values should be available as environment variables so the agent (and any tools it uses, such as MCP servers or shell hooks) can reference them.

### Proposed Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `HERDCTL_WORKTREE_PATH` | Absolute path to the worktree directory | `/repo/.worktrees/job-a1b2c3` |
| `HERDCTL_WORKTREE_BRANCH` | Name of the branch created for this worktree | `agent/coder/lin-42` |
| `HERDCTL_WORKTREE_BASE_BRANCH` | Base branch the worktree was created from | `main` |
| `HERDCTL_WORK_ITEM_ID` | External work item ID (if applicable) | `LIN-42` or `gh-issue-17` |
| `HERDCTL_WORK_ITEM_TITLE` | Work item title (if applicable) | `Fix auth bug` |
| `HERDCTL_REPO_ROOT` | Original repository root (parent of worktrees) | `/repo` |
| `HERDCTL_WORKSPACE_STRATEGY` | The active workspace strategy | `git_worktree` |

### How Environment Variables Are Injected Today

Looking at the runtime implementations:

**SDK Runtime** (`packages/core/src/runner/runtime/sdk-runtime.ts`):
- The SDK's `query()` function accepts options via `toSDKOptions()`, which includes `cwd`, `systemPrompt`, `mcpServers`, etc.
- The SDK does **not** currently have an `env` option for passing environment variables to the agent process. The SDK runs in the same process, so `process.env` mutations would affect it.
- MCP servers launched by the SDK DO receive `env` (via `McpServerSchema.env`).

**CLI Runtime** (`packages/core/src/runner/runtime/cli-runtime.ts`):
- The `execa("claude", args, { cwd, ... })` call could accept an `env` option.
- Currently, no custom env is passed -- the subprocess inherits `process.env`.

**Container Runner** (`packages/core/src/runner/runtime/container-runner.ts`):
- Uses `buildContainerEnv()` to construct environment variables for the Docker container.
- The Docker config has an `env` field (`FleetDockerSchema.env`) for container-level env vars.
- The container runner already has the pattern for injecting env vars.

### How to Inject Worktree Env Vars

The worktree strategy should inject env vars at the point where it modifies the agent configuration:

```typescript
// In WorktreeStrategy.setup():
async setup(agent: ResolvedAgent, context: WorkspaceJobContext): Promise<WorkspaceSetupResult> {
  // ... create worktree ...

  return {
    workingDirectory: worktreePath,
    branchName,
    baseBranch,
    // NEW: Environment variables for the agent
    environmentVariables: {
      HERDCTL_WORKTREE_PATH: worktreePath,
      HERDCTL_WORKTREE_BRANCH: branchName,
      HERDCTL_WORKTREE_BASE_BRANCH: baseBranch,
      HERDCTL_WORK_ITEM_ID: context.workItemId ?? "",
      HERDCTL_WORK_ITEM_TITLE: context.workItemTitle ?? "",
      HERDCTL_REPO_ROOT: repoRoot,
      HERDCTL_WORKSPACE_STRATEGY: "git_worktree",
    },
  };
}
```

The caller (the entity wrapping `JobExecutor.execute()`) would then apply these env vars. The injection method depends on the runtime:

**For SDK Runtime**: Set `process.env` before calling `execute()` and restore after. This is a blunt approach but works since the SDK runs in-process. A cleaner approach is to include them in the agent's system prompt or as MCP server env vars.

**For CLI Runtime**: Pass them via the `execa` options:

```typescript
// Modify CLIRuntime or its process spawner to accept env overrides:
execa("claude", args, {
  cwd: worktreePath,
  env: {
    ...process.env,
    ...setupResult.environmentVariables,  // Worktree-specific env vars
  },
});
```

**For Container Runner**: Add them to the Docker container's environment via `buildContainerEnv()`.

### Recommended Implementation Path

The cleanest integration point is to extend `RuntimeExecuteOptions` with an optional `env` field:

```typescript
// In packages/core/src/runner/runtime/interface.ts
export interface RuntimeExecuteOptions {
  prompt: string;
  agent: ResolvedAgent;
  resume?: string;
  fork?: boolean;
  abortController?: AbortController;
  /** Additional environment variables to inject into the runtime */
  env?: Record<string, string>;   // <-- NEW
}
```

Each runtime would then merge these env vars into its execution context:

- **SDKRuntime**: Set on `process.env` (or pass to MCP server configs)
- **CLIRuntime**: Merge into the `execa` env option
- **ContainerRunner**: Merge into the Docker container env

The worktree strategy would populate `RuntimeExecuteOptions.env` with the worktree-specific variables. This keeps the env var injection generic and reusable for other strategies or features.

### Making Env Vars Available in System Prompt

In addition to process-level env vars, the worktree context should be available in the agent's system prompt. The strategy could append a section to the system prompt:

```typescript
const worktreeContext = `
## Workspace Context

You are working in a git worktree. Key information:
- **Worktree Path**: ${worktreePath}
- **Branch**: ${branchName} (based on ${baseBranch})
- **Work Item**: ${context.workItemId ?? "none"}

All changes should be made within this worktree. Do not modify the main repository directly.
`;

// Append to agent's system prompt
modifiedAgent.system_prompt = (agent.system_prompt ?? "") + "\n\n" + worktreeContext;
```

This ensures the agent has full awareness of its workspace context regardless of whether env vars are accessible to the LLM.
