# herdctl Project State

## Current Position

**Phase**: Not started (defining requirements)
**Plan**: —
**Status**: Defining requirements for milestone v1.0
**Last activity**: 2026-01-31 — Milestone v1.0 started

## Accumulated Context

### Project Understanding
- herdctl core functionality is working (FleetManager, scheduling, Discord, hooks)
- Existing runner uses SDK directly via `job-executor.ts`, `sdk-adapter.ts`
- Target: Add runtime abstraction (SDK vs CLI) + Docker containerization

### Technical Decisions
- Runtime abstraction will provide unified interface
- CLI runtime will watch session files to provide streaming
- Docker sessions stored separately from host sessions
- Auth files mounted read-only into containers

### Known Blockers

(None currently)

---
*Last updated: 2026-01-31*
