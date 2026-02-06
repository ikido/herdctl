# GSD-Style Security Audit System Specification

**Project**: herdctl Security Intelligence System
**Date**: 2026-02-05
**Purpose**: Build a comprehensive, GSD-pattern security audit system that can run autonomously with deep codebase understanding and incremental intelligence gathering.

---

## Executive Summary

We need a security audit system that operates like a "full-time security researcher" - one that:
- Maintains deep, persistent understanding of the codebase's security posture
- Runs daily incremental audits that build on previous knowledge
- Can perform deep-dive investigations without context degradation
- Uses subagent orchestration to avoid context rot
- Tracks open questions and makes measurable progress on them

This system should follow GSD patterns: subagent delegation, persistent state files, structured documentation, and orchestrator-based coordination.

---

## Current State

### What Exists

```
.security/
├── intel/
│   ├── 2026-02-05.md              # Intelligence report
│   ├── 2026-02-05-evening.md      # Another report same day
│   └── FINDINGS-INDEX.md          # Master findings tracker
├── scans/
│   └── 2026-02-05.json            # Deterministic scanner output
├── tools/
│   └── scan.ts                    # Static security scanner
├── CODEBASE-UNDERSTANDING.md      # Evolving security knowledge
├── HOT-SPOTS.md                   # Critical files checklist
├── AGENTIC-SECURITY-PLAN.md       # Original design doc
└── CHECKLIST.md                   # What each scan check does
```

### Slash Commands (in `.claude/commands/`)

- `/security-audit` - Full audit process (7 phases)
- `/security-audit-review` - After-action quality assessment
- `/security-audit-daily` - Wrapper for automated daily runs

### Problems with Current Approach

1. **Single context execution**: The audit runs in one context window, limiting depth
2. **No subagent delegation**: All investigation happens inline, consuming context
3. **Limited codebase mapping**: No comprehensive security-focused codebase analysis
4. **Context rot**: Long audits degrade in quality as context fills
5. **No state persistence**: Each audit starts mostly fresh
6. **Shallow exploration**: Can't deeply trace data flows or attack paths

---

## Desired End State

### Architecture

```
/security-audit (orchestrator, 10-15% context)
    │
    ├─→ Reads: .security/STATE.md (current position, accumulated context)
    ├─→ Reads: .security/codebase-map/*.md (security understanding)
    │
    ├─→ Phase 1: Run deterministic scanner
    │   └─→ Updates: .security/scans/YYYY-MM-DD.json
    │
    ├─→ Phase 2: Spawn parallel mapper agents (if needed)
    │   ├─→ attack-surface-mapper → ATTACK-SURFACE.md
    │   ├─→ data-flow-tracer → DATA-FLOWS.md
    │   ├─→ security-controls-mapper → SECURITY-CONTROLS.md
    │   └─→ threat-vector-analyzer → THREAT-VECTORS.md
    │
    ├─→ Phase 3: Spawn investigation agents (for changes/questions)
    │   ├─→ hot-spot-verifier (checks critical files)
    │   ├─→ question-investigator (researches open questions)
    │   └─→ change-analyzer (reviews commits since last audit)
    │
    ├─→ Phase 4: Aggregate findings, update intelligence
    │   └─→ Updates: FINDINGS-INDEX.md, CODEBASE-UNDERSTANDING.md
    │
    └─→ Phase 5: Write report, update state
        └─→ Creates: .security/intel/YYYY-MM-DD.md
        └─→ Updates: .security/STATE.md
```

### File Structure (Target)

```
.security/
├── STATE.md                        # Living memory (like GSD's STATE.md)
├── codebase-map/                   # Security-focused codebase analysis
│   ├── ATTACK-SURFACE.md           # Entry points, APIs, trust boundaries
│   ├── DATA-FLOWS.md               # How user input travels through system
│   ├── SECURITY-CONTROLS.md        # Existing defenses, validation, auth
│   └── THREAT-VECTORS.md           # Attack patterns relevant to this codebase
├── intel/
│   ├── YYYY-MM-DD.md               # Daily intelligence reports
│   ├── FINDINGS-INDEX.md           # Master findings tracker
│   └── findings/                   # Deep dive documents per finding
│       └── NNN-finding-name.md
├── reviews/
│   └── YYYY-MM-DD.md               # Audit quality reviews
├── summaries/
│   └── YYYY-MM-DD.md               # Executive summaries (email-ready)
├── scans/
│   └── YYYY-MM-DD.json             # Deterministic scanner output
├── tools/
│   └── scan.ts                     # Static security scanner
├── CODEBASE-UNDERSTANDING.md       # Evolving knowledge + open questions
├── HOT-SPOTS.md                    # Critical files checklist
└── CHECKLIST.md                    # What each scan check examines
```

---

## Subagent Definitions

### Security Mapper Agents (for full codebase mapping)

These spawn in parallel during initial mapping or periodic refresh.

#### 1. attack-surface-mapper

**Purpose**: Map all entry points where external input enters the system.

**Writes**: `.security/codebase-map/ATTACK-SURFACE.md`

**What it analyzes**:
- CLI argument parsing
- Configuration file loading (YAML, JSON)
- Environment variable usage
- API endpoints (if any)
- File system inputs (watches, reads)
- External service integrations
- Trust boundaries between components

**Output structure**:
```markdown
# Attack Surface Map

## Entry Points

### Configuration Loading
- **fleet.yaml**: Loaded via js-yaml, validated by Zod
- **Trust level**: Medium (user's own files)
- **Defenses**: Schema validation in `packages/core/src/config/schema.ts`
- **Key files**: `loader.ts`, `schema.ts`, `interpolate.ts`

### CLI Arguments
- **Source**: commander.js parsing
- **Trust level**: Medium (user input)
- **Key files**: `packages/cli/src/commands/*.ts`

[... more entry points ...]

## Trust Boundaries

### User → FleetManager
- Input: Fleet configuration
- Validation: Zod schema, strict mode
- After validation: Treated as trusted

### FleetManager → Agent Process
- Input: Agent configuration, prompts
- Isolation: Optional Docker containerization
- Key concern: Prompt injection, container escape

[... more boundaries ...]
```

#### 2. data-flow-tracer

**Purpose**: Trace how user-controlled data flows through the system.

**Writes**: `.security/codebase-map/DATA-FLOWS.md`

**What it analyzes**:
- Path of user input from entry to execution
- Where validation/sanitization occurs
- Where data is used in sensitive operations (file paths, shell commands, Docker)
- Data transformations and trust level changes

**Output structure**:
```markdown
# Security Data Flows

## Flow: Agent Name → File System Path

1. **Entry**: `fleet.yaml` agent name field
2. **Validation**: `AGENT_NAME_PATTERN` in schema.ts (alphanumeric + dash/underscore)
3. **Usage**: `buildSafeFilePath()` in state operations
4. **Sensitive ops**: Creates directories, writes state files
5. **Risk level**: LOW (pattern + safe path utility)

## Flow: Agent Prompt → Claude Execution

1. **Entry**: `fleet.yaml` agent.prompt or agent.tasks[].prompt
2. **Validation**: None (free text intended)
3. **Transformation**: Passed to Claude SDK
4. **Sensitive ops**: Claude executes with configured permissions
5. **Risk level**: MEDIUM (intentional capability, but prompt injection possible)

[... more flows ...]
```

#### 3. security-controls-mapper

**Purpose**: Document existing security defenses and their locations.

**Writes**: `.security/codebase-map/SECURITY-CONTROLS.md`

**What it analyzes**:
- Input validation (Zod schemas, regex patterns)
- Path safety utilities
- Container hardening configuration
- Permission mode enforcement
- Authentication/authorization (if any)
- Logging and audit trails

**Output structure**:
```markdown
# Security Controls Inventory

## Input Validation

### Zod Schema Validation
- **Location**: `packages/core/src/config/schema.ts`
- **What it validates**: Fleet config, agent config, Docker config
- **Key patterns**:
  - `AGENT_NAME_PATTERN`: `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
  - `AgentConfigSchema.strict()`: Rejects unknown fields
- **Coverage**: All configuration loading

### Path Safety
- **Location**: `packages/core/src/state/utils/path-safety.ts`
- **Function**: `buildSafeFilePath(baseDir, identifier, extension)`
- **What it prevents**: Path traversal via `..` or absolute paths
- **Usage**: Session files, job metadata

[... more controls ...]

## Container Hardening

### Docker Security Options
- **Location**: `packages/core/src/runner/runtime/container-manager.ts`
- **Controls applied**:
  - `CapDrop: ["ALL"]` - Remove all capabilities
  - `SecurityOpt: ["no-new-privileges"]`
  - `ReadonlyRootfs` option
  - Network isolation option
- **Bypass risk**: `hostConfigOverride` allows overriding (documented risk)

[... more controls ...]
```

#### 4. threat-vector-analyzer

**Purpose**: Document attack patterns specifically relevant to this codebase.

**Writes**: `.security/codebase-map/THREAT-VECTORS.md`

**What it analyzes**:
- Known vulnerability patterns in similar systems
- Specific attack scenarios for fleet management
- AI agent-specific threats (prompt injection, jailbreaking)
- Supply chain concerns
- Privilege escalation paths

**Output structure**:
```markdown
# Threat Vectors Analysis

## T1: Malicious Fleet Configuration

**Attack**: Attacker crafts fleet.yaml to escape intended boundaries

**Vectors**:
1. Path traversal in agent name → MITIGATED (schema + buildSafeFilePath)
2. Prompt injection to bypass permissions → PARTIAL (permission modes help)
3. hostConfigOverride to escalate Docker privileges → ACCEPTED RISK

**Residual risk**: Medium (hostConfigOverride is powerful)

## T2: Agent-to-Host Escape

**Attack**: Compromised agent code attempts to affect host system

**Vectors**:
1. Container escape via Docker vulnerability → Mitigated by hardening
2. Shared volume abuse → User's choice (documented)
3. Network exfiltration → Optional network isolation

**Residual risk**: Low-Medium (depends on configuration)

[... more threat vectors ...]

## T3: State File Manipulation

**Attack**: Attacker modifies .herdctl/ state files to influence behavior

**Vectors**:
1. Inject malicious session state → LOW (files are in user's own project)
2. Corrupt job metadata → LOW (validation on load)

**Residual risk**: Low (user's own files)

[... more threat vectors ...]
```

### Investigation Agents (for targeted analysis)

These spawn during audits for specific investigation tasks.

#### 5. hot-spot-verifier

**Purpose**: Verify security of critical code areas defined in HOT-SPOTS.md.

**Reads**: `.security/HOT-SPOTS.md`
**Returns**: Verification report with findings

**What it does**:
- For each critical file, verify the security properties still hold
- Check for regressions since last audit
- Flag any concerning changes
- Update HOT-SPOTS.md if new critical code found

#### 6. question-investigator

**Purpose**: Research and answer open security questions.

**Reads**: `.security/CODEBASE-UNDERSTANDING.md` (Open Questions section)
**Returns**: Answers/progress for assigned questions

**What it does**:
- Takes one or more open questions from the queue
- Deeply researches the codebase to answer them
- Returns findings with evidence (file paths, code snippets)
- Recommends question status update (Answered, Partial, Blocked)

#### 7. change-analyzer

**Purpose**: Security-focused analysis of recent code changes.

**Reads**: Git log since last audit
**Returns**: Security assessment of changes

**What it does**:
- Lists commits since last audit
- Identifies security-relevant changes (touching hot spots, adding new entry points)
- Flags concerning patterns
- Recommends investigation if needed

#### 8. finding-investigator

**Purpose**: Deep dive into a specific finding.

**Input**: Finding ID or description
**Writes**: `.security/intel/findings/NNN-finding-name.md`

**What it does**:
- Traces the complete attack path
- Identifies all affected code paths
- Evaluates exploitability
- Proposes specific remediation
- Estimates effort to fix

---

## State Management

### STATE.md Template

```markdown
# Security Audit State

**Last Updated**: YYYY-MM-DD HH:MM

## Current Position

**Last full mapping**: YYYY-MM-DD
**Last incremental audit**: YYYY-MM-DD
**Commits since last audit**: N
**Open findings**: N (H high, M medium, L low)
**Open questions**: N

## Coverage Status

| Area | Last Checked | Status |
|------|--------------|--------|
| Attack surface | YYYY-MM-DD | Current |
| Data flows | YYYY-MM-DD | Stale (15 commits) |
| Security controls | YYYY-MM-DD | Current |
| Hot spots | YYYY-MM-DD | Current |

## Active Investigations

- Finding #009: Incomplete shell escaping (assigned, in progress)
- Q1: Webhook authentication (not started)

## Accumulated Context

### Recent Decisions
- 2026-02-05: Accepted hostConfigOverride as documented risk
- 2026-02-04: Added path-safety utility for all state operations

### Known Gaps
- No secret detection in logs
- No rate limiting on triggers
- Webhook signature verification unknown

## Session Continuity

**Resume from**: Completed incremental audit 2026-02-05
**Next priority**: Investigate Q1 (webhook authentication)
```

---

## Workflow Definitions

### /security-map-codebase (Full Security Mapping)

**When to run**: Initially, and periodically (weekly/monthly) or after major refactors.

**Process**:
1. Check if mapping exists and is current
2. If stale/missing, spawn 4 parallel mapper agents
3. Each agent writes its document directly
4. Orchestrator verifies documents created
5. Commit mapping to repository
6. Update STATE.md with mapping date

**Context usage**: Orchestrator ~10%, each mapper ~30-50%

### /security-audit (Incremental Audit)

**When to run**: Daily or on-demand.

**Process**:
1. Read STATE.md for current position
2. Run deterministic scanner
3. Compare to previous scan, identify new/resolved
4. Check commits since last audit
5. If hot spots changed → spawn hot-spot-verifier
6. If open questions exist → spawn question-investigator for highest priority
7. Aggregate all findings
8. Write intelligence report
9. Update FINDINGS-INDEX.md
10. Update STATE.md
11. Update CODEBASE-UNDERSTANDING.md if new insights

**Context usage**: Orchestrator ~15%, each investigator ~30-50%

### /security-audit-daily (Automated Daily Wrapper)

**When to run**: Via scheduler (cron/herdctl).

**Process**:
1. Run /security-audit
2. Run /security-audit-review on the audit just performed
3. Generate executive summary
4. Commit all artifacts to security/daily-audits branch
5. Push to remote

**Context usage**: Meta-orchestrator ~5% (just sequencing)

### /security-deep-dive <finding-id>

**When to run**: When a finding needs thorough investigation.

**Process**:
1. Load finding from FINDINGS-INDEX.md
2. Spawn finding-investigator agent with full context
3. Agent produces deep-dive document
4. Update finding status and link to deep-dive

**Context usage**: Orchestrator ~5%, investigator ~60-80%

---

## Agent Templates

### Mapper Agent Prompt Template

```
Focus: {focus_area}

You are a security-focused codebase mapper. Your job is to analyze the herdctl codebase for {focus_description}.

**Your task:**
1. Explore the codebase systematically
2. Identify all relevant {items_to_find}
3. Document with file paths and evidence
4. Write your findings directly to: {output_file}

**Exploration approach:**
- Start with entry points: packages/core/src/index.ts, packages/cli/src/
- Follow imports to understand data flow
- Use grep to find all instances of security-relevant patterns
- Check tests for security assumptions

**Output format:**
Follow the template structure in {template_reference}

**When complete, return:**
- Confirmation that document was written
- Line count
- Key findings summary (3-5 bullets)
```

### Investigator Agent Prompt Template

```
Investigation: {investigation_type}

You are a security investigator. Your job is to {investigation_goal}.

**Context:**
{relevant_context_from_state}

**Specific task:**
{specific_investigation_instructions}

**Approach:**
1. Read relevant code thoroughly
2. Trace data flow / attack path
3. Check for existing mitigations
4. Evaluate real-world exploitability
5. Document findings with evidence

**Return format:**
{structured_return_format}
```

---

## Success Criteria

### For Full Codebase Mapping

- [ ] All 4 mapping documents created with substantial content
- [ ] Each document includes file paths (not just descriptions)
- [ ] Trust boundaries clearly identified
- [ ] Attack surface is comprehensive (all entry points found)
- [ ] Data flows trace user input to sensitive operations

### For Incremental Audit

- [ ] Completes in <20 minutes with subagent spawning
- [ ] Main context stays under 40% utilization
- [ ] Progress made on at least one open question
- [ ] All hot spots verified
- [ ] Changes since last audit analyzed
- [ ] Report is substantive (not boilerplate)

### For Daily Automation

- [ ] Runs unattended end-to-end
- [ ] Produces actionable executive summary
- [ ] Commits cleanly to dedicated branch
- [ ] Status (GREEN/YELLOW/RED) accurately reflects findings

---

## Implementation Phases

### Phase 1: State Infrastructure

Create the state management foundation:
- STATE.md template and initialization
- Update existing commands to read/write state
- Session continuity tracking

### Phase 2: Security Mapper Agents

Create the 4 parallel mapping agents:
- attack-surface-mapper
- data-flow-tracer
- security-controls-mapper
- threat-vector-analyzer

Create `/security-map-codebase` orchestrator command.

### Phase 3: Investigation Agents

Create the investigation agents:
- hot-spot-verifier
- question-investigator
- change-analyzer
- finding-investigator

Update `/security-audit` to spawn these agents.

### Phase 4: Orchestrator Refinement

- Optimize orchestrator to minimize context usage
- Add parallel spawning where appropriate
- Implement result aggregation
- Tune agent prompts for quality

### Phase 5: Integration and Testing

- Test full mapping run
- Test incremental audit with spawning
- Test daily automation end-to-end
- Validate context usage targets

---

## Existing Assets to Preserve

### Keep and Integrate

- `.security/tools/scan.ts` - Deterministic scanner (works well)
- `.security/HOT-SPOTS.md` - Critical files list (enhance with agent verification)
- `.security/CODEBASE-UNDERSTANDING.md` - Open questions (integrate with state)
- `.security/intel/FINDINGS-INDEX.md` - Findings tracker (keep format)

### Refactor

- `.claude/commands/security-audit.md` - Update to orchestrator pattern
- `.claude/commands/security-audit-review.md` - May spawn review agent
- `.claude/commands/security-audit-daily.md` - Becomes meta-orchestrator

### Create New

- `.security/STATE.md` - Living memory
- `.security/codebase-map/*.md` - Security-focused mapping (4 files)
- Subagent definitions (in `.claude/agents/security/` or similar)
- `/security-map-codebase` command
- `/security-deep-dive` command

---

## Notes for GSD Implementation

This specification describes a security audit system that mirrors GSD's own architecture:
- Subagent orchestration for deep work
- Persistent state files for session continuity
- Structured documentation with templates
- Parallel agent spawning for efficiency
- Minimal orchestrator context usage

The herdctl codebase is a TypeScript monorepo with:
- `packages/core/` - Core library (FleetManager, config, scheduler, state, runner)
- `packages/cli/` - CLI wrapper
- Security-critical areas documented in `.security/HOT-SPOTS.md`

The existing security scanner (`pnpm security`) runs 6 checks and produces JSON output.

---

## Appendix: Codebase Quick Reference

### Security-Critical Directories

```
packages/core/src/
├── config/           # Configuration loading and validation
│   ├── schema.ts     # Zod schemas (primary defense)
│   ├── loader.ts     # YAML parsing
│   └── interpolate.ts # Environment variable substitution
├── runner/           # Agent execution
│   └── runtime/
│       ├── container-manager.ts  # Docker security config
│       ├── container-runner.ts   # Docker exec (shell escaping issue)
│       └── cli-runtime.ts        # Direct process spawning
├── state/            # State persistence
│   ├── session.ts    # Session file management
│   ├── job-metadata.ts # Job file management
│   └── utils/
│       └── path-safety.ts  # Path traversal defense
└── hooks/            # Hook execution
    └── runners/
        └── shell.ts  # Shell hook execution (shell: true)
```

### Key Security Patterns

```typescript
// Good: Array arguments (no injection)
execa('claude', ['--print', prompt])

// Risky: Shell execution (used for hooks, documented)
execa(command, { shell: true })

// Good: Path safety
buildSafeFilePath(baseDir, identifier, '.json')

// Good: Strict schema validation
AgentConfigSchema.strict().parse(config)
```

### Known Accepted Risks

1. `hostConfigOverride` - Can bypass Docker hardening (user responsibility)
2. `shell: true` in hooks - Required for shell functionality
3. `bypassPermissions` - Exists for legitimate use cases
