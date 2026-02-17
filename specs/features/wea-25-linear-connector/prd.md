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
    mention_required: true  # Agent must be mentioned in comment to respond

# Git worktree strategy
worktree:
  enabled: true
  base_dir: /workspace/issues  # issues/eng-123-fix-auth-bug
  setup_script: .herdctl/setup-worktree.sh  # Per-agent setup script
  handoff_dir: specs  # Handoff docs go in specs/ subfolder
  cleanup_on_complete: false  # Manual cleanup after PR merge
```

**Setup Script** (`.herdctl/setup-worktree.sh`):
- Runs after worktree creation
- Generates `.env` files per agent
- Available env vars: `LINEAR_ISSUE_ID`, `LINEAR_ISSUE_IDENTIFIER`, `LINEAR_ISSUE_TITLE`, `LINEAR_WORKTREE_PATH`, `LINEAR_BRANCH_NAME`

**Note**: No `teams` filtering - whatever is assigned to the agent gets routed to it.

---

## Core Concepts

### 1. Issue = Active Session

Each Linear issue gets:
- **One ACTIVE session per agent**: Like Slack (one active conversation at a time)
- **Session can be reset**: `!reset` command clears session, starts fresh
- **Session storage**: `.herdctl/linear-sessions/<agent-name>.yaml`
- **Own worktree**: `/workspace/issues/eng-123-fix-auth-bug`
- **Own branch**: Same name as worktree directory (`eng-123-fix-auth-bug`)
- **Handoff directory**: `specs/eng-123-fix-auth-bug/` for context/planning docs

**Session key**: Issue UUID (not identifier like "ENG-123")

**Commands** (same as Slack):
- `!reset` - Clear session, start fresh conversation
- `!status` - Show session status, context usage
- `!help` - List available commands

### 2. Comments = Messages

- **User comments** trigger agent responses **only if agent is @mentioned**
- **Agent comments** created via Linear MCP in container
- **Other agent comments** are included in session context
- **Self-created comments** filtered out via `viewer.id`
- **Mid-response messaging**: User can send follow-up while agent is processing (queued and fed after current response)

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

**Worktree structure**:
```
/workspace/issues/eng-123-fix-auth-bug/  # Worktree directory
  ├── src/                                # Code files
  ├── specs/                              # Handoff directory
  │   └── eng-123-fix-auth-bug/          # Issue-specific docs
  │       ├── plan.md                     # Agent's plan
  │       ├── context.md                  # Research notes
  │       └── handoff.md                  # Context for next session
  └── .env                                # Generated by setup script
```

**Branch naming**: Same as directory name (`eng-123-fix-auth-bug`)

**Environment variables** (available in agent container):
- `LINEAR_ISSUE_ID`: Issue UUID
- `LINEAR_ISSUE_IDENTIFIER`: "ENG-123"
- `LINEAR_ISSUE_TITLE`: "Fix auth bug"
- `LINEAR_WORKTREE_PATH`: `/workspace/issues/eng-123-fix-auth-bug`
- `LINEAR_BRANCH_NAME`: `eng-123-fix-auth-bug`
- `LINEAR_HANDOFF_DIR`: `/workspace/issues/eng-123-fix-auth-bug/specs/eng-123-fix-auth-bug`

**Setup script** (`.herdctl/setup-worktree.sh`):
```bash
#!/bin/bash
# Runs after worktree creation
# Generate .env file for this agent
cat > "$LINEAR_WORKTREE_PATH/.env" <<EOF
DATABASE_URL=postgres://localhost/test
API_KEY=test-key
EOF

# Create handoff directory
mkdir -p "$LINEAR_HANDOFF_DIR"
```

**Cleanup**:
- Manual cleanup after PR merged (documented in agent instructions)
- Or `herdctl worktree clean` command
- NOT automatic on issue complete (agent may need to iterate)

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
    sessionId: "linear-backend-agent-abc123"  # Active session
    issueStartedAt: "2026-02-17T10:00:00Z"
    lastCommentAt: "2026-02-17T12:00:00Z"
    commentCount: 5
    worktreePath: "/workspace/issues/eng-123-fix-auth-bug"
    branchName: "eng-123-fix-auth-bug"
    handoffDir: "specs/eng-123-fix-auth-bug"
    contextUsage:
      inputTokens: 12000
      outputTokens: 3000
      totalTokens: 15000
      contextWindow: 200000
```

### Session Lifecycle

1. **Issue assigned webhook** → Create worktree → Create session → Spawn agent
2. **Comment created webhook (with @mention)** → Resume session → Feed comment to agent
3. **!reset command** → Clear session → Start fresh (worktree remains)
4. **Issue completed** → Mark session complete (manual worktree cleanup after PR merge)

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
**Comment.create** → Check if agent @mentioned → Resume session (if mentioned)
**Comment.update** → Debounce (1 minute), add emoji, no re-trigger
**Issue.update** (state change) → Log, agent updates state via MCP
**Issue.update** (unassigned) → Stop session (manual worktree cleanup)

**Commands** (in comments):
- `!reset` → Clear session, start fresh
- `!status` → Show session status, context usage
- `!help` → List available commands

### Comment Debouncing

Comment edits within 1 minute of creation are ignored:
- Start 1-minute timer on `Comment.update`
- If no more updates → add emoji reaction (👀)
- Do NOT trigger agent

---

## Worktree Integration

### Worktree Creation Flow

```
1. Webhook: Issue assigned to agent
2. LinearManager calls WorktreeManager.create(issue)
3. Git worktree add:
   - Path: /workspace/issues/eng-123-fix-auth-bug
   - Branch: eng-123-fix-auth-bug (same as directory name)
   - Base: main (or parent issue branch for sub-tasks)
4. Run setup script (.herdctl/setup-worktree.sh):
   - Generate .env file
   - Create handoff directory (specs/eng-123-fix-auth-bug/)
   - Any other per-agent initialization
5. Mount worktree into agent container
6. Spawn agent with LINEAR_* env vars
```

### Branch Naming Convention

Branch name = worktree directory name (no `agent/` prefix):

```
<issue-identifier>-<sanitized-title>

Examples:
eng-123-fix-auth-bug
eng-456-add-dark-mode
```

**Rationale**: Simpler, matches directory structure, easier to track

### Sub-Issue Branching

If issue has parent:
- Base branch = parent's issue branch (not main)
- Example: Parent `eng-100-oauth` → Sub-issue `eng-123-add-pkce` branches from `eng-100-oauth`
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
Content: "@backend-agent can you implement OAuth? @security-agent please review"

→ Triggers BOTH agents (both are @mentioned)
→ backend-agent session gets comment
→ security-agent session gets comment
→ Both respond in separate comments
```

If comment doesn't @mention any agent:
```
Content: "I need help with this"
→ No agent triggered (must @mention)
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
  sessionId: string;              // SDK session ID (active session)
  issueStartedAt: string;
  lastCommentAt: string;
  commentCount: number;
  worktreePath?: string;          // "/workspace/issues/eng-123-fix-auth-bug"
  branchName?: string;            // "eng-123-fix-auth-bug" (same as directory)
  handoffDir?: string;            // "specs/eng-123-fix-auth-bug"
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

## Agent Instructions

### Worktree Cleanup Policy

**DO NOT** automatically delete worktrees on issue completion. Instead:

1. **Agent marks issue complete only when**:
   - PR is created
   - PR is reviewed and approved
   - PR is merged to base branch

2. **Worktree cleanup happens**:
   - Manually after PR merge confirmation
   - Via `herdctl worktree clean` command
   - Via `!cleanup` command in Linear comment

3. **Agent system prompt should include**:
   ```
   When working on Linear issues:
   - Create PR when work is complete
   - Mark issue as "Done" ONLY after PR is merged
   - Do NOT delete worktree - user will clean up manually
   - Use specs/<issue-identifier>/ for handoff documentation
   ```

### Handoff Documentation

Agent should use `/handoff` command to create context documents in `specs/<issue-identifier>/`:
- `plan.md` - Implementation plan
- `context.md` - Research and findings
- `handoff.md` - Context for next session (if session reset)

These files help with:
- Session continuity after `!reset`
- Context handoff (WEA-22)
- Human review and understanding

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

**Implemented**: If user comments while agent is processing:
- Queue the new message
- Feed it to agent after current response completes
- Maintains conversation continuity
- Similar to Cyrus pattern

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
