---
phase: 03-docker-integration
plan: 02
title: Container Runtime Implementation
subsystem: runtime
tags: [docker, runtime, container, lifecycle, security]
requires: [03-01]
provides:
  - ContainerRunner decorator implementing RuntimeInterface
  - Container lifecycle management via ContainerManager
  - Path translation and mount configuration
  - Security hardening for containers
affects: [03-03]
tech-stack:
  added: [dockerode, "@types/dockerode"]
  patterns:
    - Decorator pattern for runtime wrapping
    - Container lifecycle management
    - Stream demultiplexing for Docker output
    - Path mapping for host-container filesystem translation
key-files:
  created:
    - packages/core/src/runner/runtime/container-manager.ts
    - packages/core/src/runner/runtime/container-runner.ts
  modified:
    - packages/core/src/runner/runtime/index.ts
    - packages/core/package.json
decisions:
  - Use dockerode library for Docker API communication
  - Use require() for dockerode import to work around TypeScript NodeNext module resolution
  - Wrap any RuntimeInterface transparently via decorator pattern
  - Execute via docker exec with stream demultiplexing for output
  - Separate docker-sessions directory to prevent host session path conflicts
  - Auto-cleanup old containers based on max_containers limit
  - Security hardening: no-new-privileges, CAP_DROP ALL, non-root user, read-only auth mounts
metrics:
  duration: 5 minutes
  completed: 2026-02-01
---

# Phase 03 Plan 02: Container Runtime Implementation Summary

**One-liner:** ContainerRunner decorator wraps any runtime for Docker execution with security hardening, path translation, and automatic container lifecycle management.

## What Was Built

Created the Docker container integration layer that wraps any RuntimeInterface and executes jobs inside secure Docker containers. Handles container creation, security configuration, path mounting, and cleanup.

### Key Components

1. **ContainerManager** (packages/core/src/runner/runtime/container-manager.ts)
   - Container lifecycle management
   - `getOrCreateContainer()` - Creates or reuses containers based on ephemeral config
   - `createContainer()` - Creates Docker containers with security hardening:
     - SecurityOpt: no-new-privileges
     - CapDrop: ALL
     - Non-root user (UID:GID from config)
     - Memory limits and CPU shares
     - Network isolation (none/bridge/host)
   - `execInContainer()` - Execute commands via docker exec
   - `cleanupOldContainers()` - Enforce max_containers limit by removing oldest
   - `stopContainer()` - Stop and remove specific container
   - `buildContainerMounts()` - Create volume mounts:
     - Workspace (configurable rw/ro mode)
     - Auth files (read-only ~/.claude)
     - Docker sessions (rw, separate from host sessions)
     - Custom volumes from config
   - `buildContainerEnv()` - Build environment variables:
     - ANTHROPIC_API_KEY passthrough (preferred over mounted auth)
     - TERM for terminal support
     - HOME for claude user

2. **ContainerRunner** (packages/core/src/runner/runtime/container-runner.ts)
   - RuntimeInterface decorator
   - Wraps any runtime (SDK or CLI) transparently
   - `execute()` - Main execution flow:
     - Ensure docker-sessions directory exists
     - Build mounts and environment
     - Get or create container
     - Build claude CLI command
     - Execute via docker exec
     - Demultiplex stdout/stderr streams
     - Parse output line-by-line using parseCLILine
     - Stream SDKMessage format
     - Check exit code
     - Cleanup old containers
     - Error handling with container cleanup
   - `buildClaudeCommand()` - Translate RuntimeExecuteOptions to CLI args

3. **Runtime Module Exports** (packages/core/src/runner/runtime/index.ts)
   - Exported ContainerRunner
   - Exported ContainerManager, buildContainerMounts, buildContainerEnv
   - Available for integration in Plan 03-03

### Architecture Pattern

**Decorator Pattern:**
```typescript
// Base runtime
const cliRuntime = new CLIRuntime();

// Wrap with container execution
const dockerRuntime = new ContainerRunner(
  cliRuntime,
  dockerConfig,
  stateDir
);

// Execute transparently - happens inside Docker container
for await (const message of dockerRuntime.execute(options)) {
  console.log(message);
}
```

**Security Hardening:**
- no-new-privileges: true (prevents privilege escalation)
- CapDrop: ALL (removes all Linux capabilities)
- Non-root user (default: host UID:GID for permission alignment)
- Read-only auth mounts (prevents tampering)
- Configurable network isolation
- Memory and CPU resource limits

**Path Translation:**
- Host workspace → /workspace in container
- Host ~/.claude → /home/claude/.claude (read-only)
- Host .herdctl/docker-sessions → /home/claude/.herdctl/sessions (read-write)

## Deviations from Plan

None - plan executed exactly as written.

## Commits

All commits created during plan execution:

| Commit | Type | Description | Files |
|--------|------|-------------|-------|
| b0dc80a | feat | Container lifecycle management | container-manager.ts, package.json |
| 7279aae | feat | ContainerRunner decorator | container-runner.ts |
| 7fbb904 | feat | Export container classes | runtime/index.ts |

## Verification Results

**Success Criteria Met:**

✅ ContainerRunner wraps any RuntimeInterface and executes via docker exec
- Implements RuntimeInterface
- Accepts any RuntimeInterface in constructor
- Executes commands via ContainerManager.execInContainer()

✅ Containers mount workspace, auth files, and docker-sessions with correct permissions
- Workspace: configurable rw/ro mode (default: rw)
- Auth files: read-only (~/.claude → /home/claude/.claude:ro)
- Docker sessions: read-write (.herdctl/docker-sessions → /home/claude/.herdctl/sessions:rw)

✅ Containers use security hardening
- SecurityOpt: ["no-new-privileges:true"]
- CapDrop: ["ALL"]
- User: from config (default: host UID:GID)
- ReadonlyRootfs: false (Claude needs temp files)

✅ Container cleanup removes oldest when exceeding max_containers limit
- cleanupOldContainers() lists containers by name filter
- Sorts by creation time, oldest first
- Removes oldest until count <= max_containers

✅ All code compiles without errors
- Production code compiles with skipLibCheck
- Exports verified via node import test
- dockerode and @types/dockerode installed

**Test Status:**

⚠️ Pre-existing test failures remain from Phase 2 RuntimeInterface refactoring (job-executor.test.ts, schedule-runner.test.ts using deprecated SDKQueryFunction). These are documented in STATE.md as expected and will be addressed in future plan.

**Build Status:**

✅ container-manager.ts compiles
✅ container-runner.ts compiles
✅ runtime/index.ts exports work correctly
✅ All exports accessible (ContainerRunner, ContainerManager, buildContainerMounts, buildContainerEnv)

## Technical Notes

### TypeScript Module Resolution Issue

Encountered TypeScript error with dockerode import:
```
Module '.../@types/dockerode/index"' can only be default-imported using the 'esModuleInterop' flag
```

Despite `esModuleInterop: true` in tsconfig.json, TypeScript's NodeNext module resolution has issues with CJS-style `export =` from dockerode types.

**Solution:** Use `require()` for the import:
```typescript
const Dockerode = require("dockerode") as typeof import("dockerode");
```

This works at runtime with esModuleInterop and avoids TypeScript's module resolution quirks.

### Docker Stream Demultiplexing

Docker exec streams multiplex stdout/stderr. Use dockerode's modem.demuxStream():
```typescript
const modem = new Dockerode().modem;
modem.demuxStream(stream, stdout, stderr);
```

Then parse stdout line-by-line with readline interface and parseCLILine().

## Next Phase Readiness

**Ready for Plan 03-03 (Runtime Factory Integration):**
- ✅ ContainerRunner implements RuntimeInterface
- ✅ ContainerRunner exported from runtime module
- ✅ ContainerManager handles lifecycle
- ✅ buildContainerMounts and buildContainerEnv utilities available
- ✅ Decorator pattern allows wrapping any runtime (SDK or CLI)

**Integration Point:**
```typescript
import { ContainerRunner, resolveDockerConfig } from "./runtime/index.js";

// In RuntimeFactory.create():
if (agent.docker?.enabled) {
  const dockerConfig = resolveDockerConfig(agent.docker);
  const baseRuntime = new CLIRuntime(); // or SDKRuntime
  return new ContainerRunner(baseRuntime, dockerConfig, stateDir);
}
return new CLIRuntime(); // or SDKRuntime
```

**Blockers:** None

**Concerns:** None

**Recommendations:**
1. Plan 03-03 should integrate ContainerRunner into RuntimeFactory
2. Add unit tests for ContainerManager and ContainerRunner in future plan
3. Consider adding Docker health checks before container creation
4. Consider supporting custom Dockerfile for agent-specific images
