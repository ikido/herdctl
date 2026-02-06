# GSD-Style Security Audit System for herdctl

## What This Is

A comprehensive security intelligence system for the herdctl codebase that operates like a "full-time security researcher" — maintaining deep persistent understanding of security posture, running daily incremental audits that build on previous knowledge, and using subagent orchestration to avoid context degradation during deep investigations.

## Core Value

**Continuous, intelligent security oversight that improves over time.** Each audit builds on accumulated knowledge rather than starting fresh, with subagent delegation enabling deep investigations without sacrificing orchestrator context.

## Requirements

### Validated

- STATE.md for persistent security audit state and session continuity — v1.0
- 4 parallel security mapper agents (attack-surface, data-flow, security-controls, threat-vectors) — v1.0
- hot-spot-verifier agent for critical file verification — v1.0
- question-investigator agent for researching open questions — v1.0
- change-analyzer agent for security review of recent commits — v1.0
- /security-map-codebase command for full codebase security mapping — v1.0
- /security-audit command with subagent orchestration (<20% context) — v1.0
- /security-audit-daily command with dedicated branch commits — v1.0
- Agent definitions in .claude/agents/security/ — v1.0

### Active

(None yet — next milestone will define requirements)

### Out of Scope

- /security-deep-dive command — defer to future milestone
- finding-investigator agent — defer to future milestone
- Rewriting existing scan.ts scanner — works well as-is
- GUI/dashboard for security findings — CLI-first
- Integration with external security tools — self-contained system

## Context

Shipped v1.0 with ~10,117 lines across 27 files.

**Current state:**
- 7 security agents in .claude/agents/security/
- 3 orchestrator commands (security-map-codebase, security-audit, security-audit-daily)
- 4 security mapping documents in .security/codebase-map/
- Persistent state tracking in .security/STATE.md

**Tech stack:**
- TypeScript monorepo (packages/core/, packages/cli/)
- Zod for schema validation, execa for process spawning
- Docker containerization with hardening options
- GSD patterns (subagent delegation, persistent state files, structured documentation)

## Constraints

- **Pattern**: Must follow GSD patterns — subagent delegation, persistent state files, structured documentation, orchestrator-based coordination
- **Context budget**: Orchestrators must stay under 20% context utilization; delegate depth to subagents
- **Compatibility**: Must work with existing security scanner and file structure
- **Location**: Agent definitions in `.claude/agents/security/`
- **Commits**: Daily automation commits to `security-audits` branch

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Skip /security-deep-dive for v1 | Focus on daily workflow first | Deferred to v2 |
| Keep existing scan.ts | Works well, no need to rewrite | Preserved |
| Agents in .claude/agents/security/ | Keep with other agent definitions | 7 agents created |
| Dedicated branch for daily commits | Isolate automated commits from main work | Implemented |
| 7 agents total (4 mappers + 3 investigators) | Full system coverage without deep-dive | Shipped |
| YAML frontmatter for state | Machine-parseable for automation | Implemented |
| Reference-not-duplicate pattern | Single source of truth for data | Implemented |
| 7 days / 15 commits staleness | Balance freshness vs overhead | Implemented |
| Conditional agent spawning | Only spawn when conditions met | Implemented |
| Inline execution for daily automation | Preserve branch context | Implemented |
| GREEN/YELLOW/RED status | Quick executive summary | Implemented |

---
*Last updated: 2026-02-05 after v1.0 milestone*
