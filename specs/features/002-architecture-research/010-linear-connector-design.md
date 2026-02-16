# 010: Linear Connector Design

**Date:** 2026-02-16
**Status:** Design Proposal
**Purpose:** Design a Linear connector for herdctl, following the patterns established by the Discord and Slack connectors, adapted for Linear's issue-as-conversation model.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Linear as a Chat Connector](#2-linear-as-a-chat-connector)
3. [Concept Mapping: Linear vs Discord vs Slack](#3-concept-mapping-linear-vs-discord-vs-slack)
4. [Which Issues Spawn Sessions](#4-which-issues-spawn-sessions)
5. [Interaction Model](#5-interaction-model)
6. [Connector Architecture](#6-connector-architecture)
7. [Session Lifecycle](#7-session-lifecycle)
8. [Agent Self-Created Issues](#8-agent-self-created-issues)
9. [Integration with Worktree Strategy](#9-integration-with-worktree-strategy)
10. [Configuration Schema](#10-configuration-schema)
11. [Package Structure](#11-package-structure)
12. [Code Structure Proposals](#12-code-structure-proposals)
13. [Linear API Integration](#13-linear-api-integration)
14. [Webhook vs Polling](#14-webhook-vs-polling)
15. [Error Handling](#15-error-handling)
16. [FleetManager Integration](#16-fleetmanager-integration)
17. [Open Questions](#17-open-questions)

---

## 1. Executive Summary

Linear is a project management tool where issues serve as work items. Unlike Discord (real-time chat in channels) or Slack (real-time chat in threads), Linear's interaction model is **asynchronous and issue-centric**:

- An issue is the unit of work (analogous to a Discord channel or Slack thread)
- Comments on an issue are messages in the conversation
- The agent responds by posting comments and updating issue state
- Creating or assigning an issue to an agent starts a new session

This makes Linear a fundamentally different kind of connector from Discord and Slack. Where Discord and Slack are **conversational** (humans chat back and forth with the agent), Linear is **task-oriented** (an issue describes work, the agent does it, comments provide status updates).

**Key architectural decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Connector multiplicity | ONE connector, shared across agents | Like Slack, one API key per workspace |
| Session key | Issue ID | Each issue is a separate conversation/task |
| Event delivery | Webhooks (primary), polling (fallback) | Webhooks provide real-time events; polling is simpler to deploy |
| Session trigger | Issue assigned to agent OR matching filter | Explicit assignment plus configurable filter queries |
| Self-created issue detection | Track creator via Linear API user ID | Issues created by the agent's API key are tagged as agent-created |

---

## 2. Linear as a Chat Connector

### The Conversation Metaphor

```
+-------------------+-------------------+--------------------+
|      Discord      |       Slack       |       Linear       |
+-------------------+-------------------+--------------------+
| Channel           | Thread            | Issue              |
| Message           | Message           | Comment            |
| @mention          | @mention          | Assignment/Label   |
| Typing indicator  | Hourglass emoji   | Status update      |
| Channel topic     | Thread parent msg | Issue title+desc   |
| Server (Guild)    | Workspace         | Workspace          |
| N/A               | N/A               | Sub-issues         |
+-------------------+-------------------+--------------------+
```

### How the Metaphor Works

In Discord and Slack, a user initiates a conversation by sending a message (with an @mention or in a configured channel). In Linear, a user initiates work by:

1. Creating an issue and assigning it to the agent
2. Adding a label that marks the issue for agent processing
3. Creating an issue in a team/project configured for agent intake

The agent "converses" by:

1. Posting comments on the issue (equivalent to sending messages)
2. Updating the issue status (e.g., "In Progress" -> "Done")
3. Creating sub-issues for subtasks it identifies
4. Linking PRs and branches to the issue

### Why This Works

Linear issues already carry rich context that a Claude agent needs:

- **Title**: The task summary (equivalent to the initial prompt)
- **Description**: Detailed requirements (equivalent to conversation history)
- **Labels**: Task categorization (helps the agent understand the domain)
- **Priority**: How urgent the work is
- **Project/Milestone**: Where this fits in the larger picture
- **Parent issue**: Hierarchical context
- **Linked issues**: Related work for context

This is actually *more* context than a typical Discord/Slack message provides, making Linear a natural fit for task-oriented agents.

---

## 3. Concept Mapping: Linear vs Discord vs Slack

### Connector Architecture Comparison

```
Discord Architecture:
  FleetManager
    -> DiscordManager (in core)
      -> Map<agentName, DiscordConnector>   (N connectors, 1 per agent)
        -> Each has its own bot token + discord.js Client
        -> SessionManager per agent (keyed by channelId)

Slack Architecture:
  FleetManager
    -> SlackManager (in core)
      -> SlackConnector (1 shared connector)
        -> channelAgentMap: Map<channelId, agentName>   (routing)
        -> sessionManagers: Map<agentName, SessionManager>  (keyed by threadTs)

Linear Architecture (proposed):
  FleetManager
    -> LinearManager (in core)
      -> LinearConnector (1 shared connector)
        -> issueAgentMap: derived from config filters   (routing)
        -> sessionManagers: Map<agentName, SessionManager>  (keyed by issueId)
```

The Linear connector follows the **Slack pattern** (single shared connector) because:

- Linear uses a single API key per workspace (like Slack's single bot token)
- Multiple agents can watch different teams/projects in the same workspace
- Issue-to-agent routing is determined by team, project, labels, or assignment

### Component Mapping

| Component | Discord | Slack | Linear (Proposed) |
|-----------|---------|-------|-------------------|
| **Connector class** | `DiscordConnector` | `SlackConnector` | `LinearConnector` |
| **Manager class** | `DiscordManager` | `SlackManager` | `LinearManager` |
| **Session manager** | `SessionManager` (keyed by channelId) | `SessionManager` (keyed by threadTs) | `SessionManager` (keyed by issueId) |
| **Event source** | discord.js gateway (WebSocket) | Bolt Socket Mode (WebSocket) | Webhook receiver (HTTP) or polling |
| **Connector count** | N (one per agent) | 1 (shared) | 1 (shared) |
| **Routing** | Agent has its own bot identity | `channelAgentMap` | Issue filters per agent (team, label, assignee) |
| **Session state file** | `.herdctl/discord-sessions/<agent>.yaml` | `.herdctl/slack-sessions/<agent>.yaml` | `.herdctl/linear-sessions/<agent>.yaml` |
| **Session ID format** | `discord-<agent>-<uuid>` | `slack-<agent>-<uuid>` | `linear-<agent>-<uuid>` |
| **Processing indicator** | Typing indicator (refreshed 8s) | Hourglass emoji reaction | Issue status -> "In Progress" |
| **Reply mechanism** | `channel.send(content)` | `say({ text, thread_ts })` | `linearClient.createComment({ issueId, body })` |
| **Package name** | `@herdctl/discord` | `@herdctl/slack` | `@herdctl/linear` |
| **Dynamic import** | `importDiscordPackage()` | `importSlackPackage()` | `importLinearPackage()` |

### Message Event Comparison

```
Discord message event:
  {
    agentName, prompt, context (with history),
    metadata: { guildId, channelId, messageId, userId, username, wasMentioned, mode },
    reply: (content) => Promise<void>,
    startTyping: () => () => void,
  }

Slack message event:
  {
    agentName, prompt,
    metadata: { channelId, threadTs, messageTs, userId, wasMentioned },
    reply: (content) => Promise<void>,
    startProcessingIndicator: () => () => void,
  }

Linear message event (proposed):
  {
    agentName, prompt,
    metadata: {
      issueId,            // The Linear issue ID (UUID)
      issueIdentifier,    // Human-readable identifier (e.g., "ENG-123")
      commentId,          // The comment ID that triggered this (null for new issues)
      teamId,             // Team the issue belongs to
      projectId,          // Project (if any)
      userId,             // User who created the issue or comment
      username,           // Display name of the user
      priority,           // Issue priority (0-4)
      labels,             // Array of label names
      triggerType,        // "issue_created" | "comment_added" | "issue_assigned" | "status_changed"
    },
    issueContext: {
      title,              // Issue title
      description,        // Issue description (markdown)
      comments,           // Recent comments (conversation history)
      parentIssue,        // Parent issue info (if sub-issue)
      linkedIssues,       // Related issues
    },
    reply: (content: string) => Promise<void>,
    updateStatus: (stateId: string) => Promise<void>,
    startProcessingIndicator: () => () => void,
  }
```

---

## 4. Which Issues Spawn Sessions

### Decision Matrix

Not every issue should trigger an agent session. The connector needs clear rules for which issues are "work for the agent" vs background noise.

```
                                                Should Spawn Session?
                                                --------------------
Issue created by human, assigned to agent       -> YES
Issue created by human, in agent's team         -> YES (if configured)
Issue created by human, with agent's label      -> YES
Issue with comment mentioning agent             -> YES (resume or new)
Issue created by the agent itself               -> NO (for this agent)
Issue created by agent, assigned to OTHER agent -> YES (for the other agent)
Issue in a team not configured for any agent    -> NO
Issue already being worked (status: Done)       -> NO (unless reopened)
```

### Configuration-Based Filtering

Each agent declares which issues it should pick up via filters:

```yaml
agents:
  - name: coder
    chat:
      linear:
        # Filter 1: Explicit assignment
        # The agent picks up any issue assigned to its Linear user
        assignee_id: "usr_abc123"

        # Filter 2: Team-based
        # The agent picks up unassigned issues in these teams
        teams:
          - key: "ENG"
            auto_assign: true    # Auto-assign matching issues to the agent

        # Filter 3: Label-based
        # The agent picks up issues with specific labels
        labels:
          - "agent:coder"
          - "auto-fix"

        # Filter 4: Project-based (optional)
        projects:
          - id: "proj_xyz"
```

### Filter Evaluation Logic

```
For each incoming issue event:
  1. Is this issue created by this agent's API user? -> SKIP (self-created)
  2. Is this issue explicitly assigned to this agent's assignee_id? -> MATCH
  3. Does this issue belong to one of the agent's configured teams? -> MATCH
  4. Does this issue have one of the agent's configured labels? -> MATCH
  5. Does this issue belong to one of the agent's configured projects? -> MATCH
  6. No match -> IGNORE
```

If multiple agents match the same issue (e.g., two agents watch the same team), the first match wins, or the issue must be explicitly assigned to disambiguate. This is configurable:

```yaml
linear:
  conflict_resolution: "first_match"  # or "require_assignment"
```

---

## 5. Interaction Model

### Trigger Events

The agent is triggered by the following Linear events:

#### 1. New Issue Created (matching filters)

```
User creates ENG-42: "Fix auth token expiry bug"
  -> LinearConnector receives webhook: Issue.create
  -> Matches agent "coder" (team: ENG)
  -> New session created, keyed by issue ID
  -> Agent receives prompt = issue title + description
  -> Agent starts working
```

#### 2. New Comment on Active Issue

```
User comments on ENG-42: "Also check the refresh token path"
  -> LinearConnector receives webhook: Comment.create
  -> Looks up session by issue ID -> found
  -> Session resumed with new message
  -> Agent receives prompt = comment body
  -> Agent continues working with added context
```

#### 3. Issue Assigned to Agent

```
User assigns ENG-43 to the agent
  -> LinearConnector receives webhook: Issue.update (assignee changed)
  -> Matches agent "coder" (assignee_id match)
  -> New session created
  -> Agent receives prompt = issue title + description
```

#### 4. Issue Status Changed

```
User moves ENG-42 to "In Review"
  -> LinearConnector receives webhook: Issue.update (state changed)
  -> Optional: agent can be configured to respond to status changes
  -> Useful for: "review my PR", "run tests", etc.
```

### Agent Response Actions

When the agent has output to deliver:

```
Agent Action                    Linear API Call
-----------                    ---------------
Post a status update           createComment({ issueId, body })
Mark work as started           updateIssue({ id, stateId: "in_progress" })
Mark work as done              updateIssue({ id, stateId: "done" })
Create a sub-task              createIssue({ parentId, title, ... })
Link a PR                      createAttachment({ issueId, url, ... })
Update issue description       updateIssue({ id, description })
Add a label                    updateIssue({ id, labelIds: [...] })
Set priority                   updateIssue({ id, priority })
```

### Processing Indicator

Unlike Discord (typing indicator) and Slack (hourglass emoji), Linear uses **issue status** as the processing indicator:

```
Issue enters session:
  -> Agent updates issue status to "In Progress"
  -> Agent posts comment: "Working on this..."

Agent completes work:
  -> Agent posts comment with summary of work done
  -> Agent updates issue status to "Done" (or "In Review" if PR created)
  -> Agent links PR if one was created
```

Optionally, for long-running tasks, the agent can post intermediate comments:

```
[2 minutes in]  "Analyzing the codebase for auth token usage..."
[5 minutes in]  "Found 3 files that need changes. Working on fix..."
[8 minutes in]  "Changes complete. Creating PR..."
```

---

## 6. Connector Architecture

### Architecture Diagram

```
                        +-------------------+
                        |   Linear Webhook   |
                        |   or Polling Loop  |
                        +--------+----------+
                                 |
                                 v
+----------------------------------------------------------------+
|                      LinearConnector                            |
|  (extends EventEmitter, implements ILinearConnector)            |
|                                                                |
|  +------------------+    +-----------------------------+       |
|  | Linear SDK Client|    | Issue Filter / Router       |       |
|  | (@linear/sdk)    |    |                             |       |
|  +------------------+    | For each event:             |       |
|                          |   1. Is self-created? skip  |       |
|                          |   2. Match agent filters    |       |
|                          |   3. Route to agent         |       |
|                          +-----------------------------+       |
|                                                                |
|  +----------------------------------------------------------+ |
|  | Session Managers: Map<agentName, LinearSessionManager>    | |
|  |                                                           | |
|  |  "coder" -> SessionManager (issues: { ENG-42: session })  | |
|  |  "reviewer" -> SessionManager (issues: { ENG-50: ... })   | |
|  +----------------------------------------------------------+ |
|                                                                |
|  Events emitted:                                               |
|    "message" -> { agentName, prompt, metadata, reply, ... }    |
|    "error"   -> { agentName, error }                           |
|    "ready"   -> { }                                            |
+----------------------------------------------------------------+
         |
         v
+----------------------------------------------------------------+
|                      LinearManager (in @herdctl/core)           |
|                                                                |
|  Subscribes to LinearConnector events                          |
|  Handles message -> trigger pipeline:                          |
|    1. Get/create session for issue                             |
|    2. Build prompt from issue context                          |
|    3. Create StreamingResponder                                |
|    4. Call fleetManager.trigger(agentName, ...)                |
|    5. Stream responses as Linear comments                      |
|    6. Update issue status on completion                        |
|    7. Store session for conversation continuity                |
+----------------------------------------------------------------+
         |
         v
+----------------------------------------------------------------+
|                      FleetManager                              |
|                                                                |
|  linearManager = new LinearManager(this)                       |
|  initialize() -> linearManager.initialize()                    |
|  start()      -> linearManager.start()                         |
|  stop()       -> linearManager.stop()                          |
+----------------------------------------------------------------+
```

### LinearConnector Class

```typescript
/**
 * LinearConnector - Connects agents to Linear
 *
 * Single connector shared across all agents (like Slack).
 * Routes issues to agents based on team, label, assignment filters.
 * Receives events via webhooks or polling.
 */
export class LinearConnector extends EventEmitter implements ILinearConnector {
  // Linear SDK client for API calls
  private client: LinearClient | null = null;

  // Agent routing: determines which agent handles which issues
  private agentFilters: Map<string, LinearAgentFilter>;

  // Session managers per agent
  private sessionManagers: Map<string, ILinearSessionManager>;

  // Webhook server (if using webhooks)
  private webhookServer: WebhookServer | null = null;

  // Polling interval (if using polling)
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  // Connection state
  private status: LinearConnectionStatus = "disconnected";
  private connectedAt: string | null = null;
  private lastError: string | null = null;

  // The Linear user ID of the API key (for self-created issue detection)
  private apiUserId: string | null = null;

  // Active issues being tracked (issueId -> agentName)
  private activeIssues: Map<string, string> = new Map();

  // Message stats
  private messagesReceived: number = 0;
  private messagesSent: number = 0;
  private messagesIgnored: number = 0;

  constructor(options: LinearConnectorOptions) {
    super();
    this.agentFilters = options.agentFilters;
    this.sessionManagers = options.sessionManagers;
    // ...
  }

  async connect(): Promise<void> { /* ... */ }
  async disconnect(): Promise<void> { /* ... */ }
  isConnected(): boolean { /* ... */ }
  getState(): LinearConnectorState { /* ... */ }
}
```

### LinearSessionManager

Follows the same pattern as Discord and Slack session managers, keyed by issue ID:

```typescript
/**
 * Session manager for Linear issue conversations
 *
 * Sessions are stored at .herdctl/linear-sessions/<agent-name>.yaml
 * Keyed by issueId (unlike Discord's channelId or Slack's threadTs)
 */
export class SessionManager implements ILinearSessionManager {
  readonly agentName: string;

  private readonly stateDir: string;
  private readonly sessionExpiryHours: number;
  private readonly logger: SessionManagerLogger;
  private readonly stateFilePath: string;
  private state: LinearSessionState | null = null;

  constructor(options: SessionManagerOptions) {
    this.agentName = options.agentName;
    this.stateDir = options.stateDir;
    this.sessionExpiryHours = options.sessionExpiryHours ?? 168; // 7 days default
    // ...
    this.stateFilePath = join(
      this.stateDir,
      "linear-sessions",
      `${this.agentName}.yaml`
    );
  }

  async getOrCreateSession(issueId: string, issueIdentifier: string): Promise<SessionResult>;
  async getSession(issueId: string): Promise<IssueSession | null>;
  async setSession(issueId: string, sessionId: string, issueIdentifier: string): Promise<void>;
  async touchSession(issueId: string): Promise<void>;
  async clearSession(issueId: string): Promise<boolean>;
  async cleanupExpiredSessions(): Promise<number>;
  async getActiveSessionCount(): Promise<number>;
}
```

**Notable difference from Discord/Slack**: The default session expiry is **7 days** (168 hours) instead of 24 hours. Linear issues are longer-lived than chat conversations; an issue might be worked on over multiple days with gaps between comments.

### Session State Schema

```typescript
export const IssueSessionSchema = z.object({
  /** Claude session ID for resuming conversations */
  sessionId: z.string().min(1),

  /** ISO timestamp when last activity occurred */
  lastActivityAt: z.string().datetime(),

  /** Human-readable issue identifier (e.g., "ENG-123") */
  issueIdentifier: z.string().min(1),

  /** Team key for quick lookup */
  teamKey: z.string().optional(),

  /** Git branch name if worktree strategy is active */
  branchName: z.string().optional(),
});

export const LinearSessionStateSchema = z.object({
  version: z.literal(1),
  agentName: z.string().min(1),
  /** Map of issue ID (UUID) to session info */
  issues: z.record(z.string(), IssueSessionSchema),
});
```

---

## 7. Session Lifecycle

### State Machine

```
                     Issue Created / Assigned
                              |
                              v
                       +------+------+
                       |   CREATED   |
                       +------+------+
                              |
                    Agent picks up issue
                    Sets status: "In Progress"
                              |
                              v
                       +------+------+
                       |   ACTIVE    |<---------+
                       +------+------+          |
                              |                 |
              +---------------+----------+      |
              |               |          |      |
         Comment added   Agent working   |   Issue reopened
              |               |          |      |
              v               v          |      |
        Resume session   (streaming)     |      |
              |               |          |      |
              +-------+-------+          |      |
                      |                  |      |
                      v                  |      |
               +------+------+          |      |
               |  COMPLETED  |----------+      |
               +------+------+                 |
                      |                        |
            Issue closed / merged              |
                      |                        |
                      v                        |
               +------+------+                 |
               |   CLOSED    +---------->------+
               +-------------+
                   (reopened)
```

### Lifecycle Events

| Event | Session Action | Linear API Action |
|-------|---------------|-------------------|
| Issue created/assigned (matching filter) | Create new session | Post welcome comment, set status "In Progress" |
| Comment added by user | Resume session with new prompt | N/A |
| Agent produces output | N/A | Post comment with output |
| Agent completes work | Mark session complete | Set status "Done" or "In Review", link PR |
| Agent encounters error | Log error, keep session | Post error comment, set status "Triage" |
| Issue closed | End session, cleanup | N/A |
| Issue reopened | Resume or create new session | Post comment acknowledging reopen |
| Session expired (no activity) | Cleanup session | N/A (leave issue as-is) |

### Prompt Construction

When a session starts (new issue), the prompt is constructed from the issue's full context:

```
Title: Fix auth token expiry bug
Priority: High
Labels: bug, auth

Description:
The auth tokens are not being refreshed properly when they expire.
Users are getting logged out after 1 hour even though refresh tokens
should extend the session.

---

Please fix this issue. Create a branch, make the necessary code changes,
and create a PR when done.
```

When a session resumes (new comment), the prompt is the comment body, with the issue context available in the session history:

```
Also check the refresh token path - I think the issue might be in
the token rotation logic in src/auth/refresh.ts
```

---

## 8. Agent Self-Created Issues

### The Problem

An agent working on ENG-42 might create sub-issues:

```
ENG-42: Fix auth token expiry bug     (assigned to agent, triggers session)
  ENG-43: Refactor token refresh logic (created BY agent, should NOT trigger same agent)
  ENG-44: Add token expiry tests       (created BY agent, should NOT trigger same agent)
```

If ENG-43 and ENG-44 triggered new sessions for the same agent, it would create an infinite loop.

### The Solution

**Detection via Linear API user identity:**

When the connector initializes, it resolves the API key's user ID:

```typescript
async connect(): Promise<void> {
  this.client = new LinearClient({ apiKey: this.apiKey });

  // Resolve the API user (the "bot" identity)
  const viewer = await this.client.viewer;
  this.apiUserId = viewer.id;
  this.apiUsername = viewer.displayName;
}
```

When an issue event arrives:

```typescript
private shouldProcessIssue(issue: LinearIssue, agentName: string): boolean {
  // Rule 1: Never process issues created by this connector's API user
  //         for the agent that created them
  if (issue.creator?.id === this.apiUserId) {
    // But DO allow other agents to pick up agent-created issues
    // if those issues are assigned to them
    const assignedAgent = this.resolveAgentByAssignee(issue);
    if (assignedAgent === agentName || !assignedAgent) {
      return false; // Self-created, skip
    }
  }

  return true;
}
```

### Multi-Agent Self-Creation

```
Agent "coder" creates ENG-43 and assigns it to agent "tester"
  -> ENG-43.creator.id === coder's API user ID
  -> "coder" should NOT pick up ENG-43 (self-created)
  -> "tester" SHOULD pick up ENG-43 (assigned to it)
```

If all agents share the same API key (common in Linear), disambiguation happens via assignment or labels:

```yaml
agents:
  - name: coder
    chat:
      linear:
        assignee_id: "usr_coder_123"  # Linear member mapped to this agent
        labels: ["agent:coder"]

  - name: tester
    chat:
      linear:
        assignee_id: "usr_tester_456"
        labels: ["agent:tester"]
```

When the coder agent creates a sub-issue for the tester:

```typescript
// Agent "coder" creates a sub-issue via tool use:
await linearClient.createIssue({
  title: "Add token expiry tests",
  teamId: "team_eng",
  parentId: parentIssueId,
  assigneeId: "usr_tester_456",    // Assigned to tester agent
  labelIds: ["label_agent_tester"], // Labeled for tester agent
});
```

---

## 9. Integration with Worktree Strategy

Linear is the **ideal** use case for the git worktree strategy described in `006-worktree-strategy-research.md`. Each issue naturally maps to a branch and worktree.

### Issue-to-Branch Mapping

```
Issue: ENG-123 "Fix auth token expiry"
  -> Branch: agent/coder/eng-123-fix-auth-token-expiry
  -> Worktree: .worktrees/eng-123

Issue: ENG-124 "Add rate limiting"
  -> Branch: agent/coder/eng-124-add-rate-limiting
  -> Worktree: .worktrees/eng-124
```

### Branch Naming

```typescript
function buildBranchName(agent: ResolvedAgent, issue: LinearIssue): string {
  const prefix = agent.linear?.branch_prefix ?? `agent/${agent.name}`;
  const identifier = issue.identifier.toLowerCase(); // "eng-123"
  const slug = slugify(issue.title, { maxLength: 40 }); // "fix-auth-token-expiry"
  return `${prefix}/${identifier}-${slug}`;
}
```

### Lifecycle Integration

```
1. Issue ENG-123 assigned to agent "coder"
   -> LinearConnector emits "message" event

2. LinearManager.handleMessage()
   -> WorkspaceStrategy.setup(agent, { issueIdentifier: "ENG-123", ... })
   -> Creates worktree at .worktrees/eng-123
   -> Creates branch agent/coder/eng-123-fix-auth-token-expiry

3. FleetManager.trigger("coder", { prompt, cwd: worktreePath })
   -> Agent works in the worktree

4. Job completes
   -> WorkspaceStrategy.teardown()
   -> Commits changes, pushes branch, creates PR
   -> PR description references ENG-123
   -> Links PR to Linear issue via attachment

5. Issue closed (after PR merge)
   -> LinearConnector receives Issue.update (state: Done)
   -> Cleanup: remove worktree, optionally delete branch
   -> Clear session
```

### Configuration for Worktree Integration

```yaml
agents:
  - name: coder
    working_directory:
      root: /home/dev/myrepo
      strategy: git_worktree           # Enable worktree strategy
      default_branch: main
      worktree_dir: .worktrees         # Where worktrees are created
      branch_prefix: "agent/coder"     # Prefix for branch names
      auto_pr: true                    # Auto-create PR on completion
      cleanup_on_close: true           # Remove worktree when issue closes
    chat:
      linear:
        teams:
          - key: "ENG"
```

---

## 10. Configuration Schema

### Full Configuration Example

```yaml
agents:
  - name: coder
    model: claude-sonnet-4-20250514
    prompt: |
      You are a coding agent. When given a Linear issue, you should:
      1. Read the issue description carefully
      2. Analyze the codebase to understand the problem
      3. Make the necessary code changes
      4. Write or update tests
      5. Create a PR with a clear description
    working_directory:
      root: /home/dev/myrepo
      strategy: git_worktree
      default_branch: main
    chat:
      linear:
        # Authentication
        api_key_env: LINEAR_API_KEY           # Env var containing the Linear API key

        # Session management
        session_expiry_hours: 168             # 7 days (issues are longer-lived)

        # Logging
        log_level: standard                   # minimal | standard | verbose

        # Issue routing filters (any match triggers a session)
        assignee_id: "usr_abc123"             # Pick up issues assigned to this user
        teams:                                # Pick up issues in these teams
          - key: "ENG"
            auto_assign: true                 # Auto-assign unassigned matching issues
            states:                           # Only pick up issues in these states
              - "Triage"
              - "Todo"
            exclude_labels:                   # Skip issues with these labels
              - "wontfix"
              - "manual-only"
        labels:                               # Pick up issues with these labels
          - "agent:coder"
          - "auto-fix"
        projects:                             # Pick up issues in these projects
          - id: "proj_xyz"

        # Agent behavior
        welcome_comment: true                 # Post a comment when picking up an issue
        update_status: true                   # Update issue status (In Progress, Done)
        create_pr_link: true                  # Link PRs to issues

        # Event configuration
        event_mode: webhook                   # webhook | polling
        webhook_port: 3100                    # Port for webhook receiver
        webhook_path: /linear/webhook         # Path for webhook endpoint
        webhook_secret_env: LINEAR_WEBHOOK_SECRET  # Env var for webhook signing secret
        polling_interval_seconds: 30          # Polling interval (if event_mode: polling)

  - name: reviewer
    model: claude-sonnet-4-20250514
    prompt: |
      You are a code review agent. When an issue moves to "In Review",
      review the associated PR and provide feedback.
    chat:
      linear:
        api_key_env: LINEAR_API_KEY
        teams:
          - key: "ENG"
            states:
              - "In Review"                   # Only pick up issues in "In Review"
        labels:
          - "agent:reviewer"
```

### Zod Schema

```typescript
export const LinearTeamFilterSchema = z.object({
  /** Team key (e.g., "ENG") */
  key: z.string(),
  /** Auto-assign unassigned issues matching this filter to the agent */
  auto_assign: z.boolean().default(false),
  /** Only match issues in these workflow states */
  states: z.array(z.string()).optional(),
  /** Skip issues with these labels */
  exclude_labels: z.array(z.string()).optional(),
});

export const LinearProjectFilterSchema = z.object({
  /** Project ID (UUID) */
  id: z.string(),
});

export const AgentChatLinearSchema = z.object({
  /** Environment variable name containing the Linear API key */
  api_key_env: z.string().default("LINEAR_API_KEY"),
  /** Session expiry in hours (default: 168 = 7 days) */
  session_expiry_hours: z.number().int().positive().default(168),
  /** Log level */
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),

  /** Linear user ID to match for assignment-based routing */
  assignee_id: z.string().optional(),
  /** Team-based filters */
  teams: z.array(LinearTeamFilterSchema).optional(),
  /** Label-based filters */
  labels: z.array(z.string()).optional(),
  /** Project-based filters */
  projects: z.array(LinearProjectFilterSchema).optional(),

  /** Post a welcome comment when picking up an issue */
  welcome_comment: z.boolean().default(true),
  /** Update issue status when working */
  update_status: z.boolean().default(true),
  /** Link PRs to issues */
  create_pr_link: z.boolean().default(true),

  /** Event delivery mode */
  event_mode: z.enum(["webhook", "polling"]).default("webhook"),
  /** Port for webhook HTTP server */
  webhook_port: z.number().int().positive().default(3100),
  /** Path for webhook endpoint */
  webhook_path: z.string().default("/linear/webhook"),
  /** Env var for webhook signing secret */
  webhook_secret_env: z.string().default("LINEAR_WEBHOOK_SECRET"),
  /** Polling interval in seconds (only used if event_mode is "polling") */
  polling_interval_seconds: z.number().int().positive().default(30),
});
```

### Adding to AgentChatSchema

```typescript
export const AgentChatSchema = z.object({
  discord: AgentChatDiscordSchema.optional(),
  slack: AgentChatSlackSchema.optional(),
  linear: AgentChatLinearSchema.optional(),  // NEW
});
```

---

## 11. Package Structure

Following the established pattern from Discord and Slack packages:

```
packages/linear/
  package.json                           # @herdctl/linear
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                             # Package exports
    linear-connector.ts                  # LinearConnector class
    types.ts                             # All connector types/interfaces
    errors.ts                            # Error classes with enum codes
    error-handler.ts                     # ErrorHandler class, withRetry
    logger.ts                            # LinearLogger with level filtering
    issue-handler.ts                     # Issue event processing, filter matching
    webhook-server.ts                    # HTTP webhook receiver
    polling.ts                           # Polling fallback
    session-manager/
      session-manager.ts                 # SessionManager class (keyed by issueId)
      types.ts                           # Session types, Zod schemas
      errors.ts                          # Session-specific error classes
      index.ts                           # Session exports
    commands/
      command-handler.ts                 # Comment-based commands (!status, !reset)
      help.ts                            # !help command
      reset.ts                           # !reset command
      status.ts                          # !status command
      index.ts                           # Command exports
    __tests__/
      linear-connector.test.ts
      issue-handler.test.ts
      webhook-server.test.ts
      polling.test.ts
      error-handler.test.ts
      errors.test.ts
      logger.test.ts
      session-manager.test.ts
      command-handler.test.ts
```

### Dependencies

```json
{
  "name": "@herdctl/linear",
  "version": "0.1.0",
  "dependencies": {
    "@linear/sdk": "^28.0.0",
    "yaml": "^2.x",
    "zod": "^3.x"
  },
  "peerDependencies": {
    "@herdctl/core": "^3.x"
  },
  "devDependencies": {
    "vitest": "^2.x",
    "typescript": "^5.x"
  }
}
```

---

## 12. Code Structure Proposals

### LinearConnector (Main Class)

```typescript
import { EventEmitter } from "node:events";
import { LinearClient } from "@linear/sdk";
import type {
  LinearConnectorOptions,
  LinearConnectorState,
  LinearConnectionStatus,
  LinearConnectorLogger,
  ILinearConnector,
  LinearConnectorEventMap,
  LinearConnectorEventName,
  LinearMessageEvent,
} from "./types.js";
import { AlreadyConnectedError, LinearConnectionError } from "./errors.js";
import { ErrorHandler } from "./error-handler.js";
import { IssueHandler } from "./issue-handler.js";
import { WebhookServer } from "./webhook-server.js";
import { Poller } from "./polling.js";
import type { ILinearSessionManager } from "./session-manager/index.js";

export class LinearConnector extends EventEmitter implements ILinearConnector {
  private readonly apiKey: string;
  private readonly agentFilters: Map<string, LinearAgentFilter>;
  private readonly sessionManagers: Map<string, ILinearSessionManager>;
  private readonly logger: LinearConnectorLogger;
  private readonly errorHandler: ErrorHandler;
  private readonly eventMode: "webhook" | "polling";

  private client: LinearClient | null = null;
  private issueHandler: IssueHandler | null = null;
  private webhookServer: WebhookServer | null = null;
  private poller: Poller | null = null;

  private status: LinearConnectionStatus = "disconnected";
  private connectedAt: string | null = null;
  private disconnectedAt: string | null = null;
  private lastError: string | null = null;
  private apiUserId: string | null = null;
  private apiUsername: string | null = null;

  private activeIssues: Map<string, string> = new Map(); // issueId -> agentName
  private messagesReceived: number = 0;
  private messagesSent: number = 0;
  private messagesIgnored: number = 0;

  constructor(options: LinearConnectorOptions) {
    super();
    this.apiKey = options.apiKey;
    this.agentFilters = options.agentFilters;
    this.sessionManagers = options.sessionManagers;
    this.eventMode = options.eventMode ?? "webhook";
    this.logger = options.logger ?? createDefaultLinearLogger();
    this.errorHandler = new ErrorHandler({
      logger: this.logger,
    });

    if (!this.apiKey || this.apiKey.trim() === "") {
      throw new LinearConnectionError("Linear API key cannot be empty");
    }
  }

  async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      throw new AlreadyConnectedError();
    }

    this.status = "connecting";
    this.logger.info("Connecting to Linear...");

    try {
      // Initialize Linear SDK client
      this.client = new LinearClient({ apiKey: this.apiKey });

      // Resolve API user identity (for self-created issue detection)
      const viewer = await this.client.viewer;
      this.apiUserId = viewer.id;
      this.apiUsername = viewer.displayName;

      // Initialize issue handler (filter + routing logic)
      this.issueHandler = new IssueHandler({
        client: this.client,
        agentFilters: this.agentFilters,
        apiUserId: this.apiUserId,
        activeIssues: this.activeIssues,
        logger: this.logger,
      });

      // Start event listener (webhook or polling)
      if (this.eventMode === "webhook") {
        await this.startWebhookServer();
      } else {
        this.startPolling();
      }

      // Cleanup expired sessions on connect
      for (const [agentName, sm] of this.sessionManagers) {
        try {
          const cleaned = await sm.cleanupExpiredSessions();
          if (cleaned > 0) {
            this.logger.info("Cleaned up expired sessions on startup", {
              agent: agentName,
              count: cleaned,
            });
          }
        } catch (error) {
          this.logger.warn("Failed to clean up expired sessions", {
            agent: agentName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.status = "connected";
      this.connectedAt = new Date().toISOString();
      this.lastError = null;

      this.logger.info("Connected to Linear", {
        apiUser: this.apiUsername,
        apiUserId: this.apiUserId,
        eventMode: this.eventMode,
        agentCount: this.agentFilters.size,
      });

      this.emit("ready", {
        apiUser: { id: this.apiUserId, displayName: this.apiUsername },
      });
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to connect to Linear", {
        error: this.lastError,
      });

      this.client = null;
      throw new LinearConnectionError(
        `Failed to connect to Linear: ${this.lastError}`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.status === "disconnected" || this.status === "disconnecting") {
      return;
    }

    this.status = "disconnecting";
    this.logger.info("Disconnecting from Linear...");

    try {
      if (this.webhookServer) {
        await this.webhookServer.stop();
        this.webhookServer = null;
      }

      if (this.poller) {
        this.poller.stop();
        this.poller = null;
      }

      this.client = null;
      this.issueHandler = null;
      this.status = "disconnected";
      this.disconnectedAt = new Date().toISOString();

      this.logger.info("Disconnected from Linear", {
        messagesReceived: this.messagesReceived,
        messagesSent: this.messagesSent,
        messagesIgnored: this.messagesIgnored,
      });
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("Error during disconnect", {
        error: this.lastError,
      });
    }
  }

  isConnected(): boolean {
    return this.status === "connected" && this.client !== null;
  }

  getState(): LinearConnectorState {
    return {
      status: this.status,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      lastError: this.lastError,
      apiUser: this.apiUserId
        ? { id: this.apiUserId, displayName: this.apiUsername ?? "unknown" }
        : null,
      eventMode: this.eventMode,
      activeIssueCount: this.activeIssues.size,
      messageStats: {
        received: this.messagesReceived,
        sent: this.messagesSent,
        ignored: this.messagesIgnored,
      },
    };
  }

  // =========================================================================
  // Event Handling
  // =========================================================================

  /**
   * Handle an incoming Linear event (from webhook or polling)
   *
   * Routes the event to the appropriate agent based on configured filters.
   */
  async handleLinearEvent(event: LinearWebhookEvent): Promise<void> {
    this.messagesReceived++;

    if (!this.issueHandler || !this.client) {
      this.logger.warn("Received event but not connected");
      return;
    }

    try {
      const routingResult = await this.issueHandler.routeEvent(event);

      if (!routingResult) {
        this.messagesIgnored++;
        this.logger.debug("Event did not match any agent filter", {
          type: event.type,
          action: event.action,
        });
        return;
      }

      const { agentName, prompt, metadata, issueContext } = routingResult;

      // Track this issue for future event routing
      this.activeIssues.set(metadata.issueId, agentName);

      // Build reply function
      const reply = async (content: string): Promise<void> => {
        if (!this.client) return;
        await this.client.createComment({
          issueId: metadata.issueId,
          body: content,
        });
        this.messagesSent++;
      };

      // Build status update function
      const updateStatus = async (stateId: string): Promise<void> => {
        if (!this.client) return;
        await this.client.updateIssue(metadata.issueId, { stateId });
      };

      // Build processing indicator (set status to "In Progress")
      const startProcessingIndicator = (): (() => void) => {
        if (this.client && metadata.triggerType === "issue_created") {
          // Set status to "In Progress" when starting work
          this.client
            .updateIssue(metadata.issueId, {
              stateId: metadata.inProgressStateId,
            })
            .catch(() => {
              // Ignore status update errors
            });
        }

        return () => {
          // No-op stop function (status is set once, not periodic)
        };
      };

      // Emit message event
      const messageEvent: LinearMessageEvent = {
        agentName,
        prompt,
        metadata,
        issueContext,
        reply,
        updateStatus,
        startProcessingIndicator,
      };

      this.emit("message", messageEvent);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("Error handling Linear event", {
        error: err.message,
        type: event.type,
      });
      this.emit("error", { error: err });
    }
  }

  // =========================================================================
  // Type-safe event emitter overrides
  // =========================================================================

  override emit<K extends LinearConnectorEventName>(
    event: K,
    payload: LinearConnectorEventMap[K]
  ): boolean {
    return super.emit(event, payload);
  }

  override on<K extends LinearConnectorEventName>(
    event: K,
    listener: (payload: LinearConnectorEventMap[K]) => void
  ): this {
    return super.on(event, listener);
  }

  override once<K extends LinearConnectorEventName>(
    event: K,
    listener: (payload: LinearConnectorEventMap[K]) => void
  ): this {
    return super.once(event, listener);
  }

  // ... private methods for webhook/polling setup
}
```

### IssueHandler (Filter and Routing)

```typescript
/**
 * IssueHandler processes Linear events and routes them to agents
 *
 * Responsibilities:
 * - Parse webhook/polling events into structured issue events
 * - Evaluate agent filters to determine routing
 * - Detect self-created issues
 * - Build prompt and context from issue data
 */
export class IssueHandler {
  private client: LinearClient;
  private agentFilters: Map<string, LinearAgentFilter>;
  private apiUserId: string;
  private activeIssues: Map<string, string>;
  private logger: LinearConnectorLogger;

  constructor(options: IssueHandlerOptions) { /* ... */ }

  /**
   * Route an incoming event to an agent
   *
   * Returns null if the event does not match any agent's filters.
   */
  async routeEvent(event: LinearWebhookEvent): Promise<RoutingResult | null> {
    switch (event.type) {
      case "Issue":
        return this.handleIssueEvent(event);
      case "Comment":
        return this.handleCommentEvent(event);
      default:
        return null;
    }
  }

  private async handleIssueEvent(
    event: LinearWebhookEvent
  ): Promise<RoutingResult | null> {
    const { action, data } = event;

    // Issue created or updated (assignment changed, status changed)
    if (action === "create" || action === "update") {
      const issueId = data.id;

      // Check if this is a self-created issue
      if (data.creatorId === this.apiUserId) {
        // Only allow if assigned to a DIFFERENT agent
        const assignedAgent = this.findAgentByAssignee(data.assigneeId);
        if (!assignedAgent) {
          return null; // Self-created, no other agent assigned
        }
      }

      // Check active issues first (for updates to tracked issues)
      const existingAgent = this.activeIssues.get(issueId);
      if (existingAgent && action === "update") {
        return this.buildRoutingResult(existingAgent, data, "status_changed");
      }

      // Evaluate filters for new issues
      const matchedAgent = this.evaluateFilters(data);
      if (!matchedAgent) {
        return null;
      }

      const triggerType = action === "create" ? "issue_created" : "issue_assigned";
      return this.buildRoutingResult(matchedAgent, data, triggerType);
    }

    return null;
  }

  private async handleCommentEvent(
    event: LinearWebhookEvent
  ): Promise<RoutingResult | null> {
    const { data } = event;
    const issueId = data.issueId ?? data.issue?.id;

    if (!issueId) return null;

    // Only process comments on issues we are tracking
    const agentName = this.activeIssues.get(issueId);
    if (!agentName) return null;

    // Ignore comments from the bot itself
    if (data.userId === this.apiUserId) return null;

    // Build routing result with comment as prompt
    const issue = await this.client.issue(issueId);
    return this.buildRoutingResult(agentName, issue, "comment_added", data.body);
  }

  private evaluateFilters(issueData: LinearIssueData): string | null {
    for (const [agentName, filter] of this.agentFilters) {
      if (this.matchesFilter(issueData, filter)) {
        return agentName;
      }
    }
    return null;
  }

  private matchesFilter(
    issue: LinearIssueData,
    filter: LinearAgentFilter
  ): boolean {
    // Check assignee match
    if (filter.assigneeId && issue.assigneeId === filter.assigneeId) {
      return true;
    }

    // Check team match
    if (filter.teams) {
      for (const teamFilter of filter.teams) {
        if (issue.teamKey === teamFilter.key) {
          // Check state filter
          if (teamFilter.states && !teamFilter.states.includes(issue.stateName)) {
            continue;
          }
          // Check exclude labels
          if (teamFilter.excludeLabels) {
            const issueLabels = issue.labels ?? [];
            if (issueLabels.some((l) => teamFilter.excludeLabels!.includes(l))) {
              continue;
            }
          }
          return true;
        }
      }
    }

    // Check label match
    if (filter.labels) {
      const issueLabels = issue.labels ?? [];
      if (filter.labels.some((l) => issueLabels.includes(l))) {
        return true;
      }
    }

    // Check project match
    if (filter.projects) {
      if (issue.projectId && filter.projects.some((p) => p.id === issue.projectId)) {
        return true;
      }
    }

    return false;
  }

  private async buildRoutingResult(
    agentName: string,
    issueData: LinearIssueData,
    triggerType: LinearTriggerType,
    commentBody?: string
  ): Promise<RoutingResult> {
    // Fetch full issue context
    const issue = await this.client.issue(issueData.id);
    const comments = await issue.comments();
    const team = await issue.team;

    // Build prompt
    let prompt: string;
    if (commentBody) {
      prompt = commentBody;
    } else {
      prompt = this.buildInitialPrompt(issue);
    }

    // Build issue context (conversation history)
    const issueContext: LinearIssueContext = {
      title: issue.title,
      description: issue.description ?? "",
      comments: comments.nodes.map((c) => ({
        body: c.body,
        userId: c.userId,
        createdAt: c.createdAt.toISOString(),
        isBot: c.userId === this.apiUserId,
      })),
      parentIssue: issue.parent
        ? { id: issue.parent.id, title: (await issue.parent).title }
        : null,
    };

    // Resolve the "In Progress" state ID for this team
    const states = await team?.states();
    const inProgressState = states?.nodes.find(
      (s) => s.name === "In Progress" || s.type === "started"
    );

    return {
      agentName,
      prompt,
      metadata: {
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        commentId: commentBody ? issueData.id : null,
        teamId: team?.id ?? "",
        teamKey: team?.key ?? "",
        projectId: issue.project?.id ?? null,
        userId: issueData.creatorId ?? issueData.userId ?? "",
        username: "",  // Resolved lazily if needed
        priority: issue.priority,
        labels: (await issue.labels()).nodes.map((l) => l.name),
        triggerType,
        inProgressStateId: inProgressState?.id ?? null,
      },
      issueContext,
    };
  }

  private buildInitialPrompt(issue: LinearIssue): string {
    const parts: string[] = [];

    parts.push(`# ${issue.identifier}: ${issue.title}`);

    if (issue.priority) {
      const priorityNames = ["No Priority", "Urgent", "High", "Normal", "Low"];
      parts.push(`**Priority:** ${priorityNames[issue.priority] ?? "Unknown"}`);
    }

    if (issue.description) {
      parts.push("");
      parts.push(issue.description);
    }

    return parts.join("\n");
  }
}
```

### WebhookServer

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";

/**
 * WebhookServer receives Linear webhook events via HTTP
 *
 * Linear sends signed webhook payloads to a configured URL.
 * This server validates the signature, parses the payload,
 * and forwards events to the LinearConnector.
 */
export class WebhookServer {
  private server: ReturnType<typeof createServer> | null = null;
  private readonly port: number;
  private readonly path: string;
  private readonly secret: string;
  private readonly onEvent: (event: LinearWebhookEvent) => Promise<void>;
  private readonly logger: LinearConnectorLogger;

  constructor(options: WebhookServerOptions) {
    this.port = options.port;
    this.path = options.path;
    this.secret = options.secret;
    this.onEvent = options.onEvent;
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          this.logger.error("Webhook request error", {
            error: error instanceof Error ? error.message : String(error),
          });
          res.writeHead(500);
          res.end("Internal Server Error");
        });
      });

      this.server.listen(this.port, () => {
        this.logger.info("Webhook server started", {
          port: this.port,
          path: this.path,
        });
        resolve();
      });

      this.server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info("Webhook server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    // Only accept POST to the configured path
    if (req.method !== "POST" || req.url !== this.path) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // Read body
    const body = await this.readBody(req);

    // Verify signature
    const signature = req.headers["linear-signature"] as string;
    if (!this.verifySignature(body, signature)) {
      this.logger.warn("Invalid webhook signature");
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    // Parse payload
    const event = JSON.parse(body) as LinearWebhookEvent;

    // Respond immediately (Linear expects 200 within 5s)
    res.writeHead(200);
    res.end("OK");

    // Process event asynchronously
    await this.onEvent(event);
  }

  private verifySignature(body: string, signature: string): boolean {
    if (!signature) return false;
    const hmac = createHmac("sha256", this.secret);
    hmac.update(body);
    const expected = hmac.digest("hex");
    return signature === expected;
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  }
}
```

### Polling Fallback

```typescript
/**
 * Poller - Fallback event source that polls Linear API for changes
 *
 * Used when webhooks cannot be deployed (e.g., no public URL).
 * Less efficient than webhooks but simpler to set up.
 */
export class Poller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastCheckedAt: Date;
  private readonly client: LinearClient;
  private readonly pollIntervalMs: number;
  private readonly onEvent: (event: LinearWebhookEvent) => Promise<void>;
  private readonly logger: LinearConnectorLogger;
  private readonly agentFilters: Map<string, LinearAgentFilter>;

  constructor(options: PollerOptions) {
    this.client = options.client;
    this.pollIntervalMs = (options.pollIntervalSeconds ?? 30) * 1000;
    this.onEvent = options.onEvent;
    this.logger = options.logger;
    this.agentFilters = options.agentFilters;
    this.lastCheckedAt = new Date();
  }

  start(): void {
    this.logger.info("Starting Linear polling", {
      intervalMs: this.pollIntervalMs,
    });

    // Initial poll
    this.poll().catch((err) => {
      this.logger.error("Initial poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Schedule recurring polls
    this.interval = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error("Poll failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.logger.info("Linear polling stopped");
  }

  private async poll(): Promise<void> {
    const since = this.lastCheckedAt;
    this.lastCheckedAt = new Date();

    // Collect team keys from filters
    const teamKeys = new Set<string>();
    for (const filter of this.agentFilters.values()) {
      if (filter.teams) {
        for (const t of filter.teams) {
          teamKeys.add(t.key);
        }
      }
    }

    // Query recently updated issues in relevant teams
    const issues = await this.client.issues({
      filter: {
        updatedAt: { gte: since.toISOString() },
        team: teamKeys.size > 0
          ? { key: { in: Array.from(teamKeys) } }
          : undefined,
      },
      first: 50,
    });

    for (const issue of issues.nodes) {
      // Synthesize a webhook-like event
      const event: LinearWebhookEvent = {
        type: "Issue",
        action: issue.createdAt >= since ? "create" : "update",
        data: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description,
          priority: issue.priority,
          creatorId: (await issue.creator)?.id,
          assigneeId: (await issue.assignee)?.id,
          teamKey: (await issue.team)?.key,
          stateName: (await issue.state)?.name,
          labels: (await issue.labels()).nodes.map((l) => l.name),
          projectId: (await issue.project)?.id,
        },
        createdAt: issue.updatedAt.toISOString(),
      };

      await this.onEvent(event);
    }

    // Also check for new comments on active issues
    // (this would require querying comments separately)
  }
}
```

---

## 13. Linear API Integration

### Which Linear SDK to Use

The official `@linear/sdk` package provides a typed GraphQL client. It supports all the operations we need:

| Operation | SDK Method | Use Case |
|-----------|-----------|----------|
| Get current user | `client.viewer` | Identify API user for self-created detection |
| Get issue | `client.issue(id)` | Fetch full issue context |
| Create comment | `client.createComment({ issueId, body })` | Post agent responses |
| Update issue | `client.updateIssue(id, { stateId, ... })` | Change status, add labels |
| Create issue | `client.createIssue({ ... })` | Agent creates sub-issues |
| Get team states | `team.states()` | Resolve "In Progress" state ID |
| Search issues | `client.issues({ filter })` | Polling: find updated issues |
| Get comments | `issue.comments()` | Build conversation history |

### API Key vs OAuth

Linear supports both API keys and OAuth tokens. For herdctl:

- **API Key** (recommended): Simple, long-lived, per-workspace. One key per workspace is all that's needed. Stored in an environment variable.
- **OAuth**: More complex, requires auth flow. Only needed if herdctl is a multi-tenant SaaS (not the current use case).

### Rate Limits

Linear API rate limits:

- **Complexity-based**: Each query has a complexity cost. Limit is 10,000 complexity points per hour.
- **Request rate**: 1,500 requests per minute.

For a single agent processing issues, these limits are generous. The connector should:

1. Track remaining complexity budget via response headers
2. Implement exponential backoff on 429 responses
3. Batch queries where possible (e.g., fetch multiple issues in one query)

---

## 14. Webhook vs Polling

### Comparison

| Aspect | Webhook | Polling |
|--------|---------|---------|
| Latency | Near-instant (~1s) | Up to polling interval (30s default) |
| API usage | Zero (Linear pushes) | Periodic queries consume rate limit |
| Setup | Requires public URL + webhook config | No external setup needed |
| Reliability | Can miss events if server is down | Catches up on restart |
| Complexity | HTTP server + signature verification | Simple interval + query |
| Deployment | Needs port exposed, DNS, SSL | Works behind NAT/firewall |

### Recommendation

**Webhook as primary, polling as fallback.**

- For production deployments with public URLs: use webhooks for real-time event delivery.
- For local development, testing, or environments without public URLs: use polling.

The configuration makes the choice explicit:

```yaml
chat:
  linear:
    event_mode: webhook    # or "polling"
```

### Webhook Setup in Linear

Linear webhooks are configured per-workspace:

1. Go to Settings > API > Webhooks
2. Create a webhook pointing to `https://your-server:3100/linear/webhook`
3. Select events: `Issue`, `Comment`
4. Copy the signing secret to the `LINEAR_WEBHOOK_SECRET` env var

For local development, tools like `ngrok` or `cloudflared` can expose the webhook endpoint.

---

## 15. Error Handling

### Error Classes

Following the Discord and Slack patterns:

```typescript
export enum LinearErrorCode {
  CONNECTION_FAILED = "LINEAR_CONNECTION_FAILED",
  ALREADY_CONNECTED = "LINEAR_ALREADY_CONNECTED",
  API_ERROR = "LINEAR_API_ERROR",
  WEBHOOK_ERROR = "LINEAR_WEBHOOK_ERROR",
  FILTER_ERROR = "LINEAR_FILTER_ERROR",
  SESSION_READ_ERROR = "LINEAR_SESSION_READ_ERROR",
  SESSION_WRITE_ERROR = "LINEAR_SESSION_WRITE_ERROR",
  ISSUE_NOT_FOUND = "LINEAR_ISSUE_NOT_FOUND",
  COMMENT_FAILED = "LINEAR_COMMENT_FAILED",
  STATUS_UPDATE_FAILED = "LINEAR_STATUS_UPDATE_FAILED",
}

export class LinearConnectorError extends Error {
  readonly code: LinearErrorCode;
  constructor(message: string, code: LinearErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.name = "LinearConnectorError";
    this.code = code;
  }
}

export class LinearConnectionError extends LinearConnectorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, LinearErrorCode.CONNECTION_FAILED, options);
    this.name = "LinearConnectionError";
  }
}

export class AlreadyConnectedError extends LinearConnectorError {
  constructor() {
    super("Linear connector is already connected", LinearErrorCode.ALREADY_CONNECTED);
    this.name = "AlreadyConnectedError";
  }
}

// ... similar pattern for other error types
```

### ErrorHandler Class

Port from Discord's `ErrorHandler` pattern:

```typescript
export class ErrorHandler {
  private errorCounts: Map<ErrorCategory, number> = new Map();
  private readonly logger: LinearConnectorLogger;

  handleError(error: unknown, context: string): string {
    const classified = classifyError(error);
    this.incrementCount(classified.category);
    this.logger.error(`Error ${context}`, {
      category: classified.category,
      message: classified.error.message,
      shouldRetry: classified.shouldRetry,
    });
    return classified.userMessage;
  }

  getErrorStats(): Map<ErrorCategory, number> {
    return new Map(this.errorCounts);
  }
}
```

---

## 16. FleetManager Integration

### LinearManager (in @herdctl/core)

```typescript
/**
 * LinearManager handles Linear connections for agents
 *
 * Like SlackManager, creates ONE shared connector with per-agent routing.
 * Dynamically imports @herdctl/linear at runtime.
 */
export class LinearManager {
  private connector: ILinearConnector | null = null;
  private sessionManagers: Map<string, ILinearSessionManager> = new Map();
  private agentFilters: Map<string, LinearAgentFilter> = new Map();
  private initialized: boolean = false;

  constructor(private ctx: FleetManagerContext) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const logger = this.ctx.getLogger();
    const config = this.ctx.getConfig();

    if (!config) {
      logger.debug("No config available, skipping Linear initialization");
      return;
    }

    const linearPkg = await importLinearPackage();
    if (!linearPkg) {
      logger.debug("@herdctl/linear not installed, skipping Linear connector");
      return;
    }

    const { LinearConnector, SessionManager } = linearPkg;
    const stateDir = this.ctx.getStateDir();

    // Find agents with Linear configured
    const linearAgents = config.agents.filter(
      (agent) => agent.chat?.linear !== undefined
    );

    if (linearAgents.length === 0) {
      logger.debug("No agents with Linear configured");
      this.initialized = true;
      return;
    }

    logger.info(`Initializing Linear connector for ${linearAgents.length} agent(s)`);

    // All agents share the same API key
    const firstLinearConfig = linearAgents[0].chat!.linear!;
    const apiKey = process.env[firstLinearConfig.api_key_env];
    if (!apiKey) {
      logger.warn(`Linear API key not found in env var '${firstLinearConfig.api_key_env}'`);
      this.initialized = true;
      return;
    }

    // Build per-agent filters and session managers
    for (const agent of linearAgents) {
      const linearConfig = agent.chat!.linear!;

      // Create session manager
      const sessionManager = new SessionManager({
        agentName: agent.name,
        stateDir,
        sessionExpiryHours: linearConfig.session_expiry_hours,
      });
      this.sessionManagers.set(agent.name, sessionManager);

      // Build agent filter
      const filter: LinearAgentFilter = {
        assigneeId: linearConfig.assignee_id,
        teams: linearConfig.teams,
        labels: linearConfig.labels,
        projects: linearConfig.projects,
      };
      this.agentFilters.set(agent.name, filter);
    }

    // Determine event mode and webhook config
    const eventMode = firstLinearConfig.event_mode ?? "webhook";
    const webhookSecret = eventMode === "webhook"
      ? process.env[firstLinearConfig.webhook_secret_env ?? "LINEAR_WEBHOOK_SECRET"]
      : undefined;

    // Create the connector
    try {
      this.connector = new LinearConnector({
        apiKey,
        agentFilters: this.agentFilters,
        sessionManagers: this.sessionManagers,
        eventMode,
        webhookPort: firstLinearConfig.webhook_port,
        webhookPath: firstLinearConfig.webhook_path,
        webhookSecret,
        pollIntervalSeconds: firstLinearConfig.polling_interval_seconds,
        stateDir,
      });
    } catch (error) {
      logger.error(`Failed to create Linear connector: ${(error as Error).message}`);
    }

    this.initialized = true;
  }

  async start(): Promise<void> {
    const logger = this.ctx.getLogger();

    if (!this.connector) {
      logger.debug("No Linear connector to start");
      return;
    }

    // Subscribe to events
    this.connector.on("message", (event: LinearMessageEvent) => {
      this.handleMessage(event.agentName, event).catch((error: unknown) => {
        this.handleError(event.agentName, error);
      });
    });

    this.connector.on("error", (event: LinearErrorEvent) => {
      this.handleError("unknown", event.error);
    });

    try {
      await this.connector.connect();
      logger.info("Linear connector started");
    } catch (error) {
      logger.error(`Failed to start Linear: ${(error as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    const logger = this.ctx.getLogger();

    if (!this.connector) {
      logger.debug("No Linear connector to stop");
      return;
    }

    // Log session state
    for (const [agentName, sm] of this.sessionManagers) {
      try {
        const count = await sm.getActiveSessionCount();
        if (count > 0) {
          logger.info(`Preserving ${count} active Linear session(s) for agent '${agentName}'`);
        }
      } catch {}
    }

    try {
      await this.connector.disconnect();
      logger.info("Linear connector stopped");
    } catch (error) {
      logger.error(`Error disconnecting Linear: ${(error as Error).message}`);
    }
  }

  // =========================================================================
  // Message Handling Pipeline
  // =========================================================================

  private async handleMessage(
    agentName: string,
    event: LinearMessageEvent
  ): Promise<void> {
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    logger.info(
      `Linear issue for agent '${agentName}': ${event.metadata.issueIdentifier} - ` +
      `${event.prompt.substring(0, 50)}...`
    );

    // Get existing session
    const sessionManager = this.sessionManagers.get(agentName);
    let existingSessionId: string | null = null;
    if (sessionManager) {
      const existing = await sessionManager.getSession(event.metadata.issueId);
      if (existing) {
        existingSessionId = existing.sessionId;
      }
    }

    // Create streaming responder (comments instead of messages)
    const streamer = new StreamingResponder({
      reply: event.reply,
      splitResponse: (text) => this.splitResponse(text),
      logger,
      agentName,
      minMessageInterval: 2000,  // Linear comments: slower pacing
    });

    // Start processing indicator
    const stopProcessing = event.startProcessingIndicator();
    let processingStopped = false;

    try {
      const fleetManager = emitter as unknown as {
        trigger: (
          agentName: string,
          scheduleName?: string,
          options?: {
            prompt?: string;
            resume?: string | null;
            onMessage?: (message: { type: string; content?: string; message?: { content?: unknown } }) => void | Promise<void>;
          }
        ) => Promise<TriggerResult>;
      };

      const result = await fleetManager.trigger(agentName, undefined, {
        prompt: event.prompt,
        resume: existingSessionId,
        onMessage: async (message) => {
          if (message.type === "assistant") {
            const content = this.extractMessageContent(message);
            if (content) {
              await streamer.addMessageAndSend(content);
            }
          }
        },
      });

      if (!processingStopped) {
        stopProcessing();
        processingStopped = true;
      }

      await streamer.flush();

      // Update issue status on completion
      if (result.success) {
        try {
          // Set status to "Done" or "In Review"
          // (depends on whether a PR was created)
          await event.updateStatus(/* done state ID */);
        } catch {
          // Status update failure is non-fatal
        }
      }

      // Store session
      if (sessionManager && result.sessionId && result.success) {
        await sessionManager.setSession(
          event.metadata.issueId,
          result.sessionId,
          event.metadata.issueIdentifier
        );
      }

      emitter.emit("linear:message:handled", {
        agentName,
        issueId: event.metadata.issueId,
        issueIdentifier: event.metadata.issueIdentifier,
        jobId: result.jobId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(
        `Linear message handling failed for agent '${agentName}': ${err.message}`
      );

      try {
        await event.reply(`Error: ${err.message}\n\nThe agent encountered an error processing this issue.`);
      } catch {}

      emitter.emit("linear:message:error", {
        agentName,
        issueId: event.metadata.issueId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (!processingStopped) {
        stopProcessing();
      }
    }
  }

  // ... extractMessageContent, splitResponse, handleError (same as Slack/Discord)
}
```

### FleetManager Changes

```typescript
// In fleet-manager.ts:

import { LinearManager } from "./linear-manager.js";

export class FleetManager extends EventEmitter implements FleetManagerContext {
  // Add alongside existing managers:
  private linearManager!: LinearManager;

  // Context accessor:
  getLinearManager(): LinearManager { return this.linearManager; }

  // In initializeModules():
  private initializeModules(): void {
    // ... existing modules ...
    this.linearManager = new LinearManager(this);
  }

  // In initialize():
  async initialize(): Promise<void> {
    // ... existing initialization ...
    await this.linearManager.initialize();
  }

  // In start():
  async start(): Promise<void> {
    // ... existing start ...
    await this.linearManager.start();
  }

  // In stop():
  async stop(): Promise<void> {
    // ... existing stop ...
    await this.linearManager.stop();
  }
}
```

### FleetManagerContext Extension

```typescript
export interface FleetManagerContext {
  // ... existing methods ...
  getLinearManager?(): unknown;
}
```

---

## 17. Open Questions

### Q1: Shared API Key vs Per-Agent API Key

**Current design:** All agents share one API key (like Slack's shared bot token).

**Alternative:** Each agent has its own API key. This would make self-created issue detection trivial (different API users = different creators) but requires more API keys.

**Recommendation:** Start with shared API key. The self-created detection via `viewer.id` tracking works well enough, and requiring one API key is simpler for users to configure.

### Q2: How to Handle Long-Running Tasks

Linear issues might take hours or days to resolve. The Claude session has a finite context window and may time out.

**Options:**

1. **Single long session**: Keep the session alive for the entire issue lifecycle. Risk: context window overflow.
2. **Checkpoint sessions**: Periodically summarize progress and start a fresh session with the summary. Better for long tasks.
3. **Comment-driven**: Each human comment creates a fresh interaction with the full issue context re-loaded. The session is only for continuity within a single "turn" of work.

**Recommendation:** Option 3 (comment-driven) for initial implementation. Each trigger (new issue, new comment) is a separate job execution with fresh context from the issue. The session ID is stored for intra-turn continuity but not relied upon across days.

### Q3: Webhook Port Conflicts

If multiple herdctl instances run on the same machine, they would conflict on the webhook port.

**Mitigation:** Make the port configurable (already in the schema). For multi-instance deployments, use a reverse proxy or unique ports per instance.

### Q4: What Happens When the Agent Creates a PR?

When the agent creates a PR as part of its work:

1. The PR URL should be linked to the Linear issue via `createAttachment()`
2. The issue status should change to "In Review"
3. The issue description could be updated with the PR link

This requires the agent to have access to `gh` or GitHub API, AND the Linear SDK. The connector can provide the Linear API calls; the agent handles the git/GitHub side.

### Q5: Should the Connector Handle Worktree Setup?

**Option A:** LinearManager handles worktree setup/teardown internally (before/after trigger).
**Option B:** Worktree strategy is a separate layer in the job executor (as proposed in `006-worktree-strategy-research.md`).

**Recommendation:** Option B. The worktree strategy should be a general-purpose feature of the job executor, not tied to any specific connector. However, the LinearManager should pass the issue identifier to the worktree strategy so it can generate meaningful branch names.

### Q6: Polling Efficiency

The polling implementation queries recently updated issues. For workspaces with thousands of issues, this could be expensive.

**Mitigations:**

1. Filter by team keys from agent configs (already in the design)
2. Use `updatedAt` filter to only get issues changed since last poll
3. Limit to 50 issues per poll
4. Increase polling interval for large workspaces

### Q7: Multiple Agents Matching the Same Issue

If two agents' filters both match an issue, which one gets it?

**Current design:** First match wins. The `evaluateFilters()` method iterates agents in config order and returns the first match.

**Alternative:** Require explicit assignment for disambiguation. Add a `conflict_resolution: "require_assignment"` config option.

**Recommendation:** Start with first-match. Add `conflict_resolution` config if users need more control.

---

## Summary

The Linear connector follows herdctl's established connector patterns (Discord and Slack) while adapting to Linear's issue-centric model. Key design principles:

1. **Shared connector** (like Slack) with per-agent issue routing
2. **Issue as conversation** -- each issue ID maps to a session
3. **Comment as message** -- agent responds via Linear comments
4. **Filter-based routing** -- agents declare which issues they handle via team, label, assignment, and project filters
5. **Self-created issue detection** -- prevents infinite loops when agents create sub-issues
6. **Worktree integration** -- each issue naturally maps to a git branch and worktree
7. **Webhook + polling** -- real-time events via webhooks, polling as fallback
8. **Same lifecycle** -- initialize/start/stop pattern matching Discord and Slack managers

The implementation can proceed incrementally:

1. **Phase 1:** Basic connector with polling, issue-to-agent routing, comment posting
2. **Phase 2:** Webhook support, session management, conversation continuity
3. **Phase 3:** Worktree integration, PR linking, status updates
4. **Phase 4:** Multi-agent workflows, sub-issue creation, advanced filters
