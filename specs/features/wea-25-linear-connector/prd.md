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
- Shared connector = single webhook server, centralized event processing
- Issue→agent routing similar to Slack's channel→agent routing
- **Same agent accessible on both Slack and Linear** (multi-connector support)

```
┌─────────────────────────────────────────────────────────┐
│                    LinearManager                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │         LinearConnector (shared)                  │  │
│  │  - Webhook server (primary)                       │  │
│  │  - Polling fallback                               │  │
│  │  - Issue→agent routing map                        │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │SessionManager│  │SessionManager│  │SessionManager│ │
│  │  (agent-1)   │  │  (agent-2)   │  │  (agent-3)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                          │
│  issueAgentMap: Map<issueId, agentName>                │
│  - ENG-123 → backend-agent (also in #herdctl-dev)     │
│  - ENG-456 → frontend-agent                            │
└─────────────────────────────────────────────────────────┘
```

### Multi-Connector Agent Support

Agents can be accessible via multiple connectors simultaneously:

```yaml
# Agent config - accessible on both Slack and Linear
name: backend-agent
description: Handles backend issues

chat:
  slack:
    channels:
      - id: "C1234567890"
        name: "#herdctl-dev"
        mode: auto

  linear:
    teams:
      - id: "team-123"
        labels: ["backend"]
        states: ["Todo", "In Progress"]
```

**Session Isolation**: Each connector maintains its own session storage:
- Slack sessions: `.herdctl/slack-sessions/backend-agent.yaml`
- Linear sessions: `.herdctl/linear-sessions/backend-agent.yaml`

**Future**: Cross-connector session sharing (out of scope for MVP)

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
- **Agent comments** are created via Linear MCP server in agent's container
- **Self-created comments** are filtered out (using Linear `viewer.id`)
- **Comment updates** are debounced and marked with emoji reaction (no re-trigger)

### 3. Conversation Context

On each comment, agent receives:
1. **Issue description** (the original task/problem)
2. **All previous comments** in the session (no limit)
3. **Issue metadata** (state, assignee, labels, priority)

Context window management is handled by herdctl's existing compacting logic:
- New messages go into existing session
- SDK auto-compact triggers at ~95% context usage
- No need for manual comment truncation

```typescript
const context = [
  {
    role: "user",
    content: `Issue: ${issue.title}\n\n${issue.description}`
  },
  ...allComments.map(comment => ({
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

# Linear MCP server passed to container
mcp_servers:
  linear:
    url: http://linear-mcp:8080/mcp  # Linear MCP in Docker network
    env:
      LINEAR_API_KEY: ${LINEAR_API_KEY}  # Passed from host env

chat:
  linear:
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
        comment_update_debounce: 5s  # Ignore updates within 5s
        include_issue_description: true

    # Webhook configuration (primary)
    webhook:
      enabled: true
      port: 3000                   # Webhook server port
      secret_env: LINEAR_WEBHOOK_SECRET  # Signature verification

    # Polling fallback (if webhook fails)
    poll_interval: 60s  # Fallback polling interval
    poll_enabled: false  # Disable polling when webhooks work

    # Output configuration
    output:
      issue_updates: true          # Post when issue state changes
      comment_previews: true       # Show comment previews in logs
      system_status: true          # Post "Processing..." indicators
      errors: true                 # Post error messages as comments
```

### Linear MCP Integration

Agents interact with Linear via the Linear MCP server running in their container:

```yaml
# docker-compose.yml (in herdctl deployment)
services:
  linear-mcp:
    image: linear-mcp:latest
    networks:
      - herdctl-net
    environment:
      LINEAR_API_KEY: ${LINEAR_API_KEY}
    ports:
      - "8080:8080"
```

Agents use Linear MCP tools for:
- Creating/updating comments
- Changing issue state
- Creating sub-issues
- Updating issue fields (assignee, priority, labels)

**No API key in connector code** - all Linear operations via MCP in agent container.

### Multiple Agents Example

```yaml
# Agent 1: Backend issues (accessible on Slack and Linear)
chat:
  slack:
    channels:
      - id: "C1234567890"
        name: "#backend-dev"
        mode: auto
  linear:
    teams:
      - id: "eng-team-123"
        labels: ["backend"]
        states: ["Todo", "In Progress"]

# Agent 2: Frontend issues (Linear only)
chat:
  linear:
    teams:
      - id: "eng-team-123"
        labels: ["frontend"]
        states: ["Todo", "In Progress"]
```

---

## Implementation Details

### Phase 1: Webhook-based Connector (MVP)

#### 1.1 General Webhook Trigger Layer

**Location**: `packages/core/src/fleet-manager/webhook-server.ts`

This is a **general-purpose webhook infrastructure** that can be reused for Linear, GitHub, and other services.

```typescript
interface WebhookServerConfig {
  port: number;
  routes: WebhookRoute[];
  logger: Logger;
}

interface WebhookRoute {
  path: string;  // e.g., "/webhooks/linear", "/webhooks/github"
  verifySignature: (body: string, signature: string) => boolean;
  onEvent: (event: any) => Promise<void>;
}

class WebhookServer {
  private server: http.Server | null = null;

  constructor(private config: WebhookServerConfig) {}

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const route = this.config.routes.find(r => r.path === req.url);
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }

      // 1. Read body
      const body = await this.readBody(req);

      // 2. Verify signature
      const signature = req.headers["linear-signature"] as string;
      if (!route.verifySignature(body, signature)) {
        this.config.logger.warn("Webhook signature verification failed");
        res.writeHead(401);
        res.end();
        return;
      }

      // 3. Parse and route event
      try {
        const event = JSON.parse(body);
        await route.onEvent(event);
        res.writeHead(200);
        res.end();
      } catch (error) {
        this.config.logger.error("Webhook processing error", error);
        res.writeHead(500);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.port, () => {
        this.config.logger.info(`Webhook server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }
}
```

#### 1.2 LinearConnector Class

**Location**: `packages/linear/src/linear-connector.ts`

```typescript
interface LinearConnectorConfig {
  webhookSecret: string;
  apiKey: string;  // Only for reading issue data, NOT for creating comments
  issueAgentMap: Map<string, string>;
  sessionManagers: Map<string, ILinearSessionManager>;
  logger: Logger;

  // Polling fallback
  pollEnabled: boolean;
  pollInterval: number;
}

class LinearConnector extends EventEmitter {
  private client: LinearClient;
  private botUserId: string | null = null;
  private isConnected: boolean = false;
  private pollInterval: NodeJS.Timer | null = null;

  // Comment update debouncing
  private commentUpdateDebounce: Map<string, NodeJS.Timeout> = new Map();
  private processedCommentUpdates: Set<string> = new Set();

  constructor(private config: LinearConnectorConfig) {
    super();
    this.client = new LinearClient({ apiKey: config.apiKey });
  }

  async connect(): Promise<void> {
    // Get bot user ID for self-comment filtering
    const viewer = await this.client.viewer;
    this.botUserId = viewer.id;
    this.isConnected = true;
    this.emit("ready", { botUser: this.botUserId });

    // Start polling fallback if enabled
    if (this.config.pollEnabled) {
      this.pollInterval = setInterval(() => this.poll(), this.config.pollInterval);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.isConnected = false;
    this.emit("disconnect");
  }

  // Called by WebhookServer when Linear webhook arrives
  async handleWebhook(event: LinearWebhookEvent): Promise<void> {
    if (event.type === "Comment" && event.action === "create") {
      await this.handleCommentCreated(event.data);
    } else if (event.type === "Comment" && event.action === "update") {
      await this.handleCommentUpdated(event.data);
    } else if (event.type === "Issue" && event.action === "update") {
      // Issue state changed - log it, agent can update state via MCP
      this.config.logger.info(`Issue ${event.data.identifier} updated: ${event.data.state.name}`);
    }
  }

  private async handleCommentCreated(comment: LinearComment): Promise<void> {
    // Filter out self-created comments
    if (comment.user.id === this.botUserId) {
      this.config.logger.debug(`Skipping self-created comment ${comment.id}`);
      return;
    }

    const agentName = this.config.issueAgentMap.get(comment.issue.id);
    if (!agentName) {
      this.config.logger.debug(`No agent for issue ${comment.issue.id}`);
      return;
    }

    this.emit("message", {
      agentName,
      issueId: comment.issue.id,
      comment,
      metadata: { source: "linear", issueId: comment.issue.id }
    });
  }

  private async handleCommentUpdated(comment: LinearComment): Promise<void> {
    // Debounce comment updates - ignore rapid edits
    const existingTimeout = this.commentUpdateDebounce.get(comment.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    this.commentUpdateDebounce.set(
      comment.id,
      setTimeout(() => {
        // Add emoji reaction to indicate we saw the update
        this.addReaction(comment.id, "eyes");
        this.commentUpdateDebounce.delete(comment.id);
      }, 5000) // 5s debounce
    );

    // Do NOT trigger agent on comment updates
    this.config.logger.debug(`Comment ${comment.id} updated, debouncing...`);
  }

  private async addReaction(commentId: string, emoji: string): Promise<void> {
    // Note: Linear API doesn't support reactions yet, placeholder for future
    this.config.logger.debug(`Would add ${emoji} reaction to ${commentId}`);
  }

  // Polling fallback (if webhooks fail)
  private async poll(): Promise<void> {
    // Same logic as before, but only used as fallback
    // Omitted for brevity
  }

  verifyWebhookSignature(body: string, signature: string): boolean {
    const hmac = crypto.createHmac("sha256", this.config.webhookSecret);
    const digest = hmac.update(body).digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(signature)
    );
  }

  // Events emitted:
  // - "ready": { botUser: string }
  // - "message": LinearMessageEvent
  // - "error": { error: Error }
  // - "disconnect"
}
```

#### 1.3 LinearManager Class

**Location**: `packages/core/src/fleet-manager/linear-manager.ts`

```typescript
class LinearManager {
  private connector: ILinearConnector | null = null;
  private webhookServer: WebhookServer | null = null;
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

    // 2. Build issueAgentMap from Linear API
    await this.buildIssueAgentMap();

    // 3. Create shared connector
    const apiKey = process.env.LINEAR_API_KEY;
    const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
    if (!apiKey) throw new Error("LINEAR_API_KEY not found");
    if (!webhookSecret) throw new Error("LINEAR_WEBHOOK_SECRET not found");

    this.connector = new LinearConnector({
      apiKey,
      webhookSecret,
      issueAgentMap: this.issueAgentMap,
      sessionManagers: this.sessionManagers,
      logger: this.logger,
      pollEnabled: false,  // Webhooks primary, polling disabled
      pollInterval: 60000  // 60s fallback
    });

    await this.connector.connect();

    // 4. Start general webhook server
    const webhookPort = parseInt(process.env.WEBHOOK_PORT ?? "3000");
    this.webhookServer = new WebhookServer({
      port: webhookPort,
      routes: [
        {
          path: "/webhooks/linear",
          verifySignature: (body, sig) => this.connector!.verifyWebhookSignature(body, sig),
          onEvent: async (event) => await this.connector!.handleWebhook(event)
        }
        // Future: add GitHub webhook route here
        // {
        //   path: "/webhooks/github",
        //   verifySignature: (body, sig) => verifyGitHubSignature(body, sig),
        //   onEvent: async (event) => await githubConnector.handleWebhook(event)
        // }
      ],
      logger: this.logger
    });

    await this.webhookServer.start();
  }

  private async buildIssueAgentMap(): Promise<void> {
    // Query Linear for issues matching each agent's filters
    for (const [agentName, filters] of this.teamFilters) {
      for (const teamFilter of filters) {
        const issues = await this.queryIssues(teamFilter);

        for (const issue of issues) {
          // First match wins - one issue assigned to one agent
          if (!this.issueAgentMap.has(issue.id)) {
            this.issueAgentMap.set(issue.id, agentName);
            this.logger.info(`Mapped issue ${issue.identifier} → ${agentName}`);
          } else {
            this.logger.warn(
              `Issue ${issue.identifier} matches multiple agents, using ${this.issueAgentMap.get(issue.id)}`
            );
          }
        }
      }
    }

    // Rebuild periodically (every 5 minutes) to catch new issues
    setInterval(() => this.buildIssueAgentMap(), 5 * 60 * 1000);
  }

  private async queryIssues(filter: TeamFilter): Promise<Issue[]> {
    // Use Linear API to query issues (same Linear client as connector)
    // Omitted for brevity
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

    // 2. Build conversation context (all comments, no limit)
    const context = await this.buildConversationContext(event.issueId);

    // 3. Trigger agent (NO LinearStreamingResponder - agent uses Linear MCP directly)
    const result = await this.fleetManager.trigger(agentName, undefined, {
      prompt: event.comment.body,
      resume: existingSessionId,
      // Agent handles responses via Linear MCP server in container
      onMessage: async (message) => {
        // Just log, agent creates comments via MCP
        this.logger.debug(`Agent ${agentName} processing message type: ${message.type}`);
      }
    });

    // 4. Store session ID
    if (result.sessionId && result.success) {
      await sessionManager.setSession(event.issueId, result.sessionId);
    }
  }

  private async buildConversationContext(issueId: string): Promise<ConversationMessage[]> {
    // Fetch issue + ALL comments (no limit - context window handles truncation)
    const issue = await this.connector!.getClient().issue(issueId);
    const comments = await issue.comments({ orderBy: "createdAt" });  // No 'first' limit

    const context: ConversationMessage[] = [
      {
        role: "user",
        content: `# ${issue.title}\n\n${issue.description}\n\n---\n**State**: ${issue.state.name}\n**Priority**: ${issue.priority}\n**Labels**: ${issue.labels.nodes.map(l => l.name).join(", ")}`
      }
    ];

    for (const comment of comments.nodes) {
      context.push({
        role: comment.user.id === this.connector!.getBotUserId() ? "assistant" : "user",
        content: comment.body
      });
    }

    return context;
  }

  async stop(): Promise<void> {
    await this.webhookServer?.stop();
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

**Note**: No `LinearStreamingResponder` needed - agents create Linear comments directly via Linear MCP server running in their container.

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

When combined with WEA-22 (context handoff), agent uses Linear MCP to post handoff comments:

```typescript
// Agent uses linear_create_comment MCP tool
await mcp.linear_create_comment({
  issueId: issueId,
  body: `⚠️ **Context window approaching limit** (90%)\n\nStarting new session to continue...`
});

// SessionManager clears session (new one created on next comment)
await sessionManager.clearSession(issueId);

// Agent posts session summary via MCP
await mcp.linear_create_comment({
  issueId: issueId,
  body: `## Session Summary\n\n${summary}\n\n---\n*Continued in new session*`
});
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
                              │ Webhook (primary) or Poll (fallback)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      WebhookServer (General)                        │
│  1. Receive POST /webhooks/linear                                  │
│  2. Verify Linear signature (HMAC-SHA256)                          │
│  3. Route to LinearConnector.handleWebhook()                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LinearConnector                                │
│  1. Parse webhook event (Comment.create)                           │
│  2. Filter out self-created (botUserId check)                      │
│  3. Debounce comment updates (5s delay + emoji)                    │
│  4. Emit "message" event                                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Event: message
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LinearManager                                  │
│  1. Get/create session for issue ENG-123                           │
│  2. Build conversation context (issue + ALL comments)              │
│  3. Call fleetManager.trigger(agentName, ...)                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Trigger
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       JobExecutor                                   │
│  1. Create/resume Claude SDK session                               │
│  2. Send message to agent in Docker container                      │
│  3. Agent has Linear MCP server available                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Agent processes via SDK
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Agent Container (Claude SDK)                       │
│  1. Analyze issue + comments                                       │
│  2. Use Linear MCP tools:                                          │
│     - linear_create_comment (post responses)                       │
│     - linear_edit_issue (update state/assignee)                    │
│     - linear_create_issues (create sub-tasks)                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Linear MCP → Linear API
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Linear Platform                             │
│  Issue: ENG-123 (State: In Progress)                               │
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

## Implementation Plan

### Phase 1: Webhook-based MVP
- ✅ General WebhookServer infrastructure (reusable for GitHub, etc.)
- ✅ LinearConnector with webhook handling
- ✅ LinearManager integration with FleetManager
- ✅ LinearSessionManager (session per issue)
- ✅ Comment debouncing (5s delay for updates)
- ✅ Self-comment filtering (botUserId check)
- ✅ Basic filtering (team, state, labels, assignee)
- ✅ Issue→agent routing (first match wins)
- ✅ Linear MCP server in agent containers
- ✅ Agent can update issue state via MCP

### Phase 2: Advanced Features
- Worktree integration (one branch per issue) - integrates with WEA-21
- Context handoff (session continuity) - integrates with WEA-22
- Cross-connector agent support (same agent on Slack + Linear)
- Polling fallback (if webhooks fail)
- Sub-task creation automation
- PR auto-linking when branches are pushed

### Phase 3: Cross-Connector Session Sharing (Future)
- Unified session across Slack + Linear + GitHub
- Session handoff commands (`!continue-on-linear`)
- Shared context across platforms
- Out of scope for MVP

---

**End of PRD**
