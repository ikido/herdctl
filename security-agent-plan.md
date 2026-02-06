# Security Scanner Implementation Plan

This document tracks the implementation of an automated security scanning system for herdctl, using herdctl itself to run daily security audits.

## Goals

1. **Automated daily security scans** via herdctl schedule (dogfooding)
2. **Deterministic tooling** for fast, reliable baseline checks
3. **Security documentation** to focus reviewers on what matters
4. **Scan history** to track findings over time

## Directory Structure

```
.security/
├── THREAT-MODEL.md           # Attack surfaces & mitigations
├── SECURITY-ARCHITECTURE.md  # Where security concerns live in code
├── CHECKLIST.md              # What each scan checks
├── tools/
│   ├── scan.ts               # Main deterministic scanner
│   ├── utils.ts              # Shared utilities
│   └── checks/               # Individual check modules
│       ├── npm-audit.ts
│       ├── docker-config.ts
│       ├── permission-modes.ts
│       ├── subprocess-patterns.ts
│       ├── path-safety.ts
│       └── env-handling.ts
├── scans/
│   └── .gitkeep              # Historical scan results (YYYY-MM-DD.json)
└── fleet.yaml                # herdctl config for security agent
```

## Implementation Phases

### Phase 1: Foundation ✅
- [x] Create plan document
- [x] Create `.security/` directory structure
- [x] Write THREAT-MODEL.md
- [x] Write SECURITY-ARCHITECTURE.md
- [x] Write CHECKLIST.md

### Phase 2: Deterministic Scanner ✅
- [x] Scaffold `tools/scan.ts` entry point
- [x] Implement individual checks:
  - [x] npm audit wrapper
  - [x] Docker config validation (hostConfigOverride detection)
  - [x] Permission mode usage analysis
  - [x] Subprocess spawning pattern checks
  - [x] Path construction safety
  - [x] Environment variable handling
- [x] Implement JSON reporter
- [x] Add npm script to run scanner (`pnpm security`)

### Phase 3: herdctl Integration ✅
- [x] Create `.security/fleet.yaml` configuration
- [x] Write security auditor agent prompt
- [x] Test manual execution
- [x] Verify scan output format

### Phase 4: History & Reporting (Partial)
- [x] Create scan history schema (JSON format)
- [x] Document how to review findings (CHECKLIST.md)
- [ ] Add summary script for trends (future enhancement)

---

## Running the Scanner

```bash
# Human-readable output
pnpm security

# JSON output
npx tsx .security/tools/scan.ts --json

# Save results to .security/scans/
pnpm security:save
```

## Current Baseline (2026-02-05)

First scan results after implementation:

| Check | Status | Findings |
|-------|--------|----------|
| npm-audit | WARN | 2 moderate vulnerabilities |
| docker-config | FAIL | 4 findings (hostConfigOverride, network:none) |
| permission-modes | FAIL | 2 findings (bypassPermissions in example) |
| subprocess-patterns | WARN | 4 findings (shell:true usage) |
| path-safety | FAIL | 1 finding (path traversal concern) |
| env-handling | FAIL | 3 findings (potential secrets in logs) |

**Total: 15 findings | Runtime: ~1.7s**

### Known/Expected Findings

These are findings that are known and either intentional or tracked for future fixes:

1. **hostConfigOverride usage** - Documented in THREAT-MODEL.md as necessary for fleet-level config
2. **bypassPermissions in example** - Intentional for demo purposes in `examples/bragdoc-developer/`
3. **acceptEdits in examples** - Intentional for demo purposes
4. **shell: true in shell runner** - Required for shell hook execution (documented risk)

### Action Items from Baseline

1. **[BUG]** Fix `network: none` in `examples/runtime-showcase/agents/mixed-fleet.yaml:67`
2. **[SECURITY]** Review path traversal protection in `packages/core/src/state/directory.ts`
3. **[SECURITY]** Review potential secret logging in `packages/cli/src/commands/init.ts:339`
4. **[DEPS]** Review moderate npm vulnerabilities

---

## Custom Checks (herdctl-specific)

| Check | What it looks for | Severity |
|-------|-------------------|----------|
| `npm-audit` | Known CVEs in dependencies | Varies |
| `docker-config` | `hostConfigOverride` usage, dangerous options | High |
| `permission-modes` | `bypassPermissions` usage frequency | High |
| `subprocess-patterns` | Unsafe `execa` calls, shell injection | High |
| `path-safety` | User-controlled paths in fs operations | High |
| `env-handling` | Secrets in logs, hardcoded credentials | High |

---

## Key Security Concerns (from codebase analysis)

Based on exploration of the codebase, these are the priority areas:

1. **`hostConfigOverride` in container-manager.ts** - Can bypass safety constraints
2. **API authentication skipped** - Noted as MVP-only, needs tracking
3. **File permissions in `.herdctl/`** - Session data needs protection
4. **Subprocess spawning** - `execa` calls in cli-runtime.ts, container-runner.ts
5. **Config interpolation** - Environment variable substitution in interpolate.ts
6. **Working directory validation** - Prevents session mixup attacks

---

## Success Criteria

- [x] Scanner runs in <30 seconds (achieved: ~1.7s)
- [x] Low false positive rate (achieved: 15 findings, all meaningful)
- [ ] Catches intentionally introduced vulnerabilities in tests
- [ ] herdctl schedule executes daily without intervention
- [ ] Scan history shows trends over time
- [x] Documentation is useful for manual security reviews

---

## Next Steps

1. **Fix the network:none bug** in the example config
2. **Review the path safety concern** and add validation if needed
3. **Test the herdctl schedule** with the security agent
4. **Set up the daily cron** once herdctl scheduling is fully operational
5. **Add a trends summary script** to analyze scan history over time
