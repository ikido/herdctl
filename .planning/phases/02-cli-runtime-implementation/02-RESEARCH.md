# Phase 02: CLI Runtime Implementation - Research

**Researched:** 2026-01-31
**Domain:** Process spawning, file watching, JSONL parsing
**Confidence:** HIGH

## Summary

This phase implements CLIRuntime, a RuntimeInterface implementation that executes Claude via the `claude` CLI instead of the SDK. This enables Max plan users to leverage CLI-based execution while maintaining the same streaming message interface (AsyncIterable<SDKMessage>) used by SDKRuntime.

The implementation requires three core capabilities: process spawning via execa, file watching via chokidar for session file updates, and JSONL parsing to convert CLI output to SDKMessage format. The CLI's `--output-format stream-json --verbose` mode provides real-time streaming output that closely matches the SDK message format.

**Primary recommendation:** Use execa v9+ for process spawning with AbortController support, chokidar v5 for file watching with awaitWriteFinish for debouncing, and parse the CLI's stream-json output directly to SDKMessage format. CLI sessions should be stored in a separate directory from SDK sessions to prevent path conflicts.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| execa | ^9.6.1 | Process spawning | Industry standard for Node.js process execution. Provides promise-based API, proper cleanup, Windows support, AbortController integration, and streaming |
| chokidar | ^5.0.0 | File watching | Used by 30M+ repos. Cross-platform, efficient fs.watch-based implementation, handles atomic writes |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| readline | built-in | JSONL line parsing | Part of Node.js, use for parsing newline-delimited JSON streams |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| execa | child_process | Native but lacks promise API, Windows quirks, no automatic cleanup |
| chokidar | fs.watch | Native but platform inconsistencies, no debouncing, no atomic write handling |
| chokidar | @parcel/watcher | Faster but less battle-tested, different API |

**Installation:**
```bash
pnpm add execa@^9 chokidar@^5 --filter @herdctl/core
```

## Architecture Patterns

### Recommended Project Structure
```
packages/core/src/runner/runtime/
├── interface.ts          # RuntimeInterface (existing)
├── sdk-runtime.ts        # SDKRuntime (existing)
├── cli-runtime.ts        # CLIRuntime (new)
├── cli-session-path.ts   # CLI session path utilities (new)
├── cli-output-parser.ts  # stream-json to SDKMessage parser (new)
├── factory.ts            # RuntimeFactory (update)
└── index.ts              # Barrel exports (update)
```

### Pattern 1: Dual-Mode Output Parsing
**What:** CLIRuntime can parse output from two sources: stdout stream-json OR session file watching
**When to use:** Primary mode is stdout parsing. File watching is fallback for session persistence/resume scenarios
**Example:**
```typescript
// Source: Claude CLI docs + SDKMessage interface
async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
  const subprocess = execa('claude', [
    '-p', options.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',  // Required for headless
    ...(options.resume ? ['--resume', options.resume] : []),
    ...(options.fork ? ['--fork-session'] : []),
  ], {
    cwd: options.agent.workspace?.root,
    cancelSignal: options.abortController?.signal,
  });

  // Parse stdout as NDJSON
  for await (const line of subprocess.stdout) {
    const message = JSON.parse(line);
    yield this.toSDKMessage(message);
  }
}
```

### Pattern 2: Session File Path Encoding
**What:** Claude CLI encodes workspace paths by replacing slashes with hyphens
**When to use:** When determining where CLI session files are stored
**Example:**
```typescript
// Source: Observed CLI behavior
function getCliSessionDir(workspacePath: string): string {
  // /Users/ed/Code/myproject -> -Users-ed-Code-myproject
  const encoded = workspacePath.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}
```

### Pattern 3: Separate CLI Session Storage
**What:** Store herdctl's CLI session references separately from SDK sessions
**When to use:** When managing session state to prevent path conflicts
**Example:**
```typescript
// .herdctl/sessions/       <- SDK sessions (existing)
// .herdctl/cli-sessions/   <- CLI session references (new)

interface CLISessionInfo {
  agent_name: string;
  session_id: string;  // UUID from CLI
  session_file: string;  // Full path to CLI's .jsonl file
  created_at: string;
  last_used_at: string;
}
```

### Anti-Patterns to Avoid
- **Polling for output:** Don't poll the session file for updates. Use chokidar's change events or stdout streaming
- **Mixing session storage:** Don't store CLI session IDs in SDK session files. They use different ID formats and storage
- **Ignoring exit codes:** Always check subprocess exit code even when streaming succeeds

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process spawning | Custom child_process wrapper | execa | Handles Windows shebangs, PATHEXT, zombie process cleanup, proper signal forwarding |
| File watching | fs.watch/fs.watchFile | chokidar | Platform normalization, debouncing, atomic write detection |
| JSONL parsing | Manual string splitting | readline or for-await on stdout | Handles partial lines, backpressure, proper buffering |
| AbortController integration | Custom signal handling | execa's cancelSignal | Proper cleanup, signal forwarding, timeout support |

**Key insight:** Process management and file watching have many edge cases (Windows paths, atomic writes, zombie processes, signal handling) that are well-solved by established libraries.

## Common Pitfalls

### Pitfall 1: Race Condition on Session File Reads
**What goes wrong:** Reading session file while Claude CLI is still writing causes partial JSON reads
**Why it happens:** File systems don't provide atomic multi-line writes; Claude writes incrementally
**How to avoid:** Use chokidar's `awaitWriteFinish` option with stabilityThreshold (default 2000ms)
**Warning signs:** JSON.parse errors on valid-looking data, truncated messages

### Pitfall 2: Session ID Format Mismatch
**What goes wrong:** Trying to resume CLI sessions with SDK or vice versa fails silently
**Why it happens:** CLI uses UUIDs (e.g., `dda6da5b-8788-4990-a582-d5a2c63fbfba`), SDK may use different format
**How to avoid:** Store runtime type alongside session ID in session info; validate format before resume
**Warning signs:** Resume attempts that start fresh sessions instead of continuing

### Pitfall 3: Missing --verbose Flag
**What goes wrong:** Output format is incomplete, missing tool use details
**Why it happens:** `--output-format stream-json` requires `--verbose` flag for full output
**How to avoid:** Always include both flags together: `--output-format stream-json --verbose`
**Warning signs:** Messages missing tool_use details, incomplete conversation flow

### Pitfall 4: Permission Mode Misconfiguration
**What goes wrong:** Agent hangs waiting for permission prompts that never come
**Why it happens:** CLI headless mode requires explicit permission handling
**How to avoid:** Use `--dangerously-skip-permissions` OR configure `--allowedTools` explicitly
**Warning signs:** Process hangs, no output after tool invocation

### Pitfall 5: Working Directory Path Encoding
**What goes wrong:** Can't find or watch session files
**Why it happens:** CLI encodes paths by replacing `/` with `-`, including the leading slash
**How to avoid:** Use consistent path encoding function: `/Users/ed/Code` -> `-Users-ed-Code`
**Warning signs:** ENOENT errors on session files, watching wrong directory

## Code Examples

Verified patterns from official sources:

### CLI Invocation with stream-json Output
```typescript
// Source: Claude CLI docs + observed behavior
import { execa } from 'execa';

const args = [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--verbose',
  '--dangerously-skip-permissions',
];

if (resume) {
  args.push('--resume', resume);
}

if (fork) {
  args.push('--fork-session');
}

const subprocess = execa('claude', args, {
  cwd: workspacePath,
  cancelSignal: abortController?.signal,
});
```

### Stream-JSON Output Format
```typescript
// Source: Actual CLI output captured
// Each line is valid JSON, message types match SDK format closely

// System init message
{"type":"system","subtype":"init","session_id":"dda6da5b-8788-4990-a582-d5a2c63fbfba","cwd":"/path","tools":[...],"model":"claude-sonnet-4-5-20250929",...}

// Assistant message
{"type":"assistant","message":{"model":"...","id":"msg_...","type":"message","role":"assistant","content":[{"type":"text","text":"..."}],...},"session_id":"..."}

// Result message (final)
{"type":"result","subtype":"success","is_error":false,"duration_ms":4326,"result":"...","session_id":"...","total_cost_usd":0.189,...}
```

### CLI to SDKMessage Mapping
```typescript
// Source: CLI output format + SDKMessage interface
function toSDKMessage(cliMessage: CLIMessage): SDKMessage {
  const base: SDKMessage = {
    type: cliMessage.type,
    session_id: cliMessage.session_id,
  };

  switch (cliMessage.type) {
    case 'system':
      return {
        ...base,
        subtype: cliMessage.subtype,
        // Extract session_id from init message
      };

    case 'assistant':
      return {
        ...base,
        message: cliMessage.message,
        content: extractTextContent(cliMessage.message?.content),
      };

    case 'result':
      return {
        ...base,
        subtype: cliMessage.subtype,
        result: cliMessage.result,
      };

    default:
      return { ...base, ...cliMessage };
  }
}
```

### File Watching with Debouncing
```typescript
// Source: chokidar GitHub README
import chokidar from 'chokidar';

const watcher = chokidar.watch(sessionFilePath, {
  awaitWriteFinish: {
    stabilityThreshold: 500,  // Wait 500ms after last write
    pollInterval: 100,
  },
});

watcher.on('change', (path) => {
  // Safe to read file now
  const content = await fs.readFile(path, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  // Parse each line as JSON...
});
```

### Session Path Encoding
```typescript
// Source: Observed CLI behavior
function encodePathForCli(absolutePath: string): string {
  // Replace all slashes with hyphens
  // /Users/ed/Code/myproject -> -Users-ed-Code-myproject
  return absolutePath.replace(/\//g, '-');
}

function getCliProjectDir(workspacePath: string): string {
  const homedir = os.homedir();
  const encoded = encodePathForCli(workspacePath);
  return path.join(homedir, '.claude', 'projects', encoded);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| child_process | execa v9+ | 2024-2025 | Native ESM, AbortController, better Windows support |
| chokidar v3 | chokidar v5 | Nov 2025 | ESM-only, Node 20+, TypeScript rewrite |
| File polling | stdout streaming | Current | Better latency, no disk I/O overhead |

**Deprecated/outdated:**
- chokidar glob patterns: Removed in v4, use array of paths or external filtering
- execa v5/v6 CommonJS: v6+ is ESM-only

## Open Questions

Things that couldn't be fully resolved:

1. **Session Resume Across Runtimes**
   - What we know: CLI and SDK use different session storage locations and likely different ID formats
   - What's unclear: Whether a session started with CLI can be resumed with SDK or vice versa
   - Recommendation: Treat as incompatible; enforce runtime type consistency on resume

2. **Tool Result Message Format**
   - What we know: CLI stream-json includes tool_use in assistant messages, results in user messages
   - What's unclear: Exact mapping to SDKMessage's legacy tool_use/tool_result types
   - Recommendation: Map to current format (embedded in assistant/user), emit legacy types only if needed for backwards compat

3. **Error Message Handling**
   - What we know: CLI outputs `{"type":"result","subtype":"error",...}` on failures
   - What's unclear: Full range of error subtypes and whether they map to SDK error codes
   - Recommendation: Handle gracefully, preserve original error content, map to SDKMessage error type

## Sources

### Primary (HIGH confidence)
- Claude CLI docs (https://code.claude.com/docs/en/cli-reference) - CLI flags, output formats
- execa GitHub (https://github.com/sindresorhus/execa) - v9.6.1 API, AbortController support
- chokidar GitHub (https://github.com/paulmillr/chokidar) - v5.0.0 API, awaitWriteFinish

### Secondary (MEDIUM confidence)
- Actual CLI output captured via `claude -p "Say hi" --output-format stream-json --verbose`
- Observed session file paths in ~/.claude/projects/

### Tertiary (LOW confidence)
- WebSearch results about Claude Code session file format (verified against actual files)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - execa and chokidar are well-documented, widely used
- Architecture: HIGH - Based on existing RuntimeInterface pattern and actual CLI output
- Pitfalls: MEDIUM - Based on observed behavior and documentation, some edge cases may exist

**Research date:** 2026-01-31
**Valid until:** 60 days (stable libraries, CLI format unlikely to change frequently)
