---
phase: 04-documentation-and-testing
plan: 02
subsystem: documentation
tags: [examples, troubleshooting, docker, runtime, yaml]

# Dependency graph
requires:
  - phase: 03-docker-integration
    provides: Docker runtime implementation and configuration schema
  - phase: 02-cli-runtime
    provides: CLI runtime implementation
provides:
  - Runtime configuration examples for SDK, CLI, and Docker setups
  - Comprehensive troubleshooting guide for runtime and Docker issues
  - Working example fleet with copy-pastable configurations
affects: [documentation, onboarding, developer-experience]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Example-driven documentation with runnable configs
    - Troubleshooting organized by symptom (error-first approach)
    - Anti-patterns documented alongside correct patterns

key-files:
  created:
    - examples/runtime-showcase/herdctl.yaml
    - examples/runtime-showcase/agents/sdk-agent.yaml
    - examples/runtime-showcase/agents/cli-agent.yaml
    - examples/runtime-showcase/agents/docker-agent.yaml
    - examples/runtime-showcase/agents/mixed-fleet.yaml
    - docs/src/content/docs/guides/runtime-troubleshooting.md
  modified: []

key-decisions:
  - "Example configs demonstrate use case patterns (dev/cost-optimized/production/mixed)"
  - "Troubleshooting guide organized by symptom, not by concept"
  - "Anti-patterns included in examples with inline explanations"
  - "Cross-references between docs and examples for discoverability"

patterns-established:
  - "Examples are runnable without modification (after env vars set)"
  - "Each example includes description of use case and requirements"
  - "Troubleshooting includes both symptoms and solutions with commands"
  - "Anti-patterns shown as commented YAML with explanations"

# Metrics
duration: 3min
completed: 2026-02-01
---

# Phase 04 Plan 02: Example Configurations and Troubleshooting Summary

**Runtime showcase examples with SDK, CLI, and Docker configurations plus comprehensive troubleshooting guide covering common runtime and Docker issues**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-01T14:37:40Z
- **Completed:** 2026-02-01T14:40:31Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created runtime-showcase example directory with 4 agent configurations and 1 fleet config
- Documented SDK runtime (development), CLI runtime (cost-optimized), Docker runtime (production), and mixed fleet strategies
- Created comprehensive troubleshooting guide (466 lines) covering CLI, Docker, and path resolution issues
- Documented common anti-patterns with correct alternatives
- Established cross-references between documentation and examples

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Runtime Showcase Example Configurations** - `a3d0969` (feat)
2. **Task 2: Create Runtime Troubleshooting Guide** - `0a072d6` (docs)

## Files Created/Modified

**Created:**
- `examples/runtime-showcase/herdctl.yaml` - Fleet config demonstrating runtime options
- `examples/runtime-showcase/agents/sdk-agent.yaml` - Development setup with SDK runtime
- `examples/runtime-showcase/agents/cli-agent.yaml` - Cost-optimized setup for Max plan users
- `examples/runtime-showcase/agents/docker-agent.yaml` - Production setup with Docker security hardening
- `examples/runtime-showcase/agents/mixed-fleet.yaml` - Mixed runtime strategies with anti-pattern examples
- `docs/src/content/docs/guides/runtime-troubleshooting.md` - Comprehensive troubleshooting guide

## Decisions Made

**Example organization:**
- Organized examples by use case (development/cost-optimized/production/mixed) rather than by feature
- Included anti-patterns as commented YAML in mixed-fleet.yaml for educational value
- Made all examples runnable without modification (only need environment variables)

**Troubleshooting structure:**
- Organized by symptom/error message (how users search) rather than by concept
- Included both diagnosis and solution commands users can copy-paste
- Separated CLI issues, Docker issues, and path resolution into distinct sections
- Added debugging checklist at end for systematic troubleshooting

**Cross-references:**
- Linked troubleshooting guide to runtime-showcase examples
- Created bidirectional discoverability between docs and examples

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed as specified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Documentation coverage:**
- Runtime configuration: Complete (SDK, CLI, Docker)
- Troubleshooting: Complete (common issues covered)
- Examples: Complete (4 use cases demonstrated)

**Ready for:**
- User onboarding with working examples
- Troubleshooting support with symptom-based guide
- Additional documentation (testing, API reference, etc.)

**No blockers** - documentation foundation complete for runtime features.

---
*Phase: 04-documentation-and-testing*
*Completed: 2026-02-01*
