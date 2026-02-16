# Inbound Webhooks Research

## Date: 2026-02-16

## Objective

Research how external webhook events (e.g., Linear issue created, GitHub push, comment added) can trigger herdctl agents and route those events to the correct agent/session. Compare with OpenClaw's approach and industry patterns.

---

## 1. OpenClaw's Approach to External Event Handling

OpenClaw (https://github.com/openclaw/openclaw) is a personal AI assistant runtime that processes context, calls model providers, streams responses, and supports skill extensions. It communicates via chat apps (WhatsApp, Telegram, Slack, Discord).

### How OpenClaw Handles External Events

OpenClaw does **not** implement inbound webhooks. Its external event handling relies on two patterns:

1. **Chat App Integrations** -- Telegram, Slack, Discord, and WhatsApp integrations use each platform's bot/webhook APIs (e.g., Telegram's Bot API webhook mode) to receive user messages. These are chat-driven triggers, not arbitrary service webhooks.

2. **Cron Polling** -- For non-chat-driven work, OpenClaw uses cron jobs. The Antfarm extension (github.com/snarktank/antfarm) deploys specialized agent teams (planner, developer, verifier, tester, reviewer) that claim work from a SQLite queue via polling. Agents poll SQLite for available steps, claim them, execute, and pass context forward. There is no inbound HTTP webhook server.

### Key Takeaway from OpenClaw

OpenClaw's architecture is **pull-based** for task orchestration -- agents poll for work rather than being pushed events. Chat integrations are the only "push" path, and they use platform-specific bot frameworks (not generic webhook receivers). This is similar to herdctl's current model: interval/cron polling plus chat connectors (Slack, Discord).

The gap OpenClaw has is the same gap herdctl has: **no HTTP server for receiving arbitrary webhook events from external services**.

---

## 2. Industry Patterns for Agent Webhook Routing

Based on research into AI agent orchestration frameworks and production webhook architectures:

### 2.1 Async Ingestion with Queue Decoupling

The consensus architecture separates webhook reception from agent processing:

```
                                        +------------------+
  External Service ---> HTTP Endpoint ---> Message Queue ---> Event Router ---> Agent Trigger
  (Linear, GitHub)     (validate,          (SQS, Kafka,     (match event     (FleetManager.trigger)
                        return 202)         or in-memory)    to agent+session)
```

**Why async?** Webhook senders typically expect a response within 3-10 seconds. Agent execution takes minutes. The HTTP endpoint must respond immediately (202 Accepted) and queue the event for background processing.

### 2.2 Webhook Signature Verification

Every service uses a different verification scheme:

| Service | Header | Algorithm | Notes |
|---------|--------|-----------|-------|
| **Linear** | `Linear-Signature` | HMAC-SHA256 (hex) | Also sends `Linear-Event`, `Linear-Delivery`, `webhookTimestamp` |
| **GitHub** | `X-Hub-Signature-256` | HMAC-SHA256 (`sha256=` prefix) | Also sends `X-GitHub-Event`, `X-GitHub-Delivery` |
| **Slack** | `X-Slack-Signature` | HMAC-SHA256 (`v0=` prefix) | Uses `X-Slack-Request-Timestamp` in signature base string |
| **Jira** | N/A | IP allowlisting or JWT | Atlassian Connect uses JWT |

A pluggable verification system is essential -- each provider has its own signature format.

### 2.3 Event-to-Agent Routing Patterns

Three common routing strategies:

**a) Static Route Mapping (Config-Driven)**
```yaml
webhooks:
  routes:
    - match:
        source: linear
        event: Issue
        action: create
      agent: linear-coder
      prompt_template: "New issue created: {{data.title}}\n{{data.description}}"
```
The route is defined in configuration. When an event matches the filter criteria, it triggers the specified agent with a templated prompt.

**b) Session Affinity (Resource-Keyed)**
Map external resource IDs to herdctl sessions for conversation continuity:
```
Linear Issue LIN-123 ---> session: "linear-lin-123-<uuid>"
```
When an update to LIN-123 arrives, the router looks up the existing session and resumes it, so the agent has full context of prior work on that issue.

**c) Fan-Out (One Event, Multiple Agents)**
A single webhook event triggers multiple agents. For example, a GitHub PR merge could trigger both a deployment agent and a changelog agent. This requires the router to support multiple matching routes per event.

### 2.4 Idempotency

Webhook senders use at-least-once delivery. Deduplication is critical:

- Use the delivery ID as an idempotency key (e.g., `Linear-Delivery`, `X-GitHub-Delivery`)
- Store processed delivery IDs in a time-windowed set (e.g., last 24 hours)
- Skip events whose delivery ID has already been processed

---

## 3. Current herdctl Webhook Architecture (Outbound Only)

### 3.1 Outbound Webhooks (Hook System)

herdctl has a fully implemented **outbound** webhook system for post-execution notifications. It lives in:

- **Schema**: `/packages/core/src/config/schema.ts` -- `WebhookHookConfigSchema` defines the webhook hook type with `url`, `method`, `headers`, `timeout`
- **Runner**: `/packages/core/src/hooks/runners/webhook.ts` -- `WebhookHookRunner` POSTs `HookContext` JSON to a configured URL after job completion
- **Executor**: `/packages/core/src/hooks/hook-executor.ts` -- `HookExecutor` orchestrates sequential hook execution with event filtering (`on_events`) and conditional execution (`when`)

Example outbound webhook config:
```yaml
hooks:
  after_run:
    - type: webhook
      url: https://api.example.com/hooks/job-complete
      headers:
        Authorization: "Bearer ${API_TOKEN}"
```

This is **push out** -- herdctl notifies external services after job events. It does not receive events.

### 3.2 Webhook Schedule Type (Placeholder)

The schedule type enum already includes `"webhook"` as a valid value:
```typescript
// packages/core/src/config/schema.ts line 462
export const ScheduleTypeSchema = z.enum(["interval", "cron", "webhook", "chat"]);
```

The scheduler explicitly skips webhook-type schedules:
```typescript
// ScheduleSkipReason includes:
"unsupported_type" // Schedule type is not 'interval' or 'cron' (e.g., webhook, chat)
```

### 3.3 Fleet-Level Webhook Config (Placeholder)

There is a `WebhooksSchema` at the fleet config level that defines the shape of a future inbound webhook server:
```typescript
// packages/core/src/config/schema.ts line 860
export const WebhooksSchema = z.object({
  enabled: z.boolean().optional().default(false),
  port: z.number().int().positive().optional().default(8081),
  secret_env: z.string().optional(),
});
```

This is currently unused -- no HTTP server is instantiated.

### 3.4 Trigger Mechanism (Ready for Inbound)

The `FleetManager.trigger()` method and `JobControl.trigger()` already support everything an inbound webhook handler needs:

```typescript
// From packages/core/src/fleet-manager/types.ts
interface TriggerOptions {
  prompt?: string;           // Override prompt with webhook payload
  resume?: string | null;    // Resume a specific session
  workItems?: WorkItem[];    // Pass structured work items
  bypassConcurrencyLimit?: boolean;
  onMessage?: (message: SDKMessage) => void | Promise<void>;
}
```

The Slack connector already demonstrates this pattern -- it receives events via Socket Mode, resolves sessions, and calls `fleetManager.trigger(agentName, undefined, { prompt, resume: existingSessionId })`.

### 3.5 Chat Connector Event Flow (Reference Pattern)

The Slack connector in `/packages/slack/src/slack-connector.ts` and `/packages/core/src/fleet-manager/slack-manager.ts` demonstrate the full event-to-agent routing pipeline:

1. **Event Reception**: `SlackConnector` receives Slack events via Socket Mode
2. **Agent Resolution**: `channelAgentMap` maps Slack channel IDs to agent names
3. **Session Resolution**: `SessionManager` maps thread timestamps to Claude session IDs
4. **Job Trigger**: `SlackManager.handleMessage()` calls `fleetManager.trigger()` with prompt and session ID
5. **Response Delivery**: Streaming responder sends output back to Slack thread

An inbound webhook system would follow the same pipeline but with HTTP requests as the event source instead of Slack Socket Mode.

---

## 4. Recommended Design for herdctl Inbound Webhook Support

### 4.1 Architecture Overview

```
                   +--------------------+
                   |   HTTP Server      |
                   |   (port 8081)      |
                   +--------+-----------+
                            |
                   +--------v-----------+
                   | Signature Verifier |
                   | (per-provider)     |
                   +--------+-----------+
                            |
                   +--------v-----------+
                   | Idempotency Check  |
                   | (delivery ID set)  |
                   +--------+-----------+
                            |
                   +--------v-----------+
                   | Event Router       |
                   | (match routes)     |
                   +--------+-----------+
                            |
              +-------------+-------------+
              |                           |
    +---------v----------+    +-----------v--------+
    | Session Resolver   |    | Prompt Template    |
    | (externalId->sid)  |    | Engine             |
    +--------+-----------+    +-----------+--------+
              |                           |
              +-------------+-------------+
                            |
                   +--------v-----------+
                   | FleetManager       |
                   | .trigger()         |
                   +--------------------+
```

### 4.2 Configuration Design

```yaml
# herdctl.yaml
webhooks:
  enabled: true
  port: 8081
  # Global secret for simple setups (per-route secrets override)
  secret_env: WEBHOOK_SECRET

  routes:
    # Linear issue created -> trigger the linear-coder agent
    - name: linear-issue-created
      source: linear                    # Provider for signature verification
      match:
        event: Issue                    # Linear-Event header value
        action: create                  # payload.action value
        # Optional: filter by team, label, etc.
        filters:
          "data.team.key": "ENG"
      agent: linear-coder
      prompt_template: |
        A new Linear issue has been created:

        **{{data.identifier}}**: {{data.title}}
        Priority: {{data.priority}}
        Description: {{data.description}}

        Please analyze this issue and begin working on it.
      session_key: "data.id"           # External ID field to use for session affinity
      secret_env: LINEAR_WEBHOOK_SECRET  # Per-route secret (overrides global)

    # Linear comment added -> resume existing session
    - name: linear-comment
      source: linear
      match:
        event: Comment
        action: create
      agent: linear-coder
      prompt_template: |
        New comment on {{data.issue.identifier}} by {{data.user.name}}:

        {{data.body}}

        Please review and respond appropriately.
      session_key: "data.issue.id"     # Same session as the issue

    # GitHub push -> trigger CI agent
    - name: github-push
      source: github
      match:
        event: push                    # X-GitHub-Event header value
      agent: ci-agent
      prompt_template: |
        Push to {{ref}} by {{pusher.name}}.
        Commits: {{commits.length}}
        Run the test suite and report results.
      secret_env: GITHUB_WEBHOOK_SECRET
```

### 4.3 Agent Configuration with Webhook Schedules

```yaml
# agents/linear-coder.yaml
name: linear-coder
model: claude-sonnet-4-20250514
prompt: "You are a software engineer working from Linear issues."

schedules:
  # Webhook-triggered schedule (no interval/cron -- purely event-driven)
  on-issue:
    type: webhook
    prompt: "Process the assigned Linear issue."
    resume_session: true
```

The `type: webhook` schedule stops the scheduler from auto-triggering the agent. The agent only runs when an inbound webhook event matches a route that targets it.

### 4.4 Component Design

#### WebhookServer

New module: `packages/core/src/webhooks/server.ts`

```typescript
interface WebhookServerOptions {
  port: number;
  routes: WebhookRoute[];
  logger: WebhookServerLogger;
  onEvent: (event: ResolvedWebhookEvent) => Promise<void>;
}

class WebhookServer {
  private server: http.Server;

  async start(): Promise<void>;
  async stop(): Promise<void>;
}
```

Responsibilities:
- Listen on configured port
- Parse JSON body, preserve raw body for signature verification
- Pass to signature verifier, then route matcher
- Return 202 Accepted immediately (never block on agent execution)

#### SignatureVerifier (per-provider)

New module: `packages/core/src/webhooks/verifiers/`

```typescript
interface SignatureVerifier {
  readonly provider: string;
  verify(request: IncomingWebhookRequest): boolean;
}

class LinearSignatureVerifier implements SignatureVerifier {
  // Uses Linear-Signature header, HMAC-SHA256, hex-encoded
}

class GitHubSignatureVerifier implements SignatureVerifier {
  // Uses X-Hub-Signature-256 header, HMAC-SHA256, sha256= prefix
}
```

Use a registry pattern (like WorkSourceRegistry) so new providers can be added.

#### EventRouter

New module: `packages/core/src/webhooks/router.ts`

```typescript
interface WebhookRoute {
  name: string;
  source: string;
  match: {
    event?: string;
    action?: string;
    filters?: Record<string, string>;
  };
  agent: string;
  promptTemplate: string;
  sessionKey?: string;
  secretEnv?: string;
}

interface ResolvedWebhookEvent {
  route: WebhookRoute;
  agent: string;
  prompt: string;           // After template substitution
  sessionId?: string;        // Resolved from session store
  deliveryId: string;        // For idempotency
  rawPayload: unknown;
}
```

The router matches incoming events against configured routes, applies prompt templates, and resolves session IDs.

#### WebhookSessionStore

New module: `packages/core/src/webhooks/session-store.ts`

Maps external resource IDs to herdctl session IDs:

```typescript
interface WebhookSessionStore {
  getSession(externalId: string, agentName: string): Promise<string | null>;
  setSession(externalId: string, agentName: string, sessionId: string): Promise<void>;
}
```

Storage: YAML file at `.herdctl/webhook-sessions/<agent-name>.yaml`, similar to Slack session manager.

#### WebhookManager (FleetManager Integration)

New module: `packages/core/src/fleet-manager/webhook-manager.ts`

Follows the pattern established by `SlackManager` and `DiscordManager`:

```typescript
class WebhookManager {
  constructor(ctx: FleetManagerContext);

  async initialize(): Promise<void>;  // Parse config, create server
  async start(): Promise<void>;       // Start HTTP server
  async stop(): Promise<void>;        // Stop HTTP server

  // Called by WebhookServer when a matched event arrives
  private async handleEvent(event: ResolvedWebhookEvent): Promise<void> {
    // 1. Check idempotency (skip if delivery ID already processed)
    // 2. Resolve session (lookup externalId -> sessionId)
    // 3. Call fleetManager.trigger(event.agent, undefined, {
    //      prompt: event.prompt,
    //      resume: sessionId,
    //    })
    // 4. Store new session ID from trigger result
  }
}
```

### 4.5 Prompt Template Engine

Simple Mustache-style template substitution for webhook payloads:

```typescript
function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = getNestedValue(payload, path.trim());
    return value !== undefined ? String(value) : match;
  });
}
```

No need for a full template engine. Dot-notation path resolution into the webhook payload (same pattern as `HookExecutor.getPathValue()`).

### 4.6 Idempotency Store

Simple in-memory set with TTL, persisted to disk:

```typescript
class IdempotencyStore {
  private processed: Map<string, number> = new Map(); // deliveryId -> timestamp
  private readonly ttlMs: number = 24 * 60 * 60 * 1000; // 24 hours

  isProcessed(deliveryId: string): boolean;
  markProcessed(deliveryId: string): void;
  cleanup(): void; // Remove entries older than TTL
}
```

---

## 5. Linear Integration Specifically

### 5.1 Linear Webhook Events

Linear sends these event types (relevant subset):

| Event Type | Actions | Use Case |
|-----------|---------|----------|
| `Issue` | `create`, `update`, `remove` | New issue assigned, status change |
| `Comment` | `create`, `update`, `remove` | New comment on issue |
| `Project` | `create`, `update` | Project milestone changes |
| `Cycle` | `create`, `update` | Sprint/cycle changes |

### 5.2 Linear Webhook Headers

```
Linear-Signature: <hmac-sha256-hex>
Linear-Event: Issue
Linear-Delivery: <uuid>
Content-Type: application/json
```

### 5.3 Linear Webhook Payload Structure

```json
{
  "action": "create",
  "type": "Issue",
  "data": {
    "id": "uuid-of-issue",
    "identifier": "ENG-123",
    "title": "Fix login bug",
    "description": "Users report...",
    "priority": 2,
    "state": { "name": "In Progress" },
    "team": { "key": "ENG", "name": "Engineering" },
    "assignee": { "id": "user-uuid", "name": "Dev" },
    "labels": [{ "name": "bug" }],
    "url": "https://linear.app/workspace/issue/ENG-123"
  },
  "webhookTimestamp": 1708099200000
}
```

### 5.4 Complete Linear Integration Example

```yaml
# herdctl.yaml
webhooks:
  enabled: true
  port: 8081
  routes:
    - name: linear-issue-assigned
      source: linear
      match:
        event: Issue
        action: update
        filters:
          "data.assignee.name": "herdctl-bot"
      agent: linear-coder
      prompt_template: |
        You have been assigned Linear issue {{data.identifier}}: {{data.title}}

        Priority: {{data.priority}}
        Team: {{data.team.key}}

        Description:
        {{data.description}}

        Please:
        1. Create a branch named {{data.identifier | lower}}
        2. Implement the fix
        3. Write tests
        4. Create a PR linking to {{data.url}}
      session_key: "data.id"
      secret_env: LINEAR_WEBHOOK_SECRET

    - name: linear-comment-on-issue
      source: linear
      match:
        event: Comment
        action: create
      agent: linear-coder
      prompt_template: |
        Comment on {{data.issue.identifier}} by {{data.user.name}}:

        {{data.body}}

        Review the comment and take action if needed.
      session_key: "data.issue.id"
      secret_env: LINEAR_WEBHOOK_SECRET
```

```yaml
# agents/linear-coder.yaml
name: linear-coder
model: claude-sonnet-4-20250514
prompt: |
  You are a software engineer. You work on issues from Linear.
  When assigned an issue, create a feature branch, implement the fix,
  write tests, and create a pull request.

schedules:
  on-assignment:
    type: webhook
    resume_session: true
```

### 5.5 Session Flow for Linear

```
1. Issue ENG-123 created and assigned -> webhook fires
   - Router matches "linear-issue-assigned" route
   - session_key = data.id = "uuid-of-eng-123"
   - No existing session -> create new one
   - FleetManager.trigger("linear-coder", undefined, {
       prompt: "You have been assigned...",
       resume: null,  // fresh session
     })
   - Job completes -> sessionId = "sdk-session-abc"
   - WebhookSessionStore.setSession("uuid-of-eng-123", "linear-coder", "sdk-session-abc")

2. Reviewer comments on ENG-123 -> webhook fires
   - Router matches "linear-comment-on-issue" route
   - session_key = data.issue.id = "uuid-of-eng-123"
   - WebhookSessionStore.getSession("uuid-of-eng-123", "linear-coder") = "sdk-session-abc"
   - FleetManager.trigger("linear-coder", undefined, {
       prompt: "Comment on ENG-123 by Alice: ...",
       resume: "sdk-session-abc",  // resume existing session
     })
   - Agent has full context from the original issue work

3. More comments -> same session resumed each time
```

---

## 6. Implementation Priority

### Phase 1: Core Webhook Server (MVP)

- HTTP server with raw body preservation
- Linear signature verification (first provider)
- Static route matching (event + action)
- Simple prompt template substitution
- Session store (externalId -> sessionId)
- Idempotency check (delivery ID dedup)
- WebhookManager integration with FleetManager

### Phase 2: Enhanced Routing

- GitHub signature verification
- Filter-based route matching (match on nested payload fields)
- Fan-out support (one event -> multiple agents)
- Webhook event logging and debugging

### Phase 3: Advanced Features

- Webhook management API (list, create, test routes)
- Custom signature verifier plugins
- Webhook replay (re-process a stored event)
- Rate limiting per source
- Dead letter queue for failed processing

---

## 7. Key Design Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **HTTP framework** | Node.js `http.createServer` (no Express) | Minimal dependencies, herdctl is already dependency-light. Raw body access is trivial. |
| **Async processing** | In-process queue (not Kafka/SQS) | Single-process model aligns with herdctl architecture. No external infrastructure needed. |
| **Session storage** | YAML files in `.herdctl/webhook-sessions/` | Consistent with Slack session manager pattern. Survives restarts. |
| **Template engine** | Simple `{{path}}` substitution | No need for Handlebars/Mustache library. Match existing `getPathValue()` pattern. |
| **Provider model** | Pluggable verifier registry | Each webhook source has different signature schemes. Easy to add new providers. |
| **Response behavior** | Always return 202 Accepted | Never block webhook sender on agent execution. Process asynchronously. |
| **Where to build** | `packages/core/src/webhooks/` | Part of core, not a separate package. Unlike Slack/Discord which have their own packages, webhooks are a core FleetManager feature. |

---

## 8. Files That Need Changes

| File | Change |
|------|--------|
| `packages/core/src/config/schema.ts` | Extend `WebhooksSchema` with `routes` array, extend `ScheduleSchema` with webhook-specific fields |
| `packages/core/src/fleet-manager/fleet-manager.ts` | Add `WebhookManager` initialization in `initialize()` and lifecycle in `start()`/`stop()` |
| `packages/core/src/fleet-manager/webhook-manager.ts` | **New file** -- manages webhook server lifecycle and event handling |
| `packages/core/src/webhooks/server.ts` | **New file** -- HTTP server with raw body, signature verification, routing |
| `packages/core/src/webhooks/router.ts` | **New file** -- route matching and prompt template rendering |
| `packages/core/src/webhooks/session-store.ts` | **New file** -- external ID to session ID mapping |
| `packages/core/src/webhooks/idempotency.ts` | **New file** -- delivery ID deduplication |
| `packages/core/src/webhooks/verifiers/linear.ts` | **New file** -- Linear HMAC-SHA256 signature verifier |
| `packages/core/src/webhooks/verifiers/github.ts` | **New file** -- GitHub signature verifier |
| `packages/core/src/webhooks/verifiers/registry.ts` | **New file** -- verifier registry pattern |
| `packages/core/src/webhooks/index.ts` | **New file** -- module exports |
| `docs/src/content/docs/concepts/triggers.md` | Update webhook trigger section from "Future" to documented |
