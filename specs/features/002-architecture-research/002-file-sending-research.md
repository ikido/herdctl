# File Sending from Agents: OpenClaw Research and herdctl Design

## Date: 2026-02-16

## Problem Statement

When a Claude Code agent running inside herdctl produces a file (e.g., via a `/pdf` skill, image generation, or any tool that creates binary output), how should that file be delivered back to the originating chat channel/thread (Slack, Discord, etc.)?

herdctl currently has no file delivery mechanism. The `SlackMessageEvent.reply()` function only accepts text strings. The agent process (a child process or Docker container) has no direct access to the Slack/Discord APIs.

---

## How OpenClaw Handles File Sending

OpenClaw (the open-source project at `~/projects/openclaw`) has a mature, multi-channel file delivery system. Here is how it works:

### Architecture Overview

OpenClaw's approach is **tool-based**: the AI agent is given a `message` tool that can send text AND media to any configured channel. The agent calls this tool directly during execution, and OpenClaw's infrastructure handles the actual upload.

```
Agent (Claude/GPT/etc.)
    |
    | calls tool: message({ action: "send", target: "#channel", media: "/path/to/file.pdf" })
    |
    v
message-tool.ts (agent tool definition)
    |
    v
message-action-runner.ts (resolves channel, target, normalizes media paths)
    |
    v
message-action-params.ts (sandbox path validation, media normalization)
    |
    v
outbound-send-service.ts (executes the send via plugin or core)
    |
    v
deliver.ts (channel-specific delivery: chunking, media upload, retries)
    |
    v
Channel adapter (e.g., slack/send.ts → Slack files.uploadV2 API)
```

### Key Components

#### 1. The `message` Tool (agent-facing)

File: `src/agents/tools/message-tool.ts`

The agent sees a single tool called `message` with an `action` parameter. For file sending, the relevant actions are:

- **`send`** with a `media` parameter (URL or local path)
- **`sendAttachment`** with `buffer` (base64), `contentType`, and `filename`

The tool schema exposes these parameters:

```typescript
// From message-tool.ts buildSendSchema()
{
  message: Type.Optional(Type.String()),
  media: Type.Optional(Type.String({
    description: "Media URL or local path. data: URLs are not supported here, use buffer.",
  })),
  filename: Type.Optional(Type.String()),
  buffer: Type.Optional(Type.String({
    description: "Base64 payload for attachments (optionally a data: URL).",
  })),
  contentType: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  filePath: Type.Optional(Type.String()),
  caption: Type.Optional(Type.String()),
}
```

The agent can send a file in two ways:

**Path-based (preferred for local files):**
```json
{
  "action": "send",
  "target": "#general",
  "media": "/workspace/output/report.pdf",
  "message": "Here is the report you requested."
}
```

**Buffer-based (for generated content):**
```json
{
  "action": "sendAttachment",
  "target": "#general",
  "buffer": "JVBERi0xLjQ...",
  "contentType": "application/pdf",
  "filename": "report.pdf",
  "caption": "Generated report"
}
```

#### 2. Sandbox Path Resolution

File: `src/agents/sandbox-paths.ts`

When agents run in a sandbox (Docker container), file paths must be resolved relative to the sandbox root. OpenClaw validates that:

- Paths don't escape the sandbox root (no `../` traversal)
- No symlink traversal attacks
- `file://` URLs are converted to filesystem paths
- HTTP/HTTPS URLs are passed through unchanged

```typescript
// From sandbox-paths.ts
export async function resolveSandboxedMediaSource(params: {
  media: string;
  sandboxRoot: string;
}): Promise<string> {
  const raw = params.media.trim();
  if (HTTP_URL_RE.test(raw)) return raw;  // URLs pass through
  // Local paths are validated against sandbox root
  const resolved = await assertSandboxPath({
    filePath: candidate,
    cwd: params.sandboxRoot,
    root: params.sandboxRoot,
  });
  return resolved.resolved;
}
```

#### 3. Media Normalization Pipeline

File: `src/infra/outbound/message-action-params.ts`

Before delivery, OpenClaw normalizes media parameters:

1. **`normalizeSandboxMediaParams()`** - Resolves local paths relative to sandbox root
2. **`normalizeSandboxMediaList()`** - Deduplicates and validates multiple media items
3. **`hydrateSendAttachmentParams()`** - For `sendAttachment` action: loads the file from disk, converts to base64 buffer, infers filename and content type

```typescript
// From message-action-params.ts
export async function hydrateSendAttachmentParams(params) {
  if (params.action !== "sendAttachment") return;

  const mediaSource = mediaHint ?? fileHint;
  if (!params.dryRun && !buffer && mediaSource) {
    const media = await loadWebMedia(mediaSource, maxBytes, { localRoots: "any" });
    params.args.buffer = media.buffer.toString("base64");
    params.args.contentType = media.contentType;
    params.args.filename = inferAttachmentFilename({ ... });
  }
}
```

#### 4. Channel-Specific Delivery

File: `src/slack/send.ts`

For Slack, the actual upload uses `files.uploadV2`:

```typescript
// From slack/send.ts
async function uploadSlackFile(params) {
  const { buffer, contentType, fileName } = await loadWebMedia(params.mediaUrl, params.maxBytes);
  const payload = {
    channel_id: params.channelId,
    file: buffer,
    filename: fileName,
    ...(params.caption ? { initial_comment: params.caption } : {}),
    ...(params.threadTs ? { thread_ts: params.threadTs } : {}),
  };
  const response = await params.client.files.uploadV2(payload);
  return fileId;
}
```

Key detail: the `threadTs` parameter ensures the file is uploaded into the correct Slack thread.

#### 5. Auto-Threading

File: `src/infra/outbound/message-action-params.ts`

OpenClaw automatically injects the originating thread's `threadTs` when the agent sends a message/file back to the same channel it received a message from. The agent doesn't need to know about threads -- OpenClaw's `toolContext` carries the originating thread information:

```typescript
export function resolveSlackAutoThreadId(params) {
  const context = params.toolContext;
  if (!context?.currentThreadTs || !context.currentChannelId) return undefined;
  // Only auto-thread when sending to the same channel
  if (parsedTarget.id !== context.currentChannelId) return undefined;
  return context.currentThreadTs;
}
```

#### 6. Delivery Queue (Crash Recovery)

File: `src/infra/outbound/delivery-queue.ts`

OpenClaw uses a write-ahead log for outbound messages. Before sending, the message is persisted to disk. After successful delivery, the entry is removed. On crash recovery, pending entries are replayed. This ensures files aren't lost if the process crashes during upload.

### Summary of OpenClaw's Approach

| Aspect | OpenClaw's Design |
|--------|------------------|
| **Signal mechanism** | Agent calls `message` tool with `media` or `buffer` param |
| **Path resolution** | Sandbox-aware path normalization with security checks |
| **Thread routing** | Auto-injected from `toolContext` (agent doesn't need to know) |
| **File loading** | Loaded from sandbox filesystem or HTTP URL |
| **Upload** | Channel-specific (Slack `files.uploadV2`, Discord attachments, etc.) |
| **Reliability** | Write-ahead delivery queue with retry/backoff |
| **Security** | Path traversal prevention, symlink checks, data URL rejection |

---

## herdctl's Current State

herdctl agents are Claude Code child processes (or Docker containers). The agent communicates with herdctl via:

1. **SDK messages** - Streamed back via stdout (system, assistant, tool_use, tool_result, result)
2. **`SlackMessageEvent.reply()`** - A closure that calls `say()` in the Bolt event handler (text only)
3. **`job:output` events** - FleetManager emits these for UI streaming

There is **no mechanism** for:
- The agent to signal "upload this file to the channel"
- The connector to receive file paths and upload them
- The agent to know its originating channel/thread context for file routing

### Critical Gap Analysis

| Need | herdctl Status |
|------|---------------|
| Agent produces a file | Agent can write files to its working directory |
| Agent signals "send this file" | **Missing** -- no tool, no event, no convention |
| File is uploaded to originating thread | **Missing** -- `reply()` only accepts text |
| File path security | **Missing** -- no sandbox path validation |
| Thread context for file routing | **Partially exists** -- `threadTs` is in `SlackMessageEvent.metadata` |

---

## Recommended Approach for herdctl

### Option A: Convention-Based Output Directory (Recommended for MVP)

**Simplest approach that works with Claude Code's existing capabilities.**

The agent writes files to a well-known directory, and herdctl watches for them and uploads post-execution or in real-time.

#### How It Works

1. herdctl sets an environment variable telling the agent where to write output files:
   ```
   HERDCTL_OUTPUT_DIR=/workspace/.herdctl/outputs
   ```

2. The agent (Claude Code) writes files there:
   ```bash
   # Inside the agent's Claude Code session, a /pdf skill would:
   # 1. Generate the PDF
   # 2. Write it to $HERDCTL_OUTPUT_DIR/report.pdf
   # 3. Write a manifest file describing what to do with it
   ```

3. The agent writes a JSON manifest alongside the file:
   ```json
   // .herdctl/outputs/report.pdf.manifest.json
   {
     "file": "report.pdf",
     "action": "send",
     "message": "Here is the generated report.",
     "contentType": "application/pdf"
   }
   ```

4. herdctl watches the output directory (via `fs.watch` or post-execution scan) and uploads files to the originating channel/thread.

#### Implementation Sketch

```typescript
// packages/core/src/runner/file-output-watcher.ts

import { watch, readFile, readdir, unlink } from "node:fs/promises";
import { join, basename } from "node:path";

interface FileOutputManifest {
  file: string;
  action: "send";
  message?: string;
  contentType?: string;
}

interface FileOutputHandler {
  onFileReady(manifest: FileOutputManifest, filePath: string): Promise<void>;
}

export class FileOutputWatcher {
  private outputDir: string;
  private handler: FileOutputHandler;
  private abortController: AbortController;

  constructor(outputDir: string, handler: FileOutputHandler) {
    this.outputDir = outputDir;
    this.handler = handler;
    this.abortController = new AbortController();
  }

  async start(): Promise<void> {
    // Ensure output directory exists
    await mkdir(this.outputDir, { recursive: true });

    // Watch for new manifest files
    const watcher = watch(this.outputDir, {
      signal: this.abortController.signal,
    });

    for await (const event of watcher) {
      if (event.filename?.endsWith(".manifest.json")) {
        await this.processManifest(event.filename);
      }
    }
  }

  private async processManifest(manifestFilename: string): Promise<void> {
    const manifestPath = join(this.outputDir, manifestFilename);
    const content = await readFile(manifestPath, "utf-8");
    const manifest: FileOutputManifest = JSON.parse(content);
    const filePath = join(this.outputDir, manifest.file);

    await this.handler.onFileReady(manifest, filePath);

    // Clean up after delivery
    await unlink(manifestPath).catch(() => {});
    await unlink(filePath).catch(() => {});
  }

  stop(): void {
    this.abortController.abort();
  }
}
```

```typescript
// In the Slack connector, the handler would upload the file:

import { WebClient } from "@slack/web-api";

class SlackFileUploader implements FileOutputHandler {
  constructor(
    private client: WebClient,
    private channelId: string,
    private threadTs: string,
  ) {}

  async onFileReady(manifest: FileOutputManifest, filePath: string): Promise<void> {
    const fileBuffer = await readFile(filePath);
    await this.client.files.uploadV2({
      channel_id: this.channelId,
      file: fileBuffer,
      filename: manifest.file,
      initial_comment: manifest.message ?? "",
      thread_ts: this.threadTs,
    });
  }
}
```

#### Pros and Cons

| Pros | Cons |
|------|------|
| Works with any agent runtime (native, Docker) | Requires filesystem watching |
| No changes to Claude Code SDK needed | Manifest format is a convention that must be documented |
| Agent-agnostic (any tool/skill can use it) | Slight delay between file write and upload |
| Simple to implement | Agent must know about the convention |

### Option B: Tool Result with File Reference (Medium Complexity)

**Intercept tool results that contain file paths and upload them.**

When Claude Code uses the `Write` tool (or any tool that creates a file), the tool result is streamed back as an SDK message. herdctl could intercept these and check if the file should be uploaded.

#### How It Works

1. The agent's system prompt or CLAUDE.md instructs it:
   ```
   When you need to send a file to the user, write it to $HERDCTL_OUTPUT_DIR
   and then output a structured message:

   [HERDCTL_FILE_SEND]
   path: /workspace/.herdctl/outputs/report.pdf
   message: Here is the generated report.
   [/HERDCTL_FILE_SEND]
   ```

2. The message processor (`processSDKMessage`) looks for this pattern in assistant messages and emits a `job:file-output` event.

3. The connector listens for `job:file-output` and uploads the file.

This approach is fragile because it relies on parsing free-text output from the LLM.

### Option C: MCP Tool (Ideal, Higher Complexity)

**Expose an MCP server that provides a `send_file` tool to the agent.**

herdctl could run an MCP server that the Claude Code agent connects to. The MCP server exposes a `send_file` tool:

```typescript
// MCP tool definition
{
  name: "herdctl_send_file",
  description: "Send a file to the originating chat channel/thread",
  parameters: {
    file_path: { type: "string", description: "Path to the file to send" },
    message: { type: "string", description: "Optional message to accompany the file" },
    filename: { type: "string", description: "Override filename for the upload" },
  }
}
```

When the agent calls this tool, the MCP server:
1. Validates the file path (sandbox checks)
2. Reads the file
3. Uploads it to the originating channel/thread (via the Slack/Discord client)
4. Returns success/failure to the agent

#### How It Maps to `/pdf` Skill

```
User: @bot generate a PDF report on Q4 metrics

herdctl:
  1. Receives Slack message (channel=C123, threadTs=1234.5678)
  2. Creates job for agent "analyst"
  3. Starts Claude Code with MCP server config:
     --mcp-config '{"herdctl": {"command": "herdctl-mcp", "args": ["--channel=C123", "--thread=1234.5678"]}}'

Agent (Claude Code):
  1. Receives prompt
  2. Invokes /pdf skill → generates report.pdf
  3. Calls MCP tool: herdctl_send_file({ file_path: "report.pdf", message: "Q4 report" })

herdctl MCP server:
  1. Receives tool call
  2. Reads report.pdf from agent workspace
  3. Calls Slack files.uploadV2 with channel=C123, thread_ts=1234.5678
  4. Returns { success: true, fileId: "F12345" } to agent
```

#### Pros and Cons

| Pros | Cons |
|------|------|
| Clean tool interface for the agent | Requires MCP server implementation |
| Real-time delivery (no polling/watching) | MCP server lifecycle management |
| Agent gets confirmation of upload | More complex setup |
| Works with Claude Code's native MCP support | Need to pass channel/thread context to MCP server |

---

## Recommended Implementation Path

### Phase 1: Convention-Based (MVP)

Use **Option A** for the initial implementation:

1. Set `HERDCTL_OUTPUT_DIR` environment variable for agents
2. After job completion, scan the output directory for manifest files
3. Upload any discovered files to the originating channel/thread
4. Document the convention in agent CLAUDE.md files

This requires minimal changes:
- Add output dir setup in job executor
- Add post-job file scan in connector
- Add `uploadFile` method to `SlackMessageEvent`
- Update `SlackMessageEvent` type to expose `channelId` and `threadTs` for file upload

### Phase 2: Real-Time File Watcher

Upgrade to real-time delivery:
- Add `fs.watch` on the output directory during job execution
- Upload files as soon as manifest appears (don't wait for job completion)
- Add cleanup on job completion

### Phase 3: MCP Tool (Production)

Implement **Option C** for production use:
- Build an MCP server that exposes `send_file`, `send_image`, etc.
- Inject MCP config when starting Claude Code agents
- Remove dependency on filesystem conventions

---

## Concrete Implementation for `/pdf` Skill + Slack

### What the `/pdf` Skill Should Do

The `/pdf` skill (a Claude Code slash command) needs to know it's running inside herdctl and write its output accordingly.

#### Skill CLAUDE.md Instructions

```markdown
## File Output Convention (herdctl)

When running inside herdctl (detected by the presence of `HERDCTL_OUTPUT_DIR`
environment variable), write generated files to `$HERDCTL_OUTPUT_DIR/` and create
a manifest file alongside each output file.

### Manifest Format

For each file you want to send to the chat channel, create a companion
`.manifest.json` file:

    $HERDCTL_OUTPUT_DIR/<filename>.manifest.json

Contents:
{
  "file": "<filename>",
  "action": "send",
  "message": "Optional message to accompany the file",
  "contentType": "application/pdf"
}

### Example

To send a generated PDF:

1. Write the PDF: $HERDCTL_OUTPUT_DIR/report.pdf
2. Write the manifest: $HERDCTL_OUTPUT_DIR/report.pdf.manifest.json

herdctl will automatically upload the file to the originating Slack thread
or Discord channel.
```

### Required herdctl Changes

#### 1. Add `replyWithFile` to `SlackMessageEvent`

```typescript
// packages/slack/src/types.ts

export interface SlackMessageEvent {
  agentName: string;
  prompt: string;
  metadata: {
    channelId: string;
    threadTs: string;
    messageTs: string;
    userId: string;
    wasMentioned: boolean;
  };
  reply: (content: string) => Promise<void>;
  replyWithFile: (params: {
    filePath: string;
    filename?: string;
    message?: string;
    contentType?: string;
  }) => Promise<void>;
  startProcessingIndicator: () => () => void;
}
```

#### 2. Implement `replyWithFile` in `SlackConnector`

```typescript
// packages/slack/src/slack-connector.ts

const replyWithFile = async (params: {
  filePath: string;
  filename?: string;
  message?: string;
  contentType?: string;
}): Promise<void> => {
  const fileBuffer = await readFile(params.filePath);
  const filename = params.filename ?? basename(params.filePath);

  await this.app.client.files.uploadV2({
    channel_id: channelId,
    file: fileBuffer,
    filename,
    initial_comment: params.message ?? "",
    thread_ts: threadTs,
  });

  this.messagesSent++;
};
```

#### 3. Add Output Directory Setup in Job Executor

```typescript
// packages/core/src/runner/runtime/cli-runtime.ts (or similar)

// When starting a job, set the output directory env var
const outputDir = join(workingDirectory, ".herdctl", "outputs");
await mkdir(outputDir, { recursive: true });

env.HERDCTL_OUTPUT_DIR = outputDir;
```

#### 4. Add Post-Job File Scan

```typescript
// packages/core/src/fleet-manager/job-manager.ts (or new module)

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface FileDeliveryRequest {
  filePath: string;
  filename: string;
  message?: string;
  contentType?: string;
}

export async function scanOutputDirectory(
  outputDir: string
): Promise<FileDeliveryRequest[]> {
  const entries = await readdir(outputDir).catch(() => []);
  const manifests = entries.filter((e) => e.endsWith(".manifest.json"));
  const requests: FileDeliveryRequest[] = [];

  for (const manifestFile of manifests) {
    try {
      const content = await readFile(join(outputDir, manifestFile), "utf-8");
      const manifest = JSON.parse(content);
      const filePath = join(outputDir, manifest.file);
      requests.push({
        filePath,
        filename: manifest.file,
        message: manifest.message,
        contentType: manifest.contentType,
      });
    } catch {
      // Skip malformed manifests
    }
  }

  return requests;
}
```

---

## Comparison: OpenClaw vs Recommended herdctl Approach

| Aspect | OpenClaw | herdctl (Recommended) |
|--------|----------|-----------------------|
| **Agent signaling** | Built-in `message` tool with `media` param | Filesystem convention (`HERDCTL_OUTPUT_DIR` + manifest) |
| **Path security** | Sandbox path validation with symlink checks | Phase 1: basic path validation; Phase 3: sandbox checks |
| **Thread routing** | Auto-injected from `toolContext` | Captured from `SlackMessageEvent.metadata` |
| **Upload mechanism** | Per-channel adapters (plugin system) | Direct Slack/Discord API call from connector |
| **Reliability** | Write-ahead delivery queue with retry | Phase 1: best-effort; Phase 2+: delivery queue |
| **Real-time vs batch** | Real-time (tool call = immediate send) | Phase 1: post-job scan; Phase 2: real-time watcher |
| **Agent awareness** | Agent explicitly calls tool | Agent writes file + manifest |
| **Multi-channel** | Plugin architecture handles all channels | Each connector implements `replyWithFile` |

### Why Not Copy OpenClaw Exactly?

OpenClaw's approach is deeply integrated: the `message` tool is injected into the agent's tool set at session creation, with full channel/account/thread context. This works because OpenClaw controls the entire agent lifecycle.

herdctl uses Claude Code as an opaque child process. At the time of this writing, it was believed we could not inject custom tools into Claude Code's tool set without a separate MCP server process. **See Option D below** -- the SDK actually supports in-process MCP servers via `createSdkMcpServer()`, which means herdctl CAN inject custom tools that run in its own process. This changes the recommendation significantly.

---

## Option D: SDK Tool Injection (In-Process MCP Server)

### Date: 2026-02-16

### Motivation

Options A-C were written under the assumption that herdctl cannot inject custom tools into a Claude Code agent's tool set. **This assumption is wrong.** The Claude Agent SDK (v0.1.77) provides first-class support for in-process MCP servers via `createSdkMcpServer()` and `tool()`. This means herdctl can define a `send_file` tool that runs inside the herdctl process itself -- no separate MCP server binary, no filesystem watching, no convention-based manifests.

### SDK Research Findings

#### 1. The SDK supports in-process MCP tool definitions

The SDK exports two key functions in `@anthropic-ai/claude-agent-sdk`:

```typescript
// From entrypoints/agentSdkTypes.d.ts

export declare function tool<Schema extends AnyZodRawShape>(
  _name: string,
  _description: string,
  _inputSchema: Schema,
  _handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>
): SdkMcpToolDefinition<Schema>;

export declare function createSdkMcpServer(
  _options: CreateSdkMcpServerOptions
): McpSdkServerConfigWithInstance;

type CreateSdkMcpServerOptions = {
  name: string;
  version?: string;
  tools?: Array<SdkMcpToolDefinition<any>>;
};
```

The `tool()` function creates a tool definition with a Zod schema and a handler function. The `createSdkMcpServer()` function wraps these tools into an MCP server instance that runs in-process (same Node.js process as herdctl).

#### 2. The SDK Options type accepts in-process MCP servers

The `Options` type for `query()` includes:

```typescript
// From entrypoints/sdk/runtimeTypes.d.ts

export type Options = {
  // ...
  mcpServers?: Record<string, McpServerConfig>;
  // ...
};

// McpServerConfig is a union:
export type McpServerConfig =
  | McpStdioServerConfig        // { type?: 'stdio', command, args, env }
  | McpSSEServerConfig          // { type: 'sse', url, headers }
  | McpHttpServerConfig         // { type: 'http', url, headers }
  | McpSdkServerConfigWithInstance;  // { type: 'sdk', name, instance: McpServer }
```

The `McpSdkServerConfigWithInstance` type includes an actual `McpServer` instance (from `@modelcontextprotocol/sdk`). This is explicitly non-serializable -- it runs in the SDK caller's process.

#### 3. The `SdkMcpToolDefinition` handler runs in herdctl's process

```typescript
// From entrypoints/sdk/runtimeTypes.d.ts

export type SdkMcpToolDefinition<Schema extends AnyZodRawShape = AnyZodRawShape> = {
  name: string;
  description: string;
  inputSchema: Schema;
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>;
};
```

The handler is a plain async function. When the agent calls this tool, the SDK invokes the handler in herdctl's process. The handler has full access to herdctl's context -- Slack client, channel/thread info, filesystem, etc. No IPC, no subprocess, no serialization boundary.

#### 4. Dynamic MCP servers via `Query.setMcpServers()`

The `Query` interface also supports dynamically adding/removing MCP servers mid-session:

```typescript
// From entrypoints/sdk/runtimeTypes.d.ts

export interface Query extends AsyncGenerator<SDKMessage, void> {
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  // ...
}
```

This means herdctl could add/remove the `send_file` tool dynamically without restarting the agent session. However, for MVP this is unnecessary -- configuring it at session start is sufficient.

#### 5. How herdctl currently passes MCP servers (and the gap)

In `packages/core/src/runner/sdk-adapter.ts`, the `toSDKOptions()` function transforms agent MCP server configs:

```typescript
// Current implementation -- only handles stdio/http types
export function transformMcpServer(server: McpServer): SDKMcpServerConfig {
  const result: SDKMcpServerConfig = {};
  if (server.url) {
    result.type = "http";
    result.url = server.url;
  }
  if (server.command) {
    result.command = server.command;
  }
  // ...
  return result;
}
```

The current `SDKMcpServerConfig` type in herdctl's `types.ts` only models stdio/http configs:

```typescript
export interface SDKMcpServerConfig {
  type?: "http";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}
```

This type does not include `McpSdkServerConfigWithInstance` (the in-process SDK server type). herdctl would need to update its types and SDK adapter to support passing in-process MCP servers alongside the existing stdio/http servers.

#### 6. The SDK handles tool execution automatically

The SDK streams messages via the `query()` async generator. When the agent invokes a tool, the SDK automatically:
1. Receives the `tool_use` content block from the API response
2. Routes it to the appropriate handler (built-in tool, MCP server, or SDK MCP server)
3. Executes the handler
4. Sends the `tool_result` back to the API
5. Continues the conversation

herdctl does NOT need to intercept tool calls or inject tool results manually. The SDK MCP server handler runs transparently. herdctl's message processor will see `tool_use` and `tool_result` messages in the stream, but does not need to handle them specially.

This is visible in the message processor at `packages/core/src/runner/message-processor.ts` -- it already processes `tool_use` and `tool_result` message types (as well as `assistant` messages containing tool use content blocks in the newer SDK format). These messages flow through as observability data; the SDK handles the actual execution loop.

#### 7. Long-running tool timeout

The SDK docs note: "If your SDK MCP calls will run longer than 60s, override `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`." File uploads to Slack are typically fast (under 10s for most files), but large files or slow networks could hit this. We should set this env var to a safe value (e.g., 120s) when starting agents with file-sending capabilities.

### Proposed Architecture

```
User sends Slack message: "@bot generate a PDF report"

SlackConnector:
  1. Receives Slack message (channelId=C123, threadTs=1234.5678)
  2. Creates SlackMessageEvent with reply() and metadata
  3. Emits 'message' event

FleetManager / MessageHandler:
  1. Receives SlackMessageEvent
  2. Before calling executeJob(), creates an in-process MCP server:
     - tool("herdctl_send_file", ..., handler) where handler
       captures channelId, threadTs, and the Slack WebClient
  3. Injects the MCP server into the agent's SDK options
  4. Calls executeJob() with the modified agent config

Agent (Claude Code, running via SDK):
  1. Receives prompt
  2. Generates report.pdf (using built-in tools)
  3. Calls MCP tool: herdctl_send_file({ file_path: "report.pdf", message: "Q4 report" })

SDK (in herdctl's process):
  1. Routes tool call to the in-process MCP server handler
  2. Handler reads report.pdf from agent's working directory
  3. Handler calls Slack files.uploadV2 with channelId=C123, threadTs=1234.5678
  4. Handler returns { content: [{ type: "text", text: "File uploaded: F12345" }] }

Agent:
  5. Receives tool result confirming upload
  6. Responds to user: "I've generated and uploaded the Q4 report."
```

### Implementation Sketch

#### 1. Define the `send_file` tool factory

```typescript
// packages/core/src/runner/file-sender-mcp.ts

import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "node:fs/promises";
import { basename, resolve, relative } from "node:path";
import type { McpSdkServerConfigWithInstance } from "./types.js";

/**
 * Context needed to route file uploads back to the originating channel/thread.
 * Provided by the connector (Slack, Discord, etc.) when creating the MCP server.
 */
export interface FileSenderContext {
  /**
   * Upload a file to the originating channel/thread.
   * Each connector implements this differently (Slack files.uploadV2, Discord attachments, etc.)
   */
  uploadFile: (params: {
    fileBuffer: Buffer;
    filename: string;
    message?: string;
    contentType?: string;
  }) => Promise<{ fileId: string }>;

  /**
   * The agent's working directory root, for path validation.
   */
  workingDirectory: string;
}

/**
 * Create an in-process MCP server that provides file-sending tools.
 *
 * The returned server config can be merged into the agent's mcpServers option
 * when calling the SDK's query() function.
 *
 * @param context - File sender context with upload function and working directory
 * @returns MCP server config with instance, ready for SDK options
 */
export function createFileSenderMcpServer(
  context: FileSenderContext
): McpSdkServerConfigWithInstance {
  const sendFileTool = tool(
    "herdctl_send_file",
    "Send a file from the working directory to the originating chat channel/thread. " +
    "Use this when the user asks you to share, send, or upload a file you've created. " +
    "The file must exist in your working directory.",
    {
      file_path: z.string().describe(
        "Path to the file to send. Can be absolute or relative to the working directory."
      ),
      message: z.string().optional().describe(
        "Optional message to accompany the file upload."
      ),
      filename: z.string().optional().describe(
        "Override the filename for the upload. Defaults to the basename of file_path."
      ),
    },
    async (args) => {
      try {
        // Resolve the file path relative to working directory
        const resolvedPath = resolve(context.workingDirectory, args.file_path);

        // Security: ensure the resolved path is within the working directory
        const rel = relative(context.workingDirectory, resolvedPath);
        if (rel.startsWith("..") || resolve(resolvedPath) !== resolvedPath.replace(/\/+$/, "")) {
          return {
            content: [{ type: "text", text: `Error: file path escapes working directory: ${args.file_path}` }],
            isError: true,
          };
        }

        // Read the file
        const fileBuffer = await readFile(resolvedPath);
        const filename = args.filename ?? basename(resolvedPath);

        // Upload via the connector
        const result = await context.uploadFile({
          fileBuffer,
          filename,
          message: args.message,
        });

        return {
          content: [{
            type: "text",
            text: `File "${filename}" uploaded successfully (ID: ${result.fileId}).`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error uploading file: ${message}` }],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: "herdctl-file-sender",
    version: "0.1.0",
    tools: [sendFileTool],
  });
}
```

#### 2. Slack connector creates the file sender context

```typescript
// In packages/slack/src/message-handler.ts or slack-connector.ts

import { createFileSenderMcpServer, type FileSenderContext } from "@herdctl/core";

function buildFileSenderContext(
  slackClient: WebClient,
  channelId: string,
  threadTs: string,
  workingDirectory: string
): FileSenderContext {
  return {
    workingDirectory,
    uploadFile: async (params) => {
      const response = await slackClient.files.uploadV2({
        channel_id: channelId,
        file: params.fileBuffer,
        filename: params.filename,
        initial_comment: params.message ?? "",
        thread_ts: threadTs,
      });

      // Extract file ID from response
      const fileId = response.files?.[0]?.id ?? "unknown";
      return { fileId };
    },
  };
}
```

#### 3. Inject the MCP server into agent execution

```typescript
// In the message handler, when processing a SlackMessageEvent:

async function handleSlackMessage(event: SlackMessageEvent) {
  const agent = resolveAgent(event.agentName);
  const workingDirectory = resolveWorkingDirectory(agent);

  // Create the file sender MCP server for this specific message context
  const fileSenderServer = createFileSenderMcpServer(
    buildFileSenderContext(
      slackClient,
      event.metadata.channelId,
      event.metadata.threadTs,
      workingDirectory,
    )
  );

  // Merge into agent's MCP servers
  // The SDK adapter needs to be updated to handle McpSdkServerConfigWithInstance
  const mcpServers = {
    ...transformMcpServers(agent.mcp_servers),
    "herdctl-file-sender": fileSenderServer,
  };

  // Execute the job with the injected MCP server
  const result = await executeJob(runtime, {
    agent: {
      ...agent,
      // Override mcp_servers is not enough -- we need to pass the SDK-format
      // servers directly. This requires changes to the SDK adapter flow.
    },
    prompt: event.prompt,
    stateDir,
  });
}
```

#### 4. Required changes to SDK adapter

The current `SDKMcpServerConfig` type in `packages/core/src/runner/types.ts` only models serializable configs. To support in-process MCP servers, we need to:

```typescript
// packages/core/src/runner/types.ts

// Add SDK MCP server type
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface SDKMcpSdkServerConfig {
  type: "sdk";
  name: string;
  instance: McpServer;
}

// Update the union type used in SDKQueryOptions
export type SDKMcpServerConfigUnion = SDKMcpServerConfig | SDKMcpSdkServerConfig;

export interface SDKQueryOptions {
  // ...
  mcpServers?: Record<string, SDKMcpServerConfigUnion>;
  // ...
}
```

Alternatively (and simpler), keep the existing `SDKMcpServerConfig` for the agent config layer and allow `SDKQueryOptions.mcpServers` to accept the real SDK `McpServerConfig` union type directly:

```typescript
// In SDKRuntime.execute(), merge in-process servers with config-derived servers:

const configServers = toSDKOptions(options.agent).mcpServers ?? {};
const injectedServers = options.injectedMcpServers ?? {};
const allServers = { ...configServers, ...injectedServers };

const messages = query({
  prompt: options.prompt,
  options: { ...sdkOptions, mcpServers: allServers },
});
```

This avoids changing the config schema and keeps the injection as a runtime concern.

### How This Works with the Message Stream

The key insight: **herdctl does NOT need to intercept tool calls.** The SDK handles the entire tool execution loop internally:

1. The SDK sends the prompt to the Anthropic API
2. The API responds with an `assistant` message containing a `tool_use` content block for `herdctl_send_file`
3. The SDK sees this is an MCP tool on the `herdctl-file-sender` server
4. The SDK calls the handler function (which runs in herdctl's process)
5. The handler reads the file, uploads to Slack, returns a `CallToolResult`
6. The SDK sends the tool result back to the API as a `user` message
7. The API continues the conversation
8. herdctl's message processor sees all of this as normal `assistant` and `user` messages in the stream

The message processor in `packages/core/src/runner/message-processor.ts` already handles these message types for logging/observability. No changes needed there.

### CLI Runtime Considerations

The in-process MCP server approach only works with the **SDK runtime** (`SDKRuntime`). The CLI runtime (`CLIRuntime`) spawns Claude as a separate process and watches session files. It cannot share in-process MCP server instances.

For CLI runtime, the fallback approach is:
- Use the agent config's `mcp_servers` to specify a stdio-based MCP server
- herdctl would need to ship a small MCP server script/binary that communicates via stdio
- Or fall back to Option A (filesystem convention) for CLI runtime agents

This is an acceptable limitation since:
- SDK runtime is the default and recommended runtime
- CLI runtime is primarily for Max plan pricing, which is a secondary concern for file-sending agents
- The agent config can specify `runtime: "sdk"` for agents that need file-sending capabilities

### PDF Conversion Considerations

The user asks about herdctl converting files to PDF before sending. With the SDK tool injection approach, there are two paths:

1. **Agent generates the PDF**: The agent uses its built-in tools (Bash with a PDF library, /pdf skill, etc.) to create the PDF, then calls `herdctl_send_file` to upload it. This is the simpler approach and keeps herdctl focused on plumbing.

2. **herdctl converts to PDF**: A separate tool `herdctl_send_as_pdf` could accept a source file (Markdown, HTML, etc.), convert it to PDF using a library like `puppeteer` or `@react-pdf/renderer`, then upload. This adds complexity to herdctl but provides a more integrated experience.

For MVP, approach 1 is recommended. The agent has access to Bash and can use tools like `pandoc`, `wkhtmltopdf`, or Node-based PDF libraries. The `/pdf` skill in Claude Code already handles PDF generation.

### Comparison with Other Options

| Aspect | Option A (Convention) | Option B (Text Parsing) | Option C (Separate MCP) | **Option D (SDK Injection)** |
|--------|----------------------|------------------------|------------------------|---------------------------|
| **Complexity** | Low | Low | Medium | **Low-Medium** |
| **Reliability** | Medium (fs.watch quirks) | Low (LLM output parsing) | High | **High** |
| **Real-time delivery** | No (post-job or polling) | No (post-job) | Yes | **Yes** |
| **Agent gets confirmation** | No | No | Yes | **Yes** |
| **Requires separate binary** | No | No | Yes (MCP server) | **No** |
| **Works with SDK runtime** | Yes | Yes | Yes | **Yes** |
| **Works with CLI runtime** | Yes | Yes | Yes | **No (SDK only)** |
| **Path security** | Manual validation | No validation | Manual validation | **In handler** |
| **Thread context** | Env var + manifest | Text convention | CLI args to MCP server | **Closure capture** |
| **Dependencies** | fs.watch | Regex parsing | MCP server lifecycle | **@modelcontextprotocol/sdk** |

### Recommendation Update

**Option D should replace Option C as the production target and may even replace Option A as the MVP approach.**

The implementation is simpler than Option A (no filesystem watching, no manifest format, no post-job scan) while being more reliable (real-time delivery, agent confirmation, proper error handling). The only downside is CLI runtime incompatibility, which is an acceptable tradeoff.

#### Revised implementation path:

1. **Phase 1 (MVP): Option D for SDK runtime** -- Implement `createFileSenderMcpServer()` and inject it when starting agents from Slack/Discord. This gives us real-time file delivery with agent confirmation immediately.

2. **Phase 2: Add `send_files` (batch upload)** -- Add a second tool for uploading multiple files at once, to avoid N sequential tool calls when the agent has multiple files.

3. **Phase 3: CLI runtime fallback** -- If CLI runtime agents need file sending, implement a stdio MCP server wrapper that delegates to the same `FileSenderContext` interface.

---

## References

- OpenClaw source: `~/projects/openclaw/`
  - `src/agents/tools/message-tool.ts` - Agent-facing message tool
  - `src/infra/outbound/message-action-runner.ts` - Message action orchestration
  - `src/infra/outbound/message-action-params.ts` - Media normalization and sandbox validation
  - `src/infra/outbound/deliver.ts` - Channel-specific delivery with retry
  - `src/slack/send.ts` - Slack file upload implementation
  - `src/agents/sandbox-paths.ts` - Sandbox path security
- herdctl source: `~/projects/herdctl/`
  - `packages/slack/src/slack-connector.ts` - Current Slack connector (text-only replies)
  - `packages/slack/src/types.ts` - `SlackMessageEvent` type definition
  - `packages/core/src/runner/message-processor.ts` - SDK message processing
  - `packages/core/src/runner/sdk-adapter.ts` - Agent config to SDK options transformation
  - `packages/core/src/runner/runtime/sdk-runtime.ts` - SDK runtime (calls `query()`)
  - `packages/core/src/runner/runtime/interface.ts` - RuntimeInterface definition
  - `packages/core/src/runner/types.ts` - SDKQueryOptions and SDKMcpServerConfig types
  - `packages/core/src/runner/job-executor.ts` - Job execution lifecycle
  - `packages/core/src/fleet-manager/event-emitters.ts` - FleetManager event system
  - `specs/features/002-architecture-research/001-architecture-qa.md` - Prior architecture notes
- Claude Agent SDK (v0.1.77): `packages/core/node_modules/@anthropic-ai/claude-agent-sdk/`
  - `entrypoints/agentSdkTypes.d.ts` - Main SDK exports: `query()`, `tool()`, `createSdkMcpServer()`
  - `entrypoints/sdk/runtimeTypes.d.ts` - `Options` type, `Query` interface, `McpServerConfig` union, `SdkMcpToolDefinition`
  - `entrypoints/sdk/coreTypes.d.ts` - `SDKMessage` types, `McpSdkServerConfig`, `AgentDefinition`
  - `sdk-tools.d.ts` - Built-in tool input schemas (Bash, Read, Edit, etc.)
