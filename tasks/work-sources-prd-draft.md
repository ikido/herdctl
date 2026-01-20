# Context for PRD Creation: herdctl-work-sources (GitHub First)

I'm building **herdctl** - an autonomous agent fleet management system for Claude Code.

## Required Reading

1. **SPEC.md** - "Work Source" concept, architecture diagram
2. **plan.md** - PRD sequence and dependencies
3. **packages/core/src/config/schema.ts** - WorkSourceSchema (currently GitHub-only)
4. **packages/core/src/runner/** - How agents execute (work sources feed prompts here)
5. **tasks/config-parsing-prd.md** - Example PRD format

PRDs 1-4 are complete (config, state, docs, runner).

## PRD 5 Scope: Work Sources (GitHub First, Extensible)

Build `packages/core/src/work-sources/` with an **adapter pattern** architecture.

### Critical Requirement: Extensibility

While only implementing GitHub Issues now, the architecture MUST support future integrations:
- **GitHub Issues** (this PRD)
- **Beads** (future) - Git-backed issues with dependencies
- **Linear**, **Jira**, **Notion** (future)

Design principles:
1. Common `WorkSource` interface as the contract
2. Registry to resolve adapters by type
3. Adding a new source = adding a new adapter file

### User Stories

1. **Define WorkSource interface** - `fetchAvailableWork()`, `claimWork()`, `completeWork()`, `releaseWork()`, `getWork()`

2. **Create work source registry** - `registerWorkSource(type, factory)`, `getWorkSource(config)`

3. **Implement GitHub Issues adapter** - Query by label, claim/release via label manipulation, close with comment on complete, handle rate limits

4. **Extend config schema** - GitHub-specific config (repo, labels, exclude_labels)

5. **Integration interface** - Define how scheduler/runner will use work sources (interface only)

6. **Update documentation** - Work Sources concept page, GitHub configuration guide

## Core Interface

```typescript
export interface WorkSource {
  readonly type: string;
  fetchAvailableWork(options?: FetchOptions): Promise<WorkItem[]>;
  claimWork(taskId: string): Promise<ClaimResult>;
  completeWork(taskId: string, result: WorkResult): Promise<void>;
  releaseWork(taskId: string, reason?: string): Promise<void>;
  getWork(taskId: string): Promise<WorkItem | null>;
}

export interface WorkItem {
  id: string;
  source: string;           // 'github', 'beads', etc.
  externalId: string;       // Issue number, bead ID
  title: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  labels: string[];
  metadata: Record<string, unknown>;
  url?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## File Structure

```
packages/core/src/work-sources/
├── index.ts              # Public exports
├── types.ts              # WorkSource interface, WorkItem
├── registry.ts           # Adapter registration/resolution
├── errors.ts             # WorkSourceError, ClaimError, RateLimitError
├── adapters/
│   └── github/
│       ├── github-adapter.ts
│       ├── github-client.ts
│       └── __tests__/
└── __tests__/
```

## GitHub Configuration

```yaml
work_source:
  type: github
  repo: edspencer/bragdoc-ai
  labels:
    ready: ready-for-ai
    in_progress: ai-working
  exclude_labels: [blocked, wip]
  cleanup_on_failure: true
```

## GitHub Workflow

```
Ready (label: ready-for-ai) → claim → In Progress (label: ai-working) → complete → Closed
                                              ↓ fail/timeout
                                        Release (re-add ready label)
```

## Future Extensibility: Beads Example

The interface must accommodate both label-based (GitHub) and status-based (Beads/Linear) workflows:

```typescript
class BeadsWorkSource implements WorkSource {
  type = 'beads';
  fetchAvailableWork() { /* bd list --status open --json */ }
  claimWork(id) { /* bd update <id> --status in-progress */ }
  completeWork(id) { /* bd close <id> */ }
}
```

## Quality Gates

- `pnpm typecheck` and `pnpm test` pass (>90% coverage)
- Documentation updated and builds

## Dependencies

- `@octokit/rest` - GitHub API client
- Existing: config, state, docs modules

## Notes

- Use PAT authentication for MVP (GitHub App later)
- Handle pagination for large issue lists
- Rate limit: 5000 requests/hour with PAT

Create a detailed PRD following the format in `tasks/config-parsing-prd.md`.
