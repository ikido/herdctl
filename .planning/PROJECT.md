# herdctl

## What This Is

herdctl is an orchestration platform for Claude Code agents. It allows Claude Code to invoke itself—running agents on schedules, chat interfaces (Discord), and webhooks—while maintaining full session continuity and providing structured communication between agents and the fleet management system.

## Core Value

Autonomous Claude Code agents with full capabilities: if Claude Code can do it manually, herdctl agents can do it automatically.

## Requirements

### Validated

(None yet — first milestone)

### Active

- [ ] **RUNTIME-01**: Support both Claude Agent SDK runtime (standard pricing) and Claude CLI runtime (Max plan pricing)
- [ ] **RUNTIME-02**: Runtime abstraction provides unified interface regardless of backend (SDK vs CLI)
- [ ] **RUNTIME-03**: CLI runtime watches session files and converts to streaming SDK message format
- [ ] **RUNTIME-04**: Agent configuration can specify which runtime to use
- [ ] **DOCKER-01**: Agents can optionally run in isolated Docker containers
- [ ] **DOCKER-02**: Docker containers mount Claude auth files read-only
- [ ] **DOCKER-03**: Docker sessions stored in isolated directory separate from host sessions
- [ ] **DOCKER-04**: Docker containers have configurable network isolation (none/bridge/host)
- [ ] **DOCKER-05**: Docker containers have configurable resource limits (CPU/memory)
- [ ] **DOCKER-06**: Docker containers support custom volume mounts
- [ ] **CONFIG-01**: Agent YAML configuration supports runtime and docker fields
- [ ] **CONFIG-02**: Configuration schema validates docker options properly
- [ ] **DOCS-01**: Documentation explains when to use each runtime
- [ ] **DOCS-02**: Documentation explains Docker security model
- [ ] **DOCS-03**: Examples provided for each use case (cost-optimized, development, production, mixed)

### Out of Scope

- **SDK runtime with Docker stdin/stdout protocol** — Deferred to future; CLI runtime with Docker is sufficient for v1
- **Multiple container orchestrators** — Docker only; no Kubernetes/Podman for v1
- **Dynamic runtime switching** — Agent runtime is fixed at config time, not changed at job execution time
- **Session migration between Docker and host** — Docker sessions stay in Docker, host sessions stay on host

## Context

**Current State**: herdctl core is functioning. FleetManager orchestrates agents, schedules trigger jobs, Discord integration works, hooks execute. The existing runner infrastructure uses the Claude Agent SDK directly.

**Why This Matters**: Users with Max plans pay significantly less for Claude API usage when using the CLI. Docker containerization provides security isolation for untrusted prompts or sensitive environments. These features make herdctl viable for both cost-conscious personal automation and security-focused production deployments.

**Existing Infrastructure**: The `packages/core/src/runner/` directory already contains:
- `job-executor.ts` - Orchestrates job execution
- `sdk-adapter.ts` - Current SDK integration
- `message-processor.ts` - Processes SDK messages
- `types.ts` - Type definitions

This milestone extends this infrastructure with runtime abstraction and Docker support.

## Constraints

- **Tech stack**: TypeScript, existing codebase uses Claude Agent SDK
- **Compatibility**: Must maintain existing job execution behavior for SDK runtime
- **Security**: Docker auth files must be mounted read-only
- **Path consistency**: Docker sessions use container paths, host sessions use host paths

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Runtime abstraction interface | Same interface whether using SDK or CLI, enables swapping | — Pending |
| Docker sessions isolated from host | Prevents path mismatch errors when resuming sessions | — Pending |
| Auth files mounted read-only | Container can't corrupt credentials | — Pending |
| CLI runtime uses file watching | No alternative—CLI doesn't provide streaming API | — Pending |

---
*Last updated: 2026-01-31 after milestone v1.0 initialization*
