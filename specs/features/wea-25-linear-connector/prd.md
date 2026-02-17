# WEA-25: Linear Connector - Issues as Conversations

**Status**: In Progress
**Priority**: P0 (Feature)
**Created**: 2026-02-17
**Updated**: 2026-02-17

---

## Executive Summary

Design and implement a Linear connector for herdctl where **Linear issues = conversation threads** and **comments = messages**. Agents will monitor assigned Linear issues and respond to comments, enabling asynchronous task-based workflows.

This follows the **shared connector pattern** (like Slack) where a single Linear API client routes issues to the appropriate agent based on team, label, and assignee filters.

---

## Problem Statement

### Current State
- Herdctl supports real-time chat (Discord, Slack) but lacks task-tracking integration
- Linear is used for issue tracking, but agents can't respond to issue comments
- No automatic workflow: issue assignment → agent action → comment response

### Desired State
- Agents monitor Linear issues assigned to them
- Each issue becomes a persistent conversation (session continuity)
- Comments from users trigger agent responses
- Agents can create follow-up comments, update issue status, create sub-tasks
- Full integration with herdctl's worktree strategy (one branch per issue)

---

## Architecture Overview

### Connector Pattern: Shared (Slack-style)

**Rationale**:
- Linear API has **rate limits per API key** (not per-team/issue)
- Shared connector = single API client, centralized rate limit management
- Issue→agent routing similar to Slack's channel→agent routing

```
┌─────────────────────────────────────────────────────────┐
│                    LinearManager                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │         LinearConnector (shared)                  │  │
│  │  - Single Linear API client                       │  │
│  │  - Polling loop (30s) for new comments            │  │
│  │  - Issue→agent routing map                        │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │SessionManager│  │SessionManager│  │SessionManager│ │
│  │  (agent-1)   │  │  (agent-2)   │  │  (agent-3)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                          │
│  issueAgentMap: Map<issueId, agentName>                │
│  - ENG-123 → backend-agent                             │
│  - ENG-456 → frontend-agent                            │
└─────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Issue = Conversation Thread

Each Linear issue gets its own session:
- **Session key**: Issue UUID (not identifier like "ENG-123")
- **Session storage**: `.herdctl/linear-sessions/<agent-name>.yaml`
- **Session lifecycle**: Created on first comment, persists until expiry (default: 7 days)

```yaml
# .herdctl/linear-sessions/backend-agent.yaml
version: 3
agentName: backend-agent
issues:
  736c35a0-7e8f-463d-95df-4f264e5e7e46:  # Issue UUID
    issueIdentifier: "ENG-123"
    sessionId: "linear-backend-agent-abc123-def456"
    issueStartedAt: "2026-02-17T10:00:00Z"
    lastCommentAt: "2026-02-17T12:00:00Z"
    commentCount: 5
    contextUsage:
      inputTokens: 12000
      outputTokens: 3000
      totalTokens: 15000
      contextWindow: 200000
      lastUpdated: "2026-02-17T12:00:00Z"
    agentConfig:
      model: "claude-sonnet-4"
      permissionMode: "bypassPermissions"
      mcpServers: ["linear-mcp", "perplexity"]
```

### 2. Comments = Messages

- **User comments** trigger agent responses
- **Agent comments** are created via `linear.createComment()`
- **Self-created comments** are filtered out (using Linear `viewer.id`)

### 3. Conversation Context

On each comment, agent receives:
1. **Issue description** (the original task/problem)
2. **Recent comments** (default: last 10, configurable)
3. **Issue metadata** (state, assignee, labels, priority)

```typescript
const context = [
  {
    role: "user",
    content: `Issue: ${issue.title}\n\n${issue.description}`
  },
  ...recentComments.map(comment => ({
    role: comment.user.id === botUserId ? "assistant" : "user",
    content: comment.body
  }))
];
```

---

## Configuration Schema

### Agent-Level Config

```yaml
# agents/backend-agent.yaml
name: backend-agent
description: Handles backend issues in Linear

chat:
  linear:
    # Authentication
    api_key_env: LINEAR_API_KEY  # Environment variable name

    # Session configuration
    session_expiry_hours: 168  # 7 days (default)
    log_level: standard         # or "verbose"

    # Issue filtering
    teams:
      - id: "${LINEAR_TEAM_ID}"
        name: "Engineering"  # Optional, for display

        # Which issues to monitor (all filters are AND logic)
        states: ["Todo", "In Progress"]  # Issue states to monitor
        labels: ["backend", "ai-agent"]  # Only issues with these labels
        assignee_mode: "assigned_to_me"  # or "unassigned", "any"

        # Comment handling
        comment_mode: "auto"       # Respond to all comments (vs "mention")
        context_comments: 10       # How many past comments to include
        include_issue_description: true

    # Polling configuration (webhooks come later)
    poll_interval: 30s  # How often to check for new comments

    # Output configuration
    output:
      issue_updates: true          # Post when issue state changes
      comment_previews: true       # Show comment previews in logs
      comment_max_length: 500      # Truncate long comments in logs
      system_status: true          # Post "Processing..." indicators
      errors: true                 # Post error messages as comments
```

### Multiple Agents Example

```yaml
# Agent 1: Backend issues
chat:
  linear:
    api_key_env: LINEAR_API_KEY
    teams:
      - id: "eng-team-123"
        labels: ["backend"]
        states: ["Todo", "In Progress"]

# Agent 2: Frontend issues
chat:
  linear:
    api_key_env: LINEAR_API_KEY
    teams:
      - id: "eng-team-123"
        labels: ["frontend"]
        states: ["Todo", "In Progress"]
```

---

## Implementation Details

### Phase 1: Core Connector (MVP)

#### 1.1 LinearConnector Class

**Location**: `packages/linear/src/linear-connector.ts`

```typescript
interface LinearConnectorConfig {
  apiKey: string;
  pollInterval: number;          // milliseconds
  issueAgentMap: Map<string, string>;
  sessionManagers: Map<string, ILinearSessionManager>;
  logger: Logger;
}

class LinearConnector extends EventEmitter {
  private client: LinearClient;
  private pollInterval: NodeJS.Timer | null = null;
  private botUserId: string | null = null;
  private isConnected: boolean = false;

  constructor(config: LinearConnectorConfig) { }

  async connect(): Promise<void> {
    // 1. Initialize Linear API client
    // 2. Get bot user ID (viewer.id)
    // 3. Start polling loop
    this.pollInterval = setInterval(() => this.poll(), this.config.pollInterval);
    this.emit("ready", { botUser: this.botUserId });
  }

  async disconnect(): Promise<void> {
    // Stop polling, cleanup
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.isConnected = false;
    this.emit("disconnect");
  }

  private async poll(): Promise<void> {
    // For each monitored issue:
    // 1. Fetch comments since last poll
    // 2. Filter out self-created comments
    // 3. Emit "message" event for each new comment

    for (const [issueId, agentName] of this.config.issueAgentMap) {
      const sessionManager = this.config.sessionManagers.get(agentName);
      const session = await sessionManager?.getSession(issueId);

      const since = session?.lastCommentAt ??
        new Date(Date.now() - this.config.pollInterval).toISOString();

      const comments = await this.fetchNewComments(issueId, since);

      for (const comment of comments) {
        if (comment.user.id !== this.botUserId) {
          this.emit("message", {
            agentName,
            issueId,
            comment,
            metadata: { source: "linear", issueId }
          });
        }
      }
    }
  }

  private async fetchNewComments(issueId: string, since: string): Promise<Comment[]> {
    // Use Linear API to fetch comments
    const issue = await this.client.issue(issueId);
    const comments = await issue.comments({
      filter: { createdAt: { gt: since } },
      orderBy: "createdAt"
    });
    return comments.nodes;
  }

  // Events emitted:
  // - "ready": { botUser: string }
  // - "message": LinearMessageEvent
  // - "error": { error: Error }
  // - "disconnect"
}
```

#### 1.2 LinearManager Class

**Location**: `packages/core/src/fleet-manager/linear-manager.ts`

```typescript
class LinearManager {
  private connector: ILinearConnector | null = null;
  private sessionManagers: Map<string, ILinearSessionManager> = new Map();
  private issueAgentMap: Map<string, string> = new Map();
  private teamFilters: Map<string, TeamFilter[]> = new Map();

  constructor(
    private fleetManager: IFleetManager,
    private config: FleetConfig,
    private stateDir: string,
    private logger: Logger
  ) {}

  async initialize(): Promise<void> {
    // 1. Build issue→agent routing and session managers
    for (const agent of this.config.agents) {
      if (!agent.chat?.linear) continue;

      const sessionManager = new LinearSessionManager({
        agentName: agent.name,
        stateDir: this.stateDir,
        expiryHours: agent.chat.linear.session_expiry_hours ?? 168,
        logger: this.logger
      });

      this.sessionManagers.set(agent.name, sessionManager);

      // Store team filters for this agent
      this.teamFilters.set(agent.name, agent.chat.linear.teams);
    }

    // 2. Create shared connector
    const apiKey = process.env[this.config.agents[0].chat?.linear?.api_key_env ?? ""];
    if (!apiKey) throw new Error("LINEAR_API_KEY not found");

    this.connector = new LinearConnector({
      apiKey,
      pollInterval: 30000,  // 30s default
      issueAgentMap: this.issueAgentMap,
      sessionManagers: this.sessionManagers,
      logger: this.logger
    });

    await this.connector.connect();
  }

  async start(): Promise<void> {
    if (!this.connector) throw new Error("LinearManager not initialized");

    // Subscribe to connector events
    this.connector.on("message", (event) => {
      this.handleMessage(event.agentName, event).catch(err => {
        this.logger.error("Failed to handle Linear message", err);
      });
    });

    this.connector.on("error", (error) => {
      this.logger.error("Linear connector error", error);
    });
  }

  private async handleMessage(
    agentName: string,
    event: LinearMessageEvent
  ): Promise<void> {
    // 1. Get/create session
    const sessionManager = this.sessionManagers.get(agentName);
    if (!sessionManager) return;

    const sessionResult = await sessionManager.getOrCreateSession(event.issueId);
    const existingSessionId = sessionResult.isNew ? null : sessionResult.sessionId;

    // 2. Build conversation context
    const context = await this.buildConversationContext(event.issueId, agentName);

    // 3. Create streaming responder
    const responder = new LinearStreamingResponder({
      issueId: event.issueId,
      linearClient: this.connector.getClient(),
      logger: this.logger
    });

    // 4. Trigger agent
    const result = await this.fleetManager.trigger(agentName, undefined, {
      prompt: event.comment.body,
      resume: existingSessionId,
      onMessage: async (message) => {
        await responder.handleMessage(message);
      }
    });

    // 5. Store session ID
    if (result.sessionId && result.success) {
      await sessionManager.setSession(event.issueId, result.sessionId);
    }
  }

  private async buildConversationContext(
    issueId: string,
    agentName: string
  ): Promise<ConversationMessage[]> {
    const issue = await this.connector.getClient().issue(issueId);
    const comments = await issue.comments({ first: 10, orderBy: "createdAt" });

    const context: ConversationMessage[] = [
      {
        role: "user",
        content: `# ${issue.title}\n\n${issue.description}\n\n---\n**State**: ${issue.state.name}\n**Priority**: ${issue.priority}\n**Labels**: ${issue.labels.nodes.map(l => l.name).join(", ")}`
      }
    ];

    for (const comment of comments.nodes) {
      context.push({
        role: comment.user.id === this.connector.getBotUserId() ? "assistant" : "user",
        content: comment.body
      });
    }

    return context;
  }

  async stop(): Promise<void> {
    await this.connector?.disconnect();
  }
}
```

#### 1.3 LinearSessionManager Class

**Location**: `packages/linear/src/session-manager.ts`

```typescript
interface LinearSession {
  issueIdentifier: string;       // "ENG-123" (for display)
  sessionId: string;              // SDK session ID
  issueStartedAt: string;         // ISO timestamp
  lastCommentAt: string;          // ISO timestamp
  commentCount: number;
  contextUsage?: ContextUsage;
  agentConfig?: AgentConfig;
}

interface LinearSessionData {
  version: 3;
  agentName: string;
  issues: Record<string, LinearSession>;  // issueUuid → session
}

class LinearSessionManager implements ILinearSessionManager {
  private filePath: string;
  private data: LinearSessionData;

  constructor(config: { agentName: string; stateDir: string; expiryHours: number }) {
    this.filePath = path.join(config.stateDir, `linear-sessions/${config.agentName}.yaml`);
    this.data = this.load();
  }

  async getSession(issueId: string): Promise<LinearSession | null> {
    const session = this.data.issues[issueId];
    if (!session) return null;

    // Check expiry
    const age = Date.now() - new Date(session.lastCommentAt).getTime();
    if (age > this.config.expiryHours * 3600 * 1000) {
      delete this.data.issues[issueId];
      await this.save();
      return null;
    }

    return session;
  }

  async getOrCreateSession(issueId: string): Promise<{
    sessionId: string | null;
    isNew: boolean
  }> {
    const existing = await this.getSession(issueId);
    if (existing) {
      return { sessionId: existing.sessionId, isNew: false };
    }

    // Create placeholder (actual sessionId comes from SDK after trigger)
    this.data.issues[issueId] = {
      issueIdentifier: "",  // Will be filled later
      sessionId: "",        // Will be filled by setSession()
      issueStartedAt: new Date().toISOString(),
      lastCommentAt: new Date().toISOString(),
      commentCount: 0
    };
    await this.save();

    return { sessionId: null, isNew: true };
  }

  async setSession(issueId: string, sessionId: string): Promise<void> {
    const session = this.data.issues[issueId];
    if (!session) {
      // Should not happen, but create if missing
      this.data.issues[issueId] = {
        issueIdentifier: "",
        sessionId,
        issueStartedAt: new Date().toISOString(),
        lastCommentAt: new Date().toISOString(),
        commentCount: 1
      };
    } else {
      session.sessionId = sessionId;
      session.lastCommentAt = new Date().toISOString();
      session.commentCount++;
    }

    await this.save();
  }

  async updateContextUsage(
    issueId: string,
    usage: ContextUsage
  ): Promise<void> {
    const session = this.data.issues[issueId];
    if (session) {
      session.contextUsage = usage;
      await this.save();
    }
  }

  private load(): LinearSessionData {
    // Load from YAML file or create default
  }

  private async save(): Promise<void> {
    // Atomic write to YAML file
  }
}
```

#### 1.4 LinearStreamingResponder Class

**Location**: `packages/linear/src/streaming-responder.ts`

```typescript
class LinearStreamingResponder {
  private currentComment: string = "";
  private lastCommentId: string | null = null;

  constructor(
    private config: {
      issueId: string;
      linearClient: LinearClient;
      logger: Logger;
    }
  ) {}

  async handleMessage(message: AssistantMessage): Promise<void> {
    if (message.type !== "assistant") return;

    // Extract text content from message
    const textBlocks = message.content.filter(block => block.type === "text");
    if (textBlocks.length === 0) return;

    const newText = textBlocks.map(b => b.text).join("\n\n");

    // Check if content changed significantly (avoid spam)
    if (newText === this.currentComment) return;

    this.currentComment = newText;

    // Create or update comment
    if (!this.lastCommentId) {
      const result = await this.config.linearClient.createComment({
        issueId: this.config.issueId,
        body: newText
      });
      this.lastCommentId = result.comment.id;
    } else {
      await this.config.linearClient.updateComment({
        id: this.lastCommentId,
        body: newText
      });
    }
  }
}
```

---

### Phase 2: Advanced Features

#### 2.1 Issue Filtering and Routing

**Problem**: How does the connector know which issues to monitor for which agent?

**Solution**: Build `issueAgentMap` during initialization by querying Linear API:

```typescript
async buildIssueAgentMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const [agentName, filters] of this.teamFilters) {
    for (const teamFilter of filters) {
      // Query Linear for issues matching this agent's filters
      const issues = await this.client.issues({
        filter: {
          team: { id: { eq: teamFilter.id } },
          state: { name: { in: teamFilter.states } },
          labels: { name: { in: teamFilter.labels } },
          assignee: this.buildAssigneeFilter(teamFilter.assignee_mode)
        }
      });

      for (const issue of issues.nodes) {
        // Map this issue to this agent
        if (!map.has(issue.id)) {
          map.set(issue.id, agentName);
        } else {
          // Conflict: multiple agents match this issue
          this.logger.warn(
            `Issue ${issue.identifier} matches multiple agents, using first: ${map.get(issue.id)}`
          );
        }
      }
    }
  }

  return map;
}

private buildAssigneeFilter(mode: string) {
  switch (mode) {
    case "assigned_to_me":
      return { id: { eq: this.botUserId } };
    case "unassigned":
      return { null: true };
    case "any":
      return undefined;
    default:
      return { id: { eq: this.botUserId } };
  }
}
```

**Refresh Strategy**:
- Rebuild `issueAgentMap` on connector start
- Rebuild periodically (every 5 minutes) to catch new issues
- Emit `issueAssigned` event when new issue is mapped

#### 2.2 Webhook Support (Future)

**Phase 1**: Polling-based (30s interval)
**Phase 2**: Add webhook receiver for real-time delivery

```typescript
class LinearWebhookServer {
  private server: http.Server;

  constructor(
    private config: {
      port: number;
      webhookSecret: string;
      onWebhook: (event: LinearWebhookEvent) => Promise<void>;
    }
  ) {}

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/webhooks/linear") {
        res.writeHead(404);
        res.end();
        return;
      }

      // 1. Read body
      const body = await this.readBody(req);

      // 2. Verify signature
      const signature = req.headers["linear-signature"];
      if (!this.verifySignature(body, signature)) {
        res.writeHead(401);
        res.end();
        return;
      }

      // 3. Parse event
      const event = JSON.parse(body);

      // 4. Route to connector
      await this.config.onWebhook(event);

      res.writeHead(200);
      res.end();
    });

    this.server.listen(this.config.port);
  }

  private verifySignature(body: string, signature: string): boolean {
    const hmac = crypto.createHmac("sha256", this.config.webhookSecret);
    const digest = hmac.update(body).digest("hex");
    return digest === signature;
  }
}
```

#### 2.3 Worktree Integration

When worktree strategy is enabled (WEA-21), each Linear issue gets its own git branch:

```typescript
// In WorktreeWorkspaceStrategy
getBranchName(workItem: WorkItem): string {
  if (workItem.source === "linear") {
    const issueIdentifier = workItem.metadata.issueIdentifier; // "ENG-123"
    const agentName = workItem.agentName;
    return `agent/${agentName}/${issueIdentifier.toLowerCase()}-${workItem.title.toLowerCase().replace(/\s+/g, "-")}`;
  }
  // ...
}

// Example branch names:
// agent/backend-agent/eng-123-fix-auth-bug
// agent/frontend-agent/eng-456-add-dark-mode
```

**Session validation** checks worktree path matches issue:

```typescript
function validateSession(session: LinearSession, currentIssueId: string): boolean {
  // If worktree path changed, invalidate session
  const expectedWorktree = getWorktreePath(currentIssueId);
  if (session.metadata?.worktreePath !== expectedWorktree) {
    return false;
  }
  return true;
}
```

#### 2.4 Context Window Handoff

When combined with WEA-22 (context handoff):

```typescript
// In LinearStreamingResponder
async handleContextThreshold(event: ContextThresholdEvent): Promise<void> {
  // 1. Post summary comment
  await this.config.linearClient.createComment({
    issueId: this.config.issueId,
    body: `⚠️ **Context window approaching limit** (${event.percentage}%)\n\nStarting new session to continue...`
  });

  // 2. Clear session (will create new one on next comment)
  await this.sessionManager.clearSession(this.config.issueId);

  // 3. Create handoff comment with session summary
  const summary = await generateSessionSummary(event.sessionId);
  await this.config.linearClient.createComment({
    issueId: this.config.issueId,
    body: `## Session Summary\n\n${summary}\n\n---\n*Continued in new session*`
  });
}
```

---

## Message Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Linear Platform                             │
│  Issue: ENG-123                                                     │
│  └─ Comment by @user: "Can you fix the login bug?"                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Poll (30s) or Webhook
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LinearConnector                                │
│  1. Fetch comments since lastCommentAt                             │
│  2. Filter out self-created (botUserId check)                      │
│  3. Emit "message" event                                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Event: message
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LinearManager                                  │
│  1. Get/create session for issue ENG-123                           │
│  2. Build conversation context (issue + comments)                  │
│  3. Call fleetManager.trigger(agentName, ...)                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Trigger
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       JobExecutor                                   │
│  1. Create/resume Claude SDK session                               │
│  2. Send message to agent                                          │
│  3. Stream responses via onMessage callback                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ onMessage (streaming)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  LinearStreamingResponder                           │
│  1. Extract text from assistant message                            │
│  2. Create/update Linear comment with response                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ createComment / updateComment
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Linear Platform                             │
│  Issue: ENG-123                                                     │
│  └─ Comment by @agent: "I've identified the issue in auth.ts..."   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### LinearMessageEvent

```typescript
interface LinearMessageEvent {
  agentName: string;
  issueId: string;              // Issue UUID
  issueIdentifier: string;      // "ENG-123"
  comment: {
    id: string;
    body: string;               // Markdown content
    user: {
      id: string;
      name: string;
      email: string;
    };
    createdAt: string;          // ISO timestamp
  };
  issue: {
    id: string;
    identifier: string;
    title: string;
    description: string;
    state: { id: string; name: string; };
    priority: number;
    labels: { id: string; name: string; }[];
  };
  metadata: {
    source: "linear";
    teamId: string;
    projectId?: string;
  };
}
```

### LinearSession (stored in YAML)

```typescript
interface LinearSession {
  issueIdentifier: string;       // "ENG-123" (for display)
  sessionId: string;              // SDK session ID
  issueStartedAt: string;         // ISO timestamp
  lastCommentAt: string;          // ISO timestamp
  commentCount: number;
  contextUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextWindow: number;
    lastUpdated: string;
  };
  agentConfig?: {
    model: string;
    permissionMode: string;
    mcpServers: string[];
  };
  metadata?: {
    worktreePath?: string;        // For worktree strategy
    branchName?: string;
    lastHandoffAt?: string;       // For context handoff
  };
}
```

---

## Error Handling

### Self-Created Comment Loop Prevention

**Problem**: Agent creates comment → connector sees it → triggers agent again → infinite loop

**Solution**: Filter out comments where `comment.user.id === botUserId`

```typescript
private async poll(): Promise<void> {
  // ...
  for (const comment of comments) {
    if (comment.user.id === this.botUserId) {
      this.logger.debug(`Skipping self-created comment ${comment.id}`);
      continue;
    }

    this.emit("message", { agentName, issueId, comment });
  }
}
```

### Session Corruption Recovery

If session file is corrupted:

```typescript
private load(): LinearSessionData {
  try {
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return yaml.parse(raw);
  } catch (error) {
    this.logger.warn(`Failed to load session data, resetting: ${error.message}`);
    return {
      version: 3,
      agentName: this.config.agentName,
      issues: {}
    };
  }
}
```

### Rate Limit Handling

Linear API has rate limits (documented: 1000 req/hour):

```typescript
class LinearClient {
  private rateLimiter = new RateLimiter({
    requests: 900,  // Leave buffer
    interval: 3600000  // 1 hour
  });

  async request<T>(query: string): Promise<T> {
    await this.rateLimiter.wait();

    try {
      return await this.client.request(query);
    } catch (error) {
      if (error.status === 429) {
        // Rate limited, exponential backoff
        const retryAfter = error.headers["retry-after"] ?? 60;
        await sleep(retryAfter * 1000);
        return this.request(query);  // Retry
      }
      throw error;
    }
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe("LinearConnector", () => {
  it("should filter out self-created comments", async () => {
    const connector = new LinearConnector({ /* ... */ });
    const spy = jest.fn();
    connector.on("message", spy);

    // Mock Linear API to return comment from bot user
    mockLinearAPI.issues.comments.mockResolvedValue({
      nodes: [
        { id: "1", user: { id: "bot-user-id" }, body: "Self comment" },
        { id: "2", user: { id: "real-user-id" }, body: "User comment" }
      ]
    });

    await connector.poll();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      comment: expect.objectContaining({ id: "2" })
    }));
  });

  it("should handle session expiry correctly", async () => {
    const sessionManager = new LinearSessionManager({
      agentName: "test",
      stateDir: "/tmp",
      expiryHours: 24
    });

    // Create session 25 hours ago
    await sessionManager.setSession("issue-123", "session-456");
    sessionManager.data.issues["issue-123"].lastCommentAt =
      new Date(Date.now() - 25 * 3600 * 1000).toISOString();

    const session = await sessionManager.getSession("issue-123");
    expect(session).toBeNull();
  });
});
```

### Integration Tests

```typescript
describe("Linear Integration", () => {
  it("should handle full message flow", async () => {
    // 1. Setup mock Linear API
    const mockLinear = createMockLinearClient();

    // 2. Create connector + manager
    const manager = new LinearManager(/* ... */);
    await manager.initialize();
    await manager.start();

    // 3. Simulate comment event
    mockLinear.emitComment({
      issueId: "test-issue",
      comment: { body: "Fix the bug", user: { id: "user-123" } }
    });

    // 4. Wait for agent response
    await waitForCondition(() =>
      mockLinear.comments.length > 1
    );

    // 5. Verify agent created response comment
    const agentComment = mockLinear.comments[1];
    expect(agentComment.body).toContain("I've identified the issue");
  });
});
```

---

## Security Considerations

### 1. API Key Protection

- Store Linear API key in environment variable (never in config files)
- Use separate API keys per deployment (dev/staging/prod)
- Rotate keys regularly

### 2. Comment Content Validation

```typescript
function sanitizeCommentBody(body: string): string {
  // Prevent XSS in Linear UI
  return body
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, "");
}
```

### 3. Issue Access Control

Agent should only access issues it's authorized for:

```typescript
async function validateIssueAccess(issueId: string, agentName: string): Promise<boolean> {
  const expectedAgent = issueAgentMap.get(issueId);
  if (expectedAgent !== agentName) {
    logger.warn(`Agent ${agentName} attempted to access issue ${issueId} owned by ${expectedAgent}`);
    return false;
  }
  return true;
}
```

---

## Performance Optimization

### Polling Efficiency

**Problem**: Polling every 30s for 100 issues = 100 API calls every 30s = 12,000/hour (exceeds rate limit)

**Solution**: Batch queries using Linear's filter API:

```typescript
async pollEfficiently(): Promise<void> {
  // Single query for all monitored issues
  const allIssues = Array.from(this.issueAgentMap.keys());

  // Fetch all comments created since last poll across all issues
  const comments = await this.client.comments({
    filter: {
      issue: { id: { in: allIssues } },
      createdAt: { gt: this.lastPollTime }
    }
  });

  // Group by issue and emit events
  const byIssue = groupBy(comments.nodes, c => c.issue.id);
  for (const [issueId, issueComments] of Object.entries(byIssue)) {
    const agentName = this.issueAgentMap.get(issueId);
    for (const comment of issueComments) {
      if (comment.user.id !== this.botUserId) {
        this.emit("message", { agentName, issueId, comment });
      }
    }
  }

  this.lastPollTime = new Date().toISOString();
}
```

This reduces API calls from `O(issues)` to `O(1)` per poll cycle.

### Session File I/O

- Use atomic writes (write to temp file, then rename)
- Batch updates (don't save after every setSession, save after poll cycle)
- Add in-memory cache to avoid repeated file reads

---

## Migration Path

### Phase 1: MVP (Polling-based)
- ✅ LinearConnector with polling
- ✅ LinearManager integration
- ✅ LinearSessionManager
- ✅ Basic filtering (team, state, labels)
- ✅ Comment-based conversations

### Phase 2: Webhooks
- Add LinearWebhookServer
- Signature verification
- Real-time event delivery
- Fallback to polling if webhook fails

### Phase 3: Advanced Features
- Worktree integration (one branch per issue)
- Context handoff (session continuity)
- Issue state transitions (auto-mark as "In Progress")
- Sub-task creation
- PR auto-linking

### Phase 4: Optimizations
- Batched polling queries
- Session file caching
- Rate limit optimization
- Webhook retry logic

---

## Success Metrics

### Functional Requirements
- ✅ Agent responds to Linear comments within poll interval (30s)
- ✅ Session continuity across multiple comments
- ✅ No duplicate responses (self-created comment filtering works)
- ✅ Correct issue→agent routing
- ✅ Context includes issue description + recent comments

### Performance Requirements
- Poll latency: < 30s for new comments
- API rate limit: < 900 requests/hour (Linear limit: 1000)
- Session file I/O: < 100ms per update
- Memory usage: < 50MB for 100 active sessions

### Reliability Requirements
- Connector uptime: > 99% (auto-reconnect on failures)
- Session persistence: 100% (atomic writes, no data loss)
- Error recovery: Graceful degradation on Linear API failures

---

## Open Questions

1. **Multiple agents matching same issue**: How to resolve conflicts?
   - **Proposed**: First match wins, log warning
   - **Alternative**: Support multiple agents per issue (broadcast comments)

2. **Comment update handling**: Should agent respond to edited comments?
   - **Proposed**: No (only respond to new comments)
   - **Alternative**: Track comment updates, trigger re-response

3. **Issue state transitions**: Should agent auto-update issue state?
   - **Proposed**: No (agent can suggest, but user confirms)
   - **Alternative**: Agent has permission to update state based on completion

4. **Large context issues**: Issue with 100+ comments, how to handle?
   - **Proposed**: Include only last N comments (configurable, default: 10)
   - **Alternative**: Summarize old comments using separate API call

5. **Webhook vs Polling**: Which to prioritize?
   - **Proposed**: Polling for MVP (simpler, no infrastructure)
   - **Alternative**: Webhooks first (lower latency, better UX)

---

## Implementation Checklist

### Core Files to Create

- [ ] `packages/linear/src/linear-connector.ts` - Main connector class
- [ ] `packages/linear/src/session-manager.ts` - Session persistence
- [ ] `packages/linear/src/streaming-responder.ts` - Comment streaming
- [ ] `packages/linear/src/types.ts` - TypeScript interfaces
- [ ] `packages/linear/src/index.ts` - Package exports
- [ ] `packages/core/src/fleet-manager/linear-manager.ts` - FleetManager integration
- [ ] `packages/core/src/config/schemas/linear.schema.ts` - Config validation

### Tests to Write

- [ ] `packages/linear/__tests__/linear-connector.test.ts`
- [ ] `packages/linear/__tests__/session-manager.test.ts`
- [ ] `packages/linear/__tests__/streaming-responder.test.ts`
- [ ] `packages/core/__tests__/fleet-manager/linear-manager.test.ts`

### Documentation to Update

- [ ] `docs/src/content/docs/connectors/linear.md` - User guide
- [ ] `docs/src/content/docs/configuration/agents.md` - Config reference
- [ ] `README.md` - Add Linear to feature list
- [ ] `CHANGELOG.md` - Add Linear connector release notes

### Examples to Create

- [ ] `examples/linear-agent/agents/backend-agent.yaml`
- [ ] `examples/linear-agent/herdctl.yaml`
- [ ] `examples/linear-agent/README.md`

---

## References

- [Linear API Documentation](https://developers.linear.app/docs)
- [Linear Webhooks](https://developers.linear.app/docs/graphql/webhooks)
- [WEA-21: Worktree Strategy](../wea-21-worktree-strategy/prd.md)
- [WEA-22: Context Handoff](../wea-22-context-handoff/prd.md)
- [Slack Connector Implementation](../../packages/slack/src/slack-connector.ts)
- [Discord Connector Implementation](../../packages/discord/src/discord-connector.ts)

---

## Appendix: Linear API Examples

### Fetch Issue Comments

```typescript
const issue = await client.issue("issue-uuid");
const comments = await issue.comments({
  filter: {
    createdAt: { gt: "2026-02-17T12:00:00Z" }
  },
  orderBy: "createdAt",
  first: 10
});

for (const comment of comments.nodes) {
  console.log(`${comment.user.name}: ${comment.body}`);
}
```

### Create Comment

```typescript
const result = await client.createComment({
  issueId: "issue-uuid",
  body: "I've identified the issue in `auth.ts` line 45..."
});

console.log(`Created comment: ${result.comment.id}`);
```

### Query Issues by Filters

```typescript
const issues = await client.issues({
  filter: {
    team: { id: { eq: "team-uuid" } },
    state: { name: { in: ["Todo", "In Progress"] } },
    labels: { name: { in: ["backend"] } },
    assignee: { id: { eq: "user-uuid" } }
  }
});

for (const issue of issues.nodes) {
  console.log(`${issue.identifier}: ${issue.title}`);
}
```

### Get Viewer (Bot User)

```typescript
const viewer = await client.viewer;
console.log(`Bot user ID: ${viewer.id}`);
console.log(`Bot user name: ${viewer.name}`);
```

---

**End of PRD**
