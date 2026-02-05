---
phase: 02-mapper-agent-definitions
plan: 01
subsystem: security
tags: [security-agents, gsd-pattern, codebase-mapping, attack-surface, data-flow]

# Dependency graph
requires:
  - phase: 01-state-infrastructure
    provides: STATE.md template and security state tracking
provides:
  - attack-surface-mapper agent definition
  - data-flow-tracer agent definition
  - Security-focused codebase mapping capability
affects: [02-02, 03-investigator-agents, security-map-codebase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - GSD agent definition structure (frontmatter + XML sections)
    - Write-directly pattern (agents write docs, return confirmation only)
    - Security-focused exploration commands

key-files:
  created:
    - .claude/agents/security/attack-surface-mapper.md
    - .claude/agents/security/data-flow-tracer.md
  modified: []

key-decisions:
  - "Followed GSD codebase-mapper pattern exactly for agent structure"
  - "Included herdctl-specific exploration commands (not generic)"
  - "Used cyan color and sonnet model for all security mapper agents"

patterns-established:
  - "Security mapper agents write to .security/codebase-map/*.md"
  - "All agents include <forbidden_files> section to prevent secret leakage"
  - "Trust level assessment (LOW/MEDIUM/HIGH) required for all entry points"
  - "Risk level assessment (LOW/MEDIUM/HIGH) required for all data flows"

# Metrics
duration: 4min
completed: 2026-02-05
---

# Phase 2 Plan 01: Mapper Agent Definitions (Wave 1) Summary

**Created attack-surface-mapper and data-flow-tracer agents following GSD pattern with security-focused exploration commands and write-directly output**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-05T23:50:49Z
- **Completed:** 2026-02-05T23:54:09Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Created attack-surface-mapper agent (408 lines) for identifying entry points, APIs, and trust boundaries
- Created data-flow-tracer agent (529 lines) for tracing user input through to sensitive operations
- Both agents follow GSD codebase-mapper pattern with security-specific adaptations
- Included herdctl-specific exploration commands targeting actual codebase patterns

## Task Commits

Each task was committed atomically:

1. **Task 1: Create attack-surface-mapper agent definition** - `a845a73` (feat)
2. **Task 2: Create data-flow-tracer agent definition** - `9901fe2` (feat)

## Files Created

- `.claude/agents/security/attack-surface-mapper.md` - Maps entry points, APIs, trust boundaries where external input enters
- `.claude/agents/security/data-flow-tracer.md` - Traces user-controlled data from sources to sensitive sinks

## Decisions Made

- **Followed GSD pattern exactly**: Used same structure as gsd-codebase-mapper.md with adapted content
- **herdctl-specific commands**: Exploration commands target actual herdctl patterns (commander.js, Zod, execa)
- **Consistent frontmatter**: Both agents use model: sonnet, color: cyan, same tool set
- **Write-directly pattern**: Agents write to .security/codebase-map/ and return confirmation only

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - both agent definitions created successfully following the reference pattern.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both mapper agents ready for use by /security-map-codebase orchestrator
- Plan 02-02 can proceed to create security-controls-mapper and threat-vector-analyzer
- .security/codebase-map/ directory will be created by agents on first run

---
*Phase: 02-mapper-agent-definitions*
*Completed: 2026-02-05*

## Self-Check: PASSED
