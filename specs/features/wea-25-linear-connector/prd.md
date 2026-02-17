# WEA-25: Linear Connector - Issues as Conversations

**Status**: In Progress
**Priority**: P0 (Feature)
**Created**: 2026-02-17
**Updated**: 2026-02-17

---

## Executive Summary

Design and implement a Linear connector for herdctl where **Linear issues = conversation threads** and **comments = messages**. Agents respond to issues assigned to them, with each issue getting its own git worktree and persistent session.

**Key Innovation**: Webhook-driven, worktree-per-issue, multi-agent collaboration on same issue.

---

## Problem Statement

### Current State
- Herdctl supports real-time chat (Discord, Slack) but lacks task-tracking integration
- Linear is used for issue tracking, but agents can't respond to issue comments
- No automatic workflow: issue assignment → agent worktree → agent work → PR creation
- Multiple agents can't collaborate on the same issue

### Desired State
- **Webhook-driven**: Linear events trigger agents instantly
- **Worktree-per-issue**: Each issue gets isolated git worktree + branch
- **Multi-agent support**: Multiple agents can comment on same issue
- **Session continuity**: Conversation persists across comments
- **Auto-PR creation**: Agent creates PR when work is complete

---

## Architecture Overview

### High-Level Flow

```
Linear Issue Assigned
        ↓
    Webhook → herdctl
        ↓
  Create Worktree
        ↓
   Spawn Agent
        ↓
  Agent Comments
```

### Core Components

**WebhookServer** (herdctl-level)
- Single HTTP server for all webhooks (Linear, GitHub, etc.)
- Configured in `herdctl.yaml`, not per-agent
- Routes events to appropriate connector

**LinearConnector** (shared across agents)
- Receives Linear webhooks
- Routes issues to agents by assignee
- Manages sessions per issue
- Handles multi-agent comments on same issue

**WorktreeManager** (per agent)
- Creates git worktree for each issue
- Branch naming: `agent/<agent-name>/<issue-identifier>-<title>`
- Cleanup on issue completion

---

## Configuration

### Herdctl-Level Config

```yaml
# herdctl.yaml
webhooks:
  enabled: true
  port: 3000
  routes:
    - path: /webhooks/linear
      secret_env: LINEAR_WEBHOOK_SECRET
      connector: linear
```

### Agent-Level Config

```yaml
# agents/backend-agent.yaml
name: backend-agent

# Linear MCP server in container
mcp_servers:
  linear:
    url: http://linear-mcp:8080/mcp
    env:
      LINEAR_API_KEY: ${LINEAR_API_KEY}

# Enable Linear connector
chat:
  linear:
    enabled: true
    session_expiry_hours: 168  # 7 days

# Git worktree strategy
worktree:
  enabled: true
  base_dir: /workspace/.herdctl/worktrees
  branch_prefix: agent/backend-agent
  cleanup_on_complete: true
```

**Note**: No `teams` filtering - whatever is assigned to the agent gets routed to it.

---

## Core Concepts

### 1. Issue = Conversation Thread

Each Linear issue gets:
- **Own session**: Stored in `.herdctl/linear-sessions/<agent-name>.yaml`
- **Own worktree**: `/workspace/.herdctl/worktrees/<issue-identifier>`
- **Own branch**: `agent/backend-agent/eng-123-fix-auth-bug`

**Session key**: Issue UUID (not identifier like "ENG-123")

### 2. Comments = Messages

- **User comments** trigger agent responses
- **Agent comments** created via Linear MCP in container
- **Other agent comments** are included in session context
- **Self-created comments** filtered out via `viewer.id`

### 3. Multi-Agent Collaboration

Multiple agents can work on same issue:
- Each agent has own session for that issue
- All comments (from all agents) visible to all
- No conflict - comments are append-only
- Session context includes comments from other agents

Example:
```
Issue ENG-123: "Fix authentication bug"
- backend-agent session: reads issue + all comments
- security-agent session: reads same issue + all comments
Both agents see each other's comments in context
```

### 4. Worktree-Per-Issue

Inspired by Cyrus implementation:

**Worktree creation**:
```
Issue assigned → Create worktree
/workspace/.herdctl/worktrees/eng-123/
Branch: agent/backend-agent/eng-123-fix-auth-bug
```

**Environment variables** (available in agent container):
- `LINEAR_ISSUE_ID`: Issue UUID
- `LINEAR_ISSUE_IDENTIFIER`: "ENG-123"
- `LINEAR_ISSUE_TITLE`: Issue title
- `LINEAR_WORKTREE_PATH`: `/workspace/.herdctl/worktrees/eng-123`
- `LINEAR_BRANCH_NAME`: `agent/backend-agent/eng-123-fix-auth-bug`

**Cleanup**:
- Agent marks issue complete → worktree deleted
- Or manual cleanup command

### 5. Conversation Context

On each comment, agent receives ALL previous messages:
1. **Issue description** (the original task)
2. **ALL comments** (including from other agents)
3. **Issue metadata** (state, assignee, labels, priority)

SDK auto-compact handles context overflow (~95% usage).

---

## Session Management

### Session Storage

```yaml
# .herdctl/linear-sessions/backend-agent.yaml
version: 3
agentName: backend-agent
issues:
  <issue-uuid>:
    issueIdentifier: "ENG-123"
    sessionId: "linear-backend-agent-abc123"
    issueStartedAt: "2026-02-17T10:00:00Z"
    lastCommentAt: "2026-02-17T12:00:00Z"
    commentCount: 5
    worktreePath: "/workspace/.herdctl/worktrees/eng-123"
    branchName: "agent/backend-agent/eng-123-fix-auth-bug"
    contextUsage:
      inputTokens: 12000
      outputTokens: 3000
      totalTokens: 15000
      contextWindow: 200000
```

### Session Lifecycle

1. **Issue assigned webhook** → Create worktree → Create session → Spawn agent
2. **Comment created webhook** → Resume session → Feed comment to agent
3. **Issue completed** → Delete worktree → Mark session complete

### Multi-Agent Sessions

Each agent maintains its own session per issue:
- `backend-agent` session for ENG-123
- `security-agent` session for ENG-123
Both sessions read the same Linear issue + comments, but have separate SDK sessions.

---

## Webhook Handling

### Webhook Server (General Purpose)

**Location**: `packages/core/src/fleet-manager/webhook-server.ts`

Routes webhooks to appropriate connector:
- `POST /webhooks/linear` → LinearConnector
- `POST /webhooks/github` → GitHubConnector (future)

Signature verification per route.

### Linear Webhook Events

**Issue.create** with assignee → Create worktree + spawn agent
**Comment.create** → Resume agent session
**Comment.update** → Debounce (5s), add emoji, no re-trigger
**Issue.update** (state change) → Log, agent updates state via MCP
**Issue.update** (unassigned) → Stop session, cleanup worktree

### Comment Debouncing

Comment edits within 5s of creation are ignored:
- Start 5s timer on `Comment.update`
- If no more updates → add emoji reaction (👀)
- Do NOT trigger agent

---

## Worktree Integration

### Worktree Creation Flow

```
1. Webhook: Issue assigned to agent
2. LinearManager calls WorktreeManager.create(issue)
3. Git worktree add:
   - Path: /workspace/.herdctl/worktrees/eng-123
   - Branch: agent/backend-agent/eng-123-fix-auth-bug
   - Base: main (or parent issue branch for sub-tasks)
4. Mount worktree into agent container
5. Spawn agent with LINEAR_* env vars
```

### Branch Naming Convention

```
agent/<agent-name>/<issue-identifier>-<sanitized-title>

Examples:
agent/backend-agent/eng-123-fix-auth-bug
agent/frontend-agent/eng-456-add-dark-mode
```

### Sub-Issue Branching

If issue has parent:
- Base branch = parent's agent branch (not main)
- Allows stacked PRs

### Worktree Cleanup

**Automatic**:
- Issue closed → delete worktree
- Issue unassigned → delete worktree

**Manual**:
- `herdctl worktree clean` command
- Removes orphaned worktrees

---

## Multi-Agent Comment Handling

### Scenario: Two agents on same issue

```
Issue: ENG-123 "Implement OAuth"
Assigned to: backend-agent, security-agent

Webhook: Comment.create by @user
→ Triggers BOTH agents (if both are mentioned or mode=auto)
→ backend-agent session gets comment
→ security-agent session gets comment
→ Both respond in separate comments
```

### Session Context Includes Other Agents

When backend-agent reads issue:
```typescript
context = [
  { role: "user", content: "Issue description" },
  { role: "user", content: "@backend-agent can you implement OAuth?" },
  { role: "assistant", content: "backend-agent: I'll implement..." },
  { role: "user", content: "security-agent: Note the PKCE requirement" },
  { role: "user", content: "@backend-agent did you add PKCE?" }
]
```

Security-agent's comment is seen as `user` message (not filtered).

### Routing Logic

**Simple**: Issue assignee determines which agent(s) receive webhook.

Linear allows multiple assignees → multiple agents get same webhook → each maintains own session.

---

## Error Handling

### Self-Created Comment Loop Prevention

Filter comments where `comment.user.id === botUserId`:
```
Agent creates comment → webhook fires → LinearConnector filters it out
```

### Session Corruption Recovery

If session YAML is corrupted:
- Log warning
- Create new session
- Continue normally

### Worktree Conflicts

If worktree already exists:
- Check if stale (no activity >24h)
- If stale: delete and recreate
- If active: log error, skip creation

---

## Message Flow

```
┌─────────────────────────────────────────────────────────┐
│              Linear Platform                            │
│  Issue ENG-123: "Fix auth bug"                          │
│  └─ Comment by @user: "Agent, please fix this"         │
└─────────────────────────────────────────────────────────┘
                      │
                      │ POST /webhooks/linear
                      ▼
┌─────────────────────────────────────────────────────────┐
│           WebhookServer (herdctl)                       │
│  1. Verify Linear signature (HMAC-SHA256)               │
│  2. Route to LinearConnector                            │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│           LinearConnector                               │
│  1. Parse webhook (Comment.create)                      │
│  2. Filter self-created comments                        │
│  3. Get assignees → route to agents                     │
│  4. Emit "message" event per agent                      │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│           LinearManager                                 │
│  1. Get/create session for issue                        │
│  2. Check if worktree exists, create if needed          │
│  3. Build conversation context (ALL comments)           │
│  4. Trigger FleetManager                                │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│           FleetManager                                  │
│  1. Spawn agent in Docker with worktree mount           │
│  2. Pass LINEAR_* env vars                              │
│  3. Linear MCP server available in container            │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│           Agent Container                               │
│  1. Read issue from Linear MCP                          │
│  2. Work in /workspace (worktree)                       │
│  3. Make changes, commit                                │
│  4. Create comment via linear_create_comment MCP        │
│  5. Update issue state via linear_edit_issue MCP        │
└─────────────────────────────────────────────────────────┘
                      │
                      │ Linear API (via MCP)
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Linear Platform                            │
│  Issue ENG-123 (State: In Progress)                    │
│  └─ Comment by @agent: "Fixed in commit abc123"        │
└─────────────────────────────────────────────────────────┘
```

---

## Data Structures

### LinearWebhookEvent

```typescript
interface LinearWebhookEvent {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "IssueLabel";
  data: {
    id: string;
    // ... Linear API fields
  };
  url: string;
  createdAt: string;
}
```

### LinearSession

```typescript
interface LinearSession {
  issueIdentifier: string;       // "ENG-123"
  sessionId: string;              // SDK session ID
  issueStartedAt: string;
  lastCommentAt: string;
  commentCount: number;
  worktreePath?: string;          // "/workspace/.herdctl/worktrees/eng-123"
  branchName?: string;            // "agent/backend-agent/eng-123-fix"
  contextUsage?: ContextUsage;
}
```

### LinearMessageEvent

```typescript
interface LinearMessageEvent {
  agentName: string;
  issueId: string;
  issueIdentifier: string;
  comment: {
    id: string;
    body: string;
    user: { id: string; name: string; };
    createdAt: string;
  };
  issue: {
    id: string;
    identifier: string;
    title: string;
    description: string;
    state: { name: string; };
    assignee?: { id: string; name: string; };
  };
}
```

---

## Integration with Existing Features

### WEA-21: Worktree Strategy

Linear connector builds on worktree strategy:
- Uses same `WorktreeManager` class
- Same branch naming convention
- Same cleanup logic

### WEA-22: Context Handoff

When context approaches 90%:
- Agent posts handoff comment via Linear MCP
- SessionManager clears session
- Next comment creates new session

### WEA-56: Mid-Response Messaging

If user comments while agent is processing:
- Cyrus pattern: queue message, feed after current response
- Or: interrupt current response, start new one

---

## Testing Strategy

### Unit Tests

- `LinearConnector`: Webhook parsing, self-comment filtering, debouncing
- `LinearManager`: Issue routing, session management
- `WorktreeManager`: Worktree creation, cleanup, branch naming

### Integration Tests

- Full webhook → agent → comment flow
- Multi-agent on same issue
- Worktree creation and cleanup
- Session persistence and resume

### Manual Testing

- Assign issue in Linear → verify worktree created
- Comment on issue → verify agent responds
- Multiple agents on issue → verify both respond
- Edit comment → verify debouncing works

---

## Security Considerations

### Webhook Signature Verification

```typescript
function verifyLinearSignature(body: string, signature: string): boolean {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  const hmac = crypto.createHmac("sha256", secret);
  const digest = hmac.update(body).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(signature)
  );
}
```

### Worktree Isolation

- Each issue gets own directory
- No cross-contamination between issues
- Git worktrees share objects but have separate working directories

### API Key Protection

- Linear API key only in agent containers (via MCP)
- Connector only reads issue metadata (no write access)

---

## Performance Considerations

### Worktree Disk Usage

- Each worktree shares git objects (no duplication)
- Working tree files are duplicated
- Cleanup removes orphaned worktrees

### Session File I/O

- Atomic writes (temp file + rename)
- In-memory cache to avoid repeated reads
- Batch updates where possible

---

## Open Questions

1. **Parent-child issue branching**: Should sub-issues branch from parent's agent branch?
   - **Proposed**: Yes (matches Cyrus pattern)

2. **Worktree cleanup timing**: When to delete worktrees?
   - **Proposed**: On issue close/unassign, plus manual cleanup command

3. **Multi-agent conflict resolution**: If two agents push to same branch?
   - **Proposed**: Each agent gets own branch (`agent/<name>/...`)

---

## References

- [Cyrus Implementation](https://github.com/ceedaragents/cyrus) - Webhook + worktree patterns
- [Linear Webhooks](https://developers.linear.app/docs/graphql/webhooks)
- [WEA-21: Worktree Strategy](/workspace/specs/features/wea-21-worktree-strategy/)
- [WEA-22: Context Handoff](/workspace/specs/features/wea-22-context-handoff/)

---

**End of PRD**
