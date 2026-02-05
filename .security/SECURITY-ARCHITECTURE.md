# Security Architecture Guide

This document maps security-sensitive code locations in the herdctl codebase. Use this as a reference when performing security reviews or investigating issues.

## Quick Reference

| Concern | Primary Location | Secondary |
|---------|------------------|-----------|
| Process spawning | `runner/runtime/cli-runtime.ts` | `runner/runtime/container-runner.ts` |
| Docker security | `runner/runtime/container-manager.ts` | `config/schema.ts` |
| Input validation | `config/schema.ts` | `config/interpolate.ts` |
| File operations | `state/directory.ts` | `state/job-output.ts` |
| Permission control | `config/schema.ts` (PermissionMode) | Agent prompts |
| Schedule validation | `scheduler/interval.ts` | `scheduler/cron.ts` |

## Detailed Component Map

### 1. Process Spawning (`packages/core/src/runner/`)

#### `runtime/cli-runtime.ts`
**Risk Level**: HIGH

Spawns Claude CLI as child processes using `execa`.

```typescript
// Key security-relevant code:
const result = await execa("claude", args, {
  cwd,                    // Workspace directory - validate this
  input: prompt,          // Prompt via stdin - not command injection risk
  cancelSignal: signal    // Abort controller
});
```

**What to check**:
- Arguments are constructed safely (array form, not string concatenation)
- Working directory is validated before use
- No user-controlled values interpolated into command arguments

#### `runtime/container-runner.ts`
**Risk Level**: HIGH

Decorator that wraps any runtime to execute inside Docker containers.

**What to check**:
- Container IDs are validated before use in `docker exec`
- No command injection through container names or exec arguments

#### `runtime/container-manager.ts`
**Risk Level**: CRITICAL

Manages Docker container lifecycle with security hardening.

```typescript
// Security hardening applied:
SecurityOpt: ["no-new-privileges:true"],
CapDrop: ["ALL"],
PidsLimit: config.pidsLimit,
Memory: config.memoryBytes,
```

**Critical section** (lines ~130-140):
```typescript
// hostConfigOverride can bypass ALL security settings
if (config.hostConfigOverride) {
  Object.assign(translatedHostConfig, config.hostConfigOverride);
}
```

**What to check**:
- `hostConfigOverride` usage in configs (should be rare/never at agent level)
- Network mode settings (bridge is safe, none breaks functionality)
- Volume mounts don't expose sensitive host paths

---

### 2. Configuration Validation (`packages/core/src/config/`)

#### `schema.ts`
**Risk Level**: MEDIUM

Zod schemas for all configuration validation.

**Key schemas**:
- `PermissionModeSchema` - Controls what agents can do
- `DockerConfigSchema` - Separates safe vs dangerous options
- `AgentConfigSchema.strict()` - Rejects unknown fields at agent level

```typescript
// Permission modes (security implications):
"default"           // Normal Claude Code permissions
"acceptEdits"       // Auto-accept file edits
"bypassPermissions" // DANGEROUS - bypasses all permission checks
"plan"              // Read-only analysis mode
```

**What to check**:
- New config fields are added to appropriate schemas
- Dangerous options are only in fleet-level schemas, not agent-level
- `.strict()` is maintained on agent-level schemas

#### `interpolate.ts`
**Risk Level**: MEDIUM

Environment variable interpolation in configs.

```typescript
// Supported patterns:
${VAR_NAME}           // Required variable
${VAR_NAME:-default}  // With default value
```

**What to check**:
- No command substitution (`$(...)` or backticks)
- No recursive interpolation that could cause loops
- Required variables are validated as defined

#### `loader.ts`
**Risk Level**: LOW

Loads and merges YAML configuration files.

**What to check**:
- Uses safe YAML loading (no code execution)
- File paths are validated before loading
- Merge behavior doesn't allow dangerous overrides

---

### 3. State Management (`packages/core/src/state/`)

#### `directory.ts`
**Risk Level**: MEDIUM

Manages `.herdctl/` state directory structure.

```typescript
// State directory structure:
.herdctl/
├── agents/
│   └── {agentId}/
│       └── jobs/
│           └── {jobId}/
│               ├── metadata.json
│               └── output.jsonl
└── schedules/
    └── {agentId}.json
```

**What to check**:
- Path construction doesn't allow traversal (no `../` in IDs)
- Directory creation uses safe modes
- Agent/job IDs are validated before use in paths

#### `job-output.ts`
**Risk Level**: LOW

Streams JSONL output to job log files.

**What to check**:
- Output is properly escaped in JSON
- No log injection through output content
- File handles are properly closed

#### `working-directory-validation.ts`
**Risk Level**: MEDIUM

Validates workspace hasn't changed between sessions.

**What to check**:
- Validation is actually called before job execution
- Hash/fingerprint mechanism is robust
- Handles edge cases (deleted directories, permission changes)

---

### 4. Scheduler (`packages/core/src/scheduler/`)

#### `scheduler.ts`
**Risk Level**: LOW

Main scheduling loop that triggers agent execution.

**What to check**:
- Only supported trigger types are executed
- Rate limiting prevents runaway triggers
- Graceful shutdown doesn't leave orphan processes

#### `interval.ts`
**Risk Level**: LOW

Parses human-readable intervals (5m, 1h, 30s).

```typescript
// Validation applied:
- No zero intervals
- No negative values
- Jitter prevents thundering herd
```

**What to check**:
- Integer overflow on very large intervals
- Edge cases in jitter calculation

#### `cron.ts`
**Risk Level**: LOW

Standard cron expression parsing.

**What to check**:
- Uses well-tested cron-parser library
- Malformed expressions are rejected gracefully

---

### 5. Work Sources (`packages/core/src/work-sources/`)

#### `github/`
**Risk Level**: MEDIUM

GitHub integration for fetching issues/PRs.

**What to check**:
- API tokens are not logged
- Rate limiting is respected
- Webhook signatures are validated (TODO: verify status)

---

## Security-Sensitive Patterns to Grep For

```bash
# High-risk patterns - always review these
rg "bypassPermissions"
rg "hostConfigOverride"
rg "privileged"
rg "CapAdd"
rg "network.*host"

# Process spawning - review for injection
rg "execa\(" --type ts
rg "spawn\(" --type ts
rg "exec\(" --type ts

# File operations - review for traversal
rg "readFile|writeFile|appendFile" --type ts
rg "mkdir|rmdir" --type ts
rg "path\.join|path\.resolve" --type ts

# Environment handling - review for leaks
rg "process\.env" --type ts
rg "GITHUB_TOKEN|API_KEY|SECRET" --type ts
```

## Recent Changes to Watch

When reviewing commits, pay special attention to changes in:

1. **Any file in `runner/runtime/`** - Direct security impact
2. **`config/schema.ts`** - New config options could introduce risks
3. **`state/directory.ts`** - Path handling changes
4. **New dependencies in `package.json`** - Supply chain risk

## Security Review Checklist

For any PR touching security-sensitive areas:

- [ ] No new uses of `bypassPermissions` without justification
- [ ] No `hostConfigOverride` at agent config level
- [ ] Process spawning uses array arguments (not string interpolation)
- [ ] Path construction validates input
- [ ] New config fields have appropriate validation
- [ ] Sensitive data is not logged
- [ ] Tests cover security-relevant edge cases
