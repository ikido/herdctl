---
phase: 02-mapper-agent-definitions
plan: 02
subsystem: security
tags: [security, agents, subagents, defense-mapping, threat-modeling]

# Dependency graph
requires:
  - phase: 01-state-infrastructure
    provides: Security STATE.md for tracking coverage
provides:
  - security-controls-mapper agent definition for documenting defenses
  - threat-vector-analyzer agent definition for codebase-specific threat analysis
affects: [02-03, 02-04, 03-investigation-agents, security-map-codebase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GSD agent structure (frontmatter, role, process, templates)"
    - "Defense-focused exploration commands for security controls"
    - "Threat assessment pattern (T1-T5 with residual risk rating)"

key-files:
  created:
    - .claude/agents/security/security-controls-mapper.md
    - .claude/agents/security/threat-vector-analyzer.md
  modified: []

key-decisions:
  - "T1-T5 threat taxonomy for herdctl-specific threats"
  - "Coverage AND gaps pattern for security control documentation"
  - "Residual risk rating (HIGH/MEDIUM/LOW) with reasoning required"

patterns-established:
  - "Security mapper agents write directly to .security/codebase-map/"
  - "Threat categories specific to codebase architecture (not generic OWASP)"
  - "Accepted risks documented alongside mitigated risks"

# Metrics
duration: 3min
completed: 2026-02-05
---

# Phase 2 Plan 2: Security Controls and Threat Vector Mappers Summary

**Defense inventory agent (security-controls-mapper) and codebase-specific threat analyzer (threat-vector-analyzer) with T1-T5 threat taxonomy**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-05T23:50:47Z
- **Completed:** 2026-02-05T23:53:39Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created security-controls-mapper agent with exploration commands for validation, path safety, container hardening, and permission controls
- Created threat-vector-analyzer agent with herdctl-specific T1-T5 threat taxonomy
- Both agents follow GSD write-directly pattern (write to .security/codebase-map/, return confirmation only)
- Threat analyzer includes accepted risks documentation (hostConfigOverride, shell:true)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create security-controls-mapper agent definition** - `ad5385c` (feat)
2. **Task 2: Create threat-vector-analyzer agent definition** - `113ca36` (feat)

## Files Created/Modified

- `.claude/agents/security/security-controls-mapper.md` - Documents existing security defenses (validation, path safety, Docker hardening, permissions)
- `.claude/agents/security/threat-vector-analyzer.md` - Identifies codebase-specific attack patterns (T1-T5 threat categories)

## Decisions Made

1. **T1-T5 threat taxonomy** - Adopted herdctl-specific threat categories:
   - T1: Malicious Fleet Configuration
   - T2: Agent-to-Host Escape
   - T3: State File Manipulation
   - T4: Prompt Injection
   - T5: Supply Chain

2. **Coverage AND gaps pattern** - Every security control must document both what it protects AND what it doesn't protect

3. **Residual risk rating** - Each threat category requires HIGH/MEDIUM/LOW rating with reasoning based on actual mitigations found

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 2 of 4 mapper agents complete (attack-surface-mapper and data-flow-tracer from plan 02-01, security-controls-mapper and threat-vector-analyzer from this plan)
- Ready to complete remaining mapper agents if any, or proceed to investigation agents (Phase 3)
- .security/codebase-map/ directory will receive output from all 4 mapper agents

## Self-Check: PASSED

---
*Phase: 02-mapper-agent-definitions*
*Completed: 2026-02-05*
