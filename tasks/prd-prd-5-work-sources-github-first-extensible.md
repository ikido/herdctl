# PRD 5: Work Sources (GitHub First, Extensible)

## Overview

Implement the work sources foundation for herdctl in `packages/core/src/work-sources/`. This module provides a pluggable adapter pattern for task discovery and lifecycle management, enabling agents to fetch work from external systems. This PRD implements the GitHub Issues adapter while establishing an extensible architecture for future integrations (Beads, Linear, Jira, Notion).

## Background

Work sources are the mechanism by which agents discover tasks to work on. An agent's schedule triggers a check, and the work source provides the actual work items. This decouples "when to run" (scheduler) from "what to work on" (work source).

The architecture must support both label-based workflows (GitHub Issues) and status-based workflows (Beads, Linear) without forcing one paradigm on all adapters.

## User Stories

### US-1: Define WorkSource Interface
**As a** herdctl developer  
**I want to** have a common WorkSource interface  
**So that** all work source adapters share a consistent contract

**Acceptance Criteria:**
- `WorkSource` interface defines `type`, `fetchAvailableWork()`, `claimWork()`, `completeWork()`, `releaseWork()`, `getWork()`
- `WorkItem` type captures common fields: `id`, `source`, `externalId`, `title`, `description`, `priority`, `labels`, `metadata`, `url`, `createdAt`, `updatedAt`
- `FetchOptions` supports filtering and pagination
- `ClaimResult` indicates success/failure with reason
- `WorkResult` captures completion outcome (success, failure, partial)
- All types are exported from `packages/core/src/work-sources/index.ts`

### US-2: Create Work Source Registry
**As a** herdctl developer  
**I want to** register and resolve work source adapters by type  
**So that** adding new adapters requires no changes to core code

**Acceptance Criteria:**
- `registerWorkSource(type: string, factory: WorkSourceFactory)` registers adapters
- `getWorkSource(config: WorkSourceConfig)` returns configured adapter instance
- Factory pattern allows config-based instantiation
- Built-in adapters (GitHub) are pre-registered at module load
- Throws `UnknownWorkSourceError` for unregistered types
- Registry is singleton per process (module-level state)

### US-3: Implement GitHub Issues Adapter
**As a** fleet operator  
**I want to** use GitHub Issues as my work source  
**So that** agents can work on issues labeled as ready

**Acceptance Criteria:**
- Queries issues by `labels.ready` label (configurable, default: `ready`)
- Excludes issues with `exclude_labels` (default: `["blocked", "wip"]`)
- Returns issues sorted by creation date (oldest first)
- Supports pagination for repos with many issues
- Maps GitHub issue fields to `WorkItem` format
- Handles GitHub API errors gracefully

### US-4: Implement GitHub Issue Lifecycle
**As a** fleet operator  
**I want to** agents to claim, complete, and release issues  
**So that** work items move through a defined workflow

**Acceptance Criteria:**
- `claimWork(taskId)`: Removes `ready` label, adds `in_progress` label (configurable)
- `completeWork(taskId, result)`: Closes issue, removes `in_progress` label, adds completion comment with summary
- `releaseWork(taskId, reason)`: Removes `in_progress` label, re-adds `ready` label (for failures/timeouts)
- `getWork(taskId)`: Fetches single issue by number
- Handles concurrent claim attempts (detects if already claimed)
- Respects `cleanup_on_failure` config option

### US-5: Handle GitHub API Edge Cases
**As a** fleet operator  
**I want to** robust handling of GitHub API limitations  
**So that** agents don't fail due to transient issues

**Acceptance Criteria:**
- Implements exponential backoff for rate limit errors (HTTP 403 with `X-RateLimit-Remaining: 0`)
- Detects and surfaces rate limit status (remaining, reset time)
- Handles network errors with retries (max 3 attempts)
- Handles 404 errors gracefully (issue deleted/moved)
- Validates PAT has required scopes (issues read/write)
- Logs warnings for approaching rate limit (< 100 remaining)

### US-6: Extend Config Schema for GitHub Work Source
**As a** fleet operator  
**I want to** configure GitHub work source settings in YAML  
**So that** I can customize the workflow per agent

**Acceptance Criteria:**
- Extends `WorkSourceSchema` with GitHub-specific fields
- Supports `repo` field (required, format: `owner/repo`)
- Supports `labels.ready` and `labels.in_progress` (optional, with defaults)
- Supports `exclude_labels` array (optional)
- Supports `cleanup_on_failure` boolean (default: true)
- Supports `auth.token_env` for PAT environment variable
- Schema validation provides clear error messages
- Types are exported and available to other modules

### US-7: Define Scheduler Integration Interface
**As a** herdctl developer  
**I want to** a clean interface between work sources and the scheduler/runner  
**So that** future scheduler implementation has clear contracts

**Acceptance Criteria:**
- `WorkSourceManager` interface for scheduler to use
- `getNextWorkItem(agent: ResolvedAgent)` returns next available work or null
- `reportOutcome(taskId: string, result: WorkResult)` reports job completion
- Handles work source instantiation and caching per agent
- Does NOT implement scheduler logic (interface only)
- Documents expected usage patterns in code comments

### US-8: Update Documentation
**As a** herdctl user  
**I want to** comprehensive documentation on work sources  
**So that** I can configure GitHub Issues integration correctly

**Acceptance Criteria:**
- Create "Work Sources" concept page in docs explaining the adapter pattern
- Create "GitHub Issues" configuration guide with YAML examples
- Document the label-based workflow with diagram
- Document rate limiting considerations and best practices
- Document PAT token requirements and scope recommendations
- Documentation builds without errors (`pnpm build` in docs/)

## Technical Specifications

### File Structure

```
packages/core/src/work-sources/
├── index.ts              # Public exports
├── types.ts              # WorkSource interface, WorkItem, FetchOptions, etc.
├── registry.ts           # Adapter registration/resolution
├── errors.ts             # WorkSourceError, ClaimError, RateLimitError, etc.
├── manager.ts            # WorkSourceManager interface (for scheduler)
├── adapters/
│   └── github/
│       ├── index.ts          # Export adapter
│       ├── github-adapter.ts # GitHubWorkSource implementation
│       ├── github-client.ts  # Octokit wrapper with rate limit handling
│       ├── github-types.ts   # GitHub-specific types
│       └── __tests__/
│           ├── github-adapter.test.ts
│           └── github-client.test.ts
└── __tests__/
    ├── types.test.ts
    ├── registry.test.ts
    └── manager.test.ts
```

### Core Types

```typescript
// types.ts

/**
 * Common work item structure returned by all adapters
 */
export interface WorkItem {
  /** Unique identifier within herdctl (composite of source + externalId) */
  id: string;
  /** Work source type (e.g., 'github', 'beads') */
  source: string;
  /** ID in the external system (issue number, bead ID, etc.) */
  externalId: string;
  /** Human-readable title */
  title: string;
  /** Full description/body */
  description: string;
  /** Priority level if determinable */
  priority?: 'low' | 'medium' | 'high' | 'critical';
  /** Labels/tags from the source system */
  labels: string[];
  /** Source-specific metadata (assignee, milestone, etc.) */
  metadata: Record<string, unknown>;
  /** URL to view the item in the source system */
  url?: string;
  /** When the item was created */
  createdAt: Date;
  /** When the item was last updated */
  updatedAt: Date;
}

/**
 * Options for fetching available work
 */
export interface FetchOptions {
  /** Maximum items to return (default: 10) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by priority */
  priority?: WorkItem['priority'];
  /** Filter by labels (item must have ALL specified labels) */
  labels?: string[];
  /** Exclude items with these labels */
  excludeLabels?: string[];
}

/**
 * Result of attempting to claim a work item
 */
export interface ClaimResult {
  /** Whether the claim succeeded */
  success: boolean;
  /** The claimed work item (if successful) */
  workItem?: WorkItem;
  /** Reason for failure (if unsuccessful) */
  reason?: 'already_claimed' | 'not_found' | 'permission_denied' | 'rate_limited' | 'error';
  /** Error details */
  error?: Error;
}

/**
 * Outcome of work completion
 */
export interface WorkResult {
  /** Whether the work completed successfully */
  success: boolean;
  /** Summary of what was accomplished */
  summary?: string;
  /** Error message if failed */
  error?: string;
  /** Artifacts produced (PR URL, commit SHA, etc.) */
  artifacts?: Record<string, string>;
}

/**
 * The core work source interface that all adapters implement
 */
export interface WorkSource {
  /** The type identifier for this work source */
  readonly type: string;
  
  /**
   * Fetch available work items that can be claimed
   */
  fetchAvailableWork(options?: FetchOptions): Promise<WorkItem[]>;
  
  /**
   * Claim a work item so no other agent works on it
   */
  claimWork(taskId: string): Promise<ClaimResult>;
  
  /**
   * Mark a work item as complete
   */
  completeWork(taskId: string, result: WorkResult): Promise<void>;
  
  /**
   * Release a claimed work item (for failures, timeouts)
   */
  releaseWork(taskId: string, reason?: string): Promise<void>;
  
  /**
   * Get a specific work item by ID
   */
  getWork(taskId: string): Promise<WorkItem | null>;
}

/**
 * Factory function signature for creating work source instances
 */
export type WorkSourceFactory = (config: WorkSourceConfig) => WorkSource;

/**
 * Base configuration shared by all work source types
 */
export interface WorkSourceConfig {
  type: string;
  [key: string]: unknown;
}
```

### GitHub-Specific Types

```typescript
// adapters/github/github-types.ts

import { WorkSourceConfig } from '../../types.js';

/**
 * GitHub-specific work source configuration
 */
export interface GitHubWorkSourceConfig extends WorkSourceConfig {
  type: 'github';
  /** Repository in owner/repo format */
  repo: string;
  /** Label configuration */
  labels?: {
    /** Label indicating issue is ready for work (default: 'ready') */
    ready?: string;
    /** Label indicating issue is being worked on (default: 'in-progress') */
    in_progress?: string;
  };
  /** Labels to exclude from work (default: ['blocked', 'wip']) */
  exclude_labels?: string[];
  /** Re-add ready label on failure (default: true) */
  cleanup_on_failure?: boolean;
  /** Authentication */
  auth?: {
    /** Environment variable containing PAT (default: 'GITHUB_TOKEN') */
    token_env?: string;
  };
}

/**
 * Rate limit information from GitHub API
 */
export interface RateLimitInfo {
  /** Remaining requests in current window */
  remaining: number;
  /** Total requests allowed per window */
  limit: number;
  /** When the rate limit resets (Unix timestamp) */
  resetAt: number;
  /** Human-readable time until reset */
  resetsIn: string;
}
```

### Registry Implementation

```typescript
// registry.ts

import type { WorkSource, WorkSourceFactory, WorkSourceConfig } from './types.js';
import { UnknownWorkSourceError } from './errors.js';

const registry = new Map<string, WorkSourceFactory>();

/**
 * Register a work source adapter factory
 */
export function registerWorkSource(type: string, factory: WorkSourceFactory): void {
  registry.set(type, factory);
}

/**
 * Get a configured work source instance
 */
export function getWorkSource(config: WorkSourceConfig): WorkSource {
  const factory = registry.get(config.type);
  if (!factory) {
    throw new UnknownWorkSourceError(
      `Unknown work source type: '${config.type}'. ` +
      `Available types: ${[...registry.keys()].join(', ') || 'none registered'}`
    );
  }
  return factory(config);
}

/**
 * Check if a work source type is registered
 */
export function hasWorkSource(type: string): boolean {
  return registry.has(type);
}

/**
 * Get all registered work source types
 */
export function getRegisteredTypes(): string[] {
  return [...registry.keys()];
}
```

### GitHub Adapter Implementation

```typescript
// adapters/github/github-adapter.ts

import type { WorkSource, WorkItem, FetchOptions, ClaimResult, WorkResult } from '../../types.js';
import type { GitHubWorkSourceConfig, RateLimitInfo } from './github-types.js';
import { GitHubClient } from './github-client.js';
import { ClaimError, WorkSourceError } from '../../errors.js';

export class GitHubWorkSource implements WorkSource {
  readonly type = 'github';
  
  private readonly client: GitHubClient;
  private readonly config: GitHubWorkSourceConfig;
  private readonly owner: string;
  private readonly repo: string;
  
  constructor(config: GitHubWorkSourceConfig) {
    this.config = config;
    
    // Parse owner/repo
    const [owner, repo] = config.repo.split('/');
    if (!owner || !repo) {
      throw new WorkSourceError(`Invalid repo format: '${config.repo}'. Expected 'owner/repo'`);
    }
    this.owner = owner;
    this.repo = repo;
    
    // Initialize client
    const tokenEnv = config.auth?.token_env ?? 'GITHUB_TOKEN';
    const token = process.env[tokenEnv];
    if (!token) {
      throw new WorkSourceError(
        `GitHub token not found. Set ${tokenEnv} environment variable.`
      );
    }
    
    this.client = new GitHubClient(token);
  }
  
  async fetchAvailableWork(options: FetchOptions = {}): Promise<WorkItem[]> {
    const readyLabel = this.config.labels?.ready ?? 'ready';
    const excludeLabels = this.config.exclude_labels ?? ['blocked', 'wip'];
    
    const issues = await this.client.listIssues({
      owner: this.owner,
      repo: this.repo,
      labels: [readyLabel, ...(options.labels ?? [])],
      state: 'open',
      per_page: options.limit ?? 10,
      page: options.offset ? Math.floor(options.offset / (options.limit ?? 10)) + 1 : 1,
    });
    
    // Filter out excluded labels
    const filtered = issues.filter(issue => 
      !issue.labels.some((label: { name: string }) => 
        excludeLabels.includes(label.name)
      )
    );
    
    return filtered.map(issue => this.mapIssueToWorkItem(issue));
  }
  
  async claimWork(taskId: string): Promise<ClaimResult> {
    const issueNumber = parseInt(taskId, 10);
    const readyLabel = this.config.labels?.ready ?? 'ready';
    const inProgressLabel = this.config.labels?.in_progress ?? 'in-progress';
    
    try {
      // Fetch current issue to verify it's still available
      const issue = await this.client.getIssue({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });
      
      // Check if already claimed (has in_progress label)
      const hasInProgress = issue.labels.some(
        (l: { name: string }) => l.name === inProgressLabel
      );
      if (hasInProgress) {
        return { success: false, reason: 'already_claimed' };
      }
      
      // Remove ready label, add in_progress label
      await this.client.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        name: readyLabel,
      });
      
      await this.client.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels: [inProgressLabel],
      });
      
      return {
        success: true,
        workItem: this.mapIssueToWorkItem(issue),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return { success: false, reason: 'not_found' };
      }
      throw error;
    }
  }
  
  async completeWork(taskId: string, result: WorkResult): Promise<void> {
    const issueNumber = parseInt(taskId, 10);
    const inProgressLabel = this.config.labels?.in_progress ?? 'in-progress';
    
    // Remove in_progress label
    await this.client.removeLabel({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      name: inProgressLabel,
    }).catch(() => {}); // Ignore if label doesn't exist
    
    // Add completion comment
    const comment = result.success
      ? `✅ Completed by herdctl agent.\n\n${result.summary ?? 'No summary provided.'}`
      : `❌ Failed: ${result.error ?? 'Unknown error'}`;
    
    await this.client.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: comment,
    });
    
    // Close issue if successful
    if (result.success) {
      await this.client.updateIssue({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        state: 'closed',
      });
    }
  }
  
  async releaseWork(taskId: string, reason?: string): Promise<void> {
    const issueNumber = parseInt(taskId, 10);
    const readyLabel = this.config.labels?.ready ?? 'ready';
    const inProgressLabel = this.config.labels?.in_progress ?? 'in-progress';
    
    // Remove in_progress label
    await this.client.removeLabel({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      name: inProgressLabel,
    }).catch(() => {});
    
    // Re-add ready label if cleanup_on_failure is true (default)
    if (this.config.cleanup_on_failure !== false) {
      await this.client.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels: [readyLabel],
      });
    }
    
    // Add comment about release
    if (reason) {
      await this.client.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body: `⚠️ Released by herdctl agent.\n\nReason: ${reason}`,
      });
    }
  }
  
  async getWork(taskId: string): Promise<WorkItem | null> {
    const issueNumber = parseInt(taskId, 10);
    
    try {
      const issue = await this.client.getIssue({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });
      return this.mapIssueToWorkItem(issue);
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }
  
  /**
   * Get current rate limit status
   */
  async getRateLimitInfo(): Promise<RateLimitInfo> {
    return this.client.getRateLimitInfo();
  }
  
  private mapIssueToWorkItem(issue: GitHubIssue): WorkItem {
    return {
      id: `github:${this.owner}/${this.repo}#${issue.number}`,
      source: 'github',
      externalId: String(issue.number),
      title: issue.title,
      description: issue.body ?? '',
      priority: this.inferPriority(issue.labels),
      labels: issue.labels.map((l: { name: string }) => l.name),
      metadata: {
        assignee: issue.assignee?.login,
        milestone: issue.milestone?.title,
        author: issue.user?.login,
        comments: issue.comments,
      },
      url: issue.html_url,
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
    };
  }
  
  private inferPriority(labels: Array<{ name: string }>): WorkItem['priority'] {
    const labelNames = labels.map(l => l.name.toLowerCase());
    if (labelNames.some(l => l.includes('critical') || l.includes('p0'))) return 'critical';
    if (labelNames.some(l => l.includes('high') || l.includes('p1'))) return 'high';
    if (labelNames.some(l => l.includes('medium') || l.includes('p2'))) return 'medium';
    if (labelNames.some(l => l.includes('low') || l.includes('p3'))) return 'low';
    return undefined;
  }
}

// Type for GitHub API issue response (subset of fields we use)
interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
  milestone: { title: string } | null;
  user: { login: string } | null;
  comments: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  state: 'open' | 'closed';
}
```

### Error Types

```typescript
// errors.ts

/**
 * Base error for work source operations
 */
export class WorkSourceError extends Error {
  constructor(
    message: string,
    public readonly source?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'WorkSourceError';
  }
}

/**
 * Unknown work source type requested
 */
export class UnknownWorkSourceError extends WorkSourceError {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownWorkSourceError';
  }
}

/**
 * Failed to claim a work item
 */
export class ClaimError extends WorkSourceError {
  constructor(
    message: string,
    public readonly taskId: string,
    public readonly reason: 'already_claimed' | 'not_found' | 'permission_denied' | 'error',
    cause?: Error
  ) {
    super(message, undefined, cause);
    this.name = 'ClaimError';
  }
}

/**
 * Rate limit exceeded
 */
export class RateLimitError extends WorkSourceError {
  constructor(
    message: string,
    public readonly resetAt: Date,
    public readonly remaining: number = 0,
    cause?: Error
  ) {
    super(message, undefined, cause);
    this.name = 'RateLimitError';
  }
}

/**
 * Authentication/authorization error
 */
export class AuthError extends WorkSourceError {
  constructor(message: string, cause?: Error) {
    super(message, undefined, cause);
    this.name = 'AuthError';
  }
}
```

### Manager Interface

```typescript
// manager.ts

import type { WorkSource, WorkItem, WorkResult, WorkSourceConfig } from './types.js';
import type { ResolvedAgent } from '../config/index.js';
import { getWorkSource } from './registry.js';

/**
 * Interface for scheduler integration with work sources
 * 
 * The scheduler/runner will use this interface to:
 * 1. Get the next available work item for an agent
 * 2. Report the outcome of work execution
 * 
 * This allows the scheduler to remain agnostic of work source specifics.
 */
export interface WorkSourceManager {
  /**
   * Get the next available work item for an agent
   * Returns null if no work is available
   */
  getNextWorkItem(agent: ResolvedAgent): Promise<WorkItem | null>;
  
  /**
   * Report the outcome of work execution
   */
  reportOutcome(taskId: string, result: WorkResult): Promise<void>;
  
  /**
   * Release a work item (for failures/timeouts)
   */
  releaseWork(taskId: string, reason?: string): Promise<void>;
}

/**
 * Default implementation of WorkSourceManager
 * Caches work source instances per agent configuration
 */
export class DefaultWorkSourceManager implements WorkSourceManager {
  private readonly sources = new Map<string, WorkSource>();
  
  private getSourceForAgent(agent: ResolvedAgent): WorkSource | null {
    const config = agent.work_source;
    if (!config) return null;
    
    // Cache key based on agent name (assumes work source config is stable per agent)
    const cacheKey = agent.name;
    
    if (!this.sources.has(cacheKey)) {
      const source = getWorkSource(config as WorkSourceConfig);
      this.sources.set(cacheKey, source);
    }
    
    return this.sources.get(cacheKey)!;
  }
  
  async getNextWorkItem(agent: ResolvedAgent): Promise<WorkItem | null> {
    const source = this.getSourceForAgent(agent);
    if (!source) return null;
    
    const items = await source.fetchAvailableWork({ limit: 1 });
    if (items.length === 0) return null;
    
    const item = items[0];
    const claimResult = await source.claimWork(item.externalId);
    
    if (!claimResult.success) {
      // Item was claimed by another agent, try next
      // In a real implementation, we might want to retry with the next item
      return null;
    }
    
    return claimResult.workItem ?? null;
  }
  
  async reportOutcome(taskId: string, result: WorkResult): Promise<void> {
    // Extract source type from taskId (format: "github:owner/repo#123")
    const [sourceKey] = taskId.split(':');
    
    // Find the cached source (this is a simplified lookup)
    for (const source of this.sources.values()) {
      if (source.type === sourceKey || taskId.startsWith(`${source.type}:`)) {
        await source.completeWork(this.extractExternalId(taskId), result);
        return;
      }
    }
    
    throw new Error(`No work source found for task: ${taskId}`);
  }
  
  async releaseWork(taskId: string, reason?: string): Promise<void> {
    for (const source of this.sources.values()) {
      if (taskId.startsWith(`${source.type}:`)) {
        await source.releaseWork(this.extractExternalId(taskId), reason);
        return;
      }
    }
  }
  
  private extractExternalId(taskId: string): string {
    // taskId format: "github:owner/repo#123" -> "123"
    const match = taskId.match(/#(\d+)$/);
    return match ? match[1] : taskId;
  }
}
```

### Config Schema Extensions

Add to `packages/core/src/config/schema.ts`:

```typescript
// Extended GitHub work source schema
export const GitHubWorkSourceLabelsSchema = z.object({
  ready: z.string().optional().default('ready'),
  in_progress: z.string().optional().default('in-progress'),
});

export const GitHubWorkSourceAuthSchema = z.object({
  token_env: z.string().optional().default('GITHUB_TOKEN'),
});

export const GitHubWorkSourceSchema = z.object({
  type: z.literal('github'),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  labels: GitHubWorkSourceLabelsSchema.optional(),
  exclude_labels: z.array(z.string()).optional().default(['blocked', 'wip']),
  cleanup_on_failure: z.boolean().optional().default(true),
  auth: GitHubWorkSourceAuthSchema.optional(),
});

// Union of all work source types (extensible)
export const WorkSourceConfigSchema = z.discriminatedUnion('type', [
  GitHubWorkSourceSchema,
  // Future: BeadsWorkSourceSchema, LinearWorkSourceSchema, etc.
]);
```

### Public API

```typescript
// index.ts

// Core types
export type {
  WorkSource,
  WorkItem,
  FetchOptions,
  ClaimResult,
  WorkResult,
  WorkSourceFactory,
  WorkSourceConfig,
} from './types.js';

// Registry
export {
  registerWorkSource,
  getWorkSource,
  hasWorkSource,
  getRegisteredTypes,
} from './registry.js';

// Errors
export {
  WorkSourceError,
  UnknownWorkSourceError,
  ClaimError,
  RateLimitError,
  AuthError,
} from './errors.js';

// Manager
export {
  WorkSourceManager,
  DefaultWorkSourceManager,
} from './manager.js';

// GitHub adapter
export { GitHubWorkSource } from './adapters/github/index.js';
export type { GitHubWorkSourceConfig, RateLimitInfo } from './adapters/github/github-types.js';

// Auto-register built-in adapters
import { registerWorkSource } from './registry.js';
import { GitHubWorkSource } from './adapters/github/index.js';
import type { GitHubWorkSourceConfig } from './adapters/github/github-types.js';

registerWorkSource('github', (config) => new GitHubWorkSource(config as GitHubWorkSourceConfig));
```

## Test Plan

### Unit Tests

```typescript
// __tests__/types.test.ts
describe('WorkItem', () => {
  it('validates required fields');
  it('allows optional fields');
});

// __tests__/registry.test.ts
describe('Work Source Registry', () => {
  it('registers a work source factory');
  it('returns configured instance from factory');
  it('throws UnknownWorkSourceError for unregistered type');
  it('lists registered types');
  it('checks if type is registered');
  it('GitHub adapter is pre-registered');
});

// __tests__/manager.test.ts
describe('DefaultWorkSourceManager', () => {
  it('returns null if agent has no work source');
  it('caches work source instances per agent');
  it('gets next work item and claims it');
  it('returns null if no work available');
  it('reports outcome to correct source');
  it('releases work on failure');
});

// adapters/github/__tests__/github-adapter.test.ts
describe('GitHubWorkSource', () => {
  it('parses repo from config');
  it('throws on invalid repo format');
  it('throws if token env not set');
  
  describe('fetchAvailableWork', () => {
    it('queries issues with ready label');
    it('excludes issues with blocked labels');
    it('maps GitHub issue to WorkItem');
    it('respects limit option');
    it('handles empty results');
  });
  
  describe('claimWork', () => {
    it('removes ready label and adds in_progress');
    it('returns already_claimed if has in_progress label');
    it('returns not_found for deleted issue');
  });
  
  describe('completeWork', () => {
    it('removes in_progress label');
    it('adds completion comment');
    it('closes issue on success');
    it('does not close on failure');
  });
  
  describe('releaseWork', () => {
    it('removes in_progress label');
    it('re-adds ready label when cleanup_on_failure true');
    it('skips ready label when cleanup_on_failure false');
    it('adds comment with reason');
  });
  
  describe('getWork', () => {
    it('returns work item for valid issue');
    it('returns null for 404');
  });
});

// adapters/github/__tests__/github-client.test.ts
describe('GitHubClient', () => {
  it('authenticates with PAT');
  
  describe('rate limiting', () => {
    it('detects rate limit from headers');
    it('implements exponential backoff');
    it('surfaces rate limit info');
    it('warns when approaching limit');
  });
  
  describe('error handling', () => {
    it('retries on network error');
    it('max 3 retry attempts');
    it('throws after max retries');
    it('surfaces 403 as AuthError');
  });
});
```

### Integration Tests

```typescript
// __tests__/integration/github-integration.test.ts
// Uses mock GitHub API or test repository
describe('GitHub Work Source Integration', () => {
  it('fetches real issues from test repo');
  it('claims and releases issue');
  it('completes issue with comment');
});
```

## Dependencies

**Required additions to `packages/core/package.json`:**

```json
{
  "dependencies": {
    "@octokit/rest": "^21.0.0"
  }
}
```

**Already available:**
- `zod` - Schema validation
- `vitest` - Testing

## Out of Scope

- Beads adapter implementation (future PRD)
- Linear/Jira/Notion adapters (future PRDs)
- Work source webhooks (push-based triggers)
- Issue assignment to specific agents
- Work item prioritization algorithm
- Duplicate work detection across agents
- GitHub App authentication (PAT only for MVP)

## Quality Gates

These commands must pass:
- `pnpm typecheck` - TypeScript compilation succeeds
- `pnpm test` - All tests pass with >90% coverage of work-sources module
- `pnpm build` in docs/ - Documentation builds without errors

## Acceptance Criteria Summary

1. `WorkSource` interface is defined with all required methods
2. Registry pattern allows adding new adapters without core changes
3. GitHub adapter queries issues by label and handles lifecycle
4. Rate limiting is handled with exponential backoff
5. Config schema validates GitHub-specific options
6. Manager interface is defined for scheduler integration
7. Documentation explains work sources concept and GitHub setup
8. All types are exported and usable by other modules
9. Test coverage >90% for work-sources module
10. Example config in `examples/` demonstrates GitHub work source

## Future Extensibility Notes

The adapter pattern established here will support future work sources:

```typescript
// Example: Beads adapter (future)
class BeadsWorkSource implements WorkSource {
  type = 'beads';
  
  async fetchAvailableWork() {
    // Execute: bd list --status open --json
  }
  
  async claimWork(id: string) {
    // Execute: bd update <id> --status in-progress
  }
  
  async completeWork(id: string, result: WorkResult) {
    // Execute: bd close <id> --comment "..."
  }
}

// Registration
registerWorkSource('beads', (config) => new BeadsWorkSource(config));
```

The interface intentionally uses generic concepts (claim, complete, release) that map naturally to both label-based (GitHub) and status-based (Beads, Linear) workflows.