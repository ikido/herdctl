# Security Findings Index

This index tracks all security findings discovered through automated scanning
and manual review. Updated after each security review.

## Active Findings

| ID | Severity | Title | First Seen | Status | Location |
|----|----------|-------|------------|--------|----------|
| 002 | High | hostConfigOverride can bypass Docker security | 2026-02-05 | ⚠️ Accepted Risk | container-manager.ts |
| 005 | Medium | bypassPermissions in example config | 2026-02-05 | ℹ️ Intentional | examples/bragdoc-developer/ |
| 006 | Medium | shell:true in hook runner | 2026-02-05 | ⚠️ Accepted Risk | hooks/runners/shell.ts |
| 008 | Medium | npm audit moderate vulnerabilities | 2026-02-05 | 📋 Dependabot | dependencies |
| 009 | Low | Incomplete shell escaping in Docker prompts | 2026-02-05 | 🔧 Tech Debt | container-runner.ts:157 |

## Resolved Findings

| ID | Title | Fixed In | Verified |
|----|-------|----------|----------|
| 001 | Path traversal via agent names | feature/security-scanner | 2026-02-05 |
| 007 | network:none in example config | Already commented out | 2026-02-05 |

## False Positives (Scanner Limitations)

| ID | Title | Why False Positive | Action |
|----|-------|-------------------|--------|
| 003 | "Secret logging" in init.ts | Logs help text "set GITHUB_TOKEN env var", not actual token | Improve scanner |
| 004 | "Secret logging" in error-handling.ts | Logs help text about missing API key, not actual key | Improve scanner |

## Won't Fix (Accepted Risks)

| ID | Title | Reason | Documented In |
|----|-------|--------|---------------|
| 002 | hostConfigOverride bypass | Required for advanced Docker configuration at fleet level | THREAT-MODEL.md |
| 005 | bypassPermissions in example | Intentional for demo purposes, not production code | CHECKLIST.md |
| 006 | shell:true in hook runner | Required for shell hook functionality; user controls hook config | THREAT-MODEL.md |

---

## Finding Details

### ID 001: Path Traversal via Agent Names ✅ FIXED
**Severity**: High → Resolved
**First Seen**: 2026-02-05
**Status**: Fixed

Agent names were used directly in file paths without validation. A malicious
name like `../../../tmp/evil` could write files outside `.herdctl/`.

**Fix Applied**:
- Added `AGENT_NAME_PATTERN` regex validation to config schema
- Created `buildSafeFilePath()` utility for defense-in-depth
- Updated session.ts and job-metadata.ts to use safe utility

**Deep Dive**: [001-path-traversal-agent-names.md](./findings/001-path-traversal-agent-names.md)

---

### ID 002: hostConfigOverride Bypass ⚠️ ACCEPTED
**Severity**: High
**Status**: Accepted risk with documentation

The `hostConfigOverride` option in Docker config can bypass all security
hardening (capability dropping, no-new-privileges, etc.).

**Why Accepted**:
- Required for legitimate advanced Docker configurations
- Only available at fleet level, not agent level
- Must be explicitly configured by the fleet operator

**Mitigations**:
- Documented in THREAT-MODEL.md
- Security scanner flags all usages
- Schema prevents this at agent config level

---

### ID 003: "Secret Logging" in init.ts ❌ FALSE POSITIVE
**Severity**: Was High → False Positive
**Location**: `packages/cli/src/commands/init.ts:339`

Scanner detected `token` in proximity to a log statement. Manual review
confirmed this is just help text telling users to set an environment variable:
```typescript
console.log("  and set the GITHUB_TOKEN environment variable.");
```

No actual secrets are logged. Scanner needs improvement to understand context.

---

### ID 004: "Secret Logging" in error-handling.ts ❌ FALSE POSITIVE
**Severity**: Was High → False Positive
**Location**: `examples/library-usage/error-handling.ts:443-444`

Scanner detected `api_key` in proximity to log statements. Manual review
confirmed this is help text for missing credentials:
```typescript
console.error("ERROR: Missing ANTHROPIC_API_KEY environment variable");
console.error("  Set it with: export ANTHROPIC_API_KEY=sk-ant-...");
```

The `sk-ant-...` is a placeholder example, not an actual key.

---

### ID 007: network:none in Example ✅ RESOLVED
**Severity**: Medium → Resolved
**Location**: `examples/runtime-showcase/agents/mixed-fleet.yaml:67`

Scanner flagged `network: none` which would break Claude agents. Manual review
found it's already commented out with a warning:
```yaml
#   network: none  # Can't reach APIs!
```

Scanner should skip commented lines.

---

### ID 008: npm Audit Vulnerabilities 📋 TRACKED
**Severity**: Medium
**Status**: Tracked via Dependabot

2 moderate vulnerabilities in dependencies. Standard approach is to use
GitHub Dependabot for automated PR creation when updates are available.

---

### ID 009: Incomplete Shell Escaping in Docker Prompts 🔧 TECH DEBT
**Severity**: Low
**First Seen**: 2026-02-05 (evening review)
**Location**: `packages/core/src/runner/runtime/container-runner.ts:157-162`
**Status**: Technical debt - low priority

When constructing Docker exec commands, prompts are escaped for `\` and `"` only:
```typescript
const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
```

Missing escapes for shell special characters: `$`, `` ` ``, `!`

**Risk Assessment**:
- Command runs inside container (security boundary)
- Fleet config authors are trusted
- Practical risk is low

**Recommendation**: Add complete escaping for defense in depth:
```typescript
const escapedPrompt = prompt
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\$/g, '\\$')
  .replace(/`/g, '\\`')
  .replace(/!/g, '\\!');
```

---

## Statistics

- **Total Findings**: 9
- **Resolved**: 2
- **False Positives**: 2
- **Active**: 5
  - Critical: 0
  - High: 1 (accepted)
  - Medium: 3 (2 accepted, 1 tracked)
  - Low: 1 (tech debt)

---

## Scanner Improvements Needed

Based on false positives identified:

1. **env-handling check**: Should analyze context, not just proximity of
   keywords to log statements. Help text about env vars is not secret logging.

2. **docker-config check**: Should skip YAML comments when looking for
   dangerous patterns like `network: none`.

---

## Review History

| Date | Reviewer | New Findings | Resolved | Notes |
|------|----------|--------------|----------|-------|
| 2026-02-05 | Claude + Ed | 8 | 1 | Initial baseline + path traversal fix |
| 2026-02-05 | Claude + Ed | 0 | 3 | Review of findings: 2 false positives, 1 already fixed |
| 2026-02-05 | Claude (automated) | 1 | 0 | Evening review: verified fixes, found shell escaping tech debt |
