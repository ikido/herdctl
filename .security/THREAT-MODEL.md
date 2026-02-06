# Threat Model for herdctl

This document describes the attack surfaces, threat actors, and mitigations for the herdctl fleet management system.

## System Overview

herdctl manages fleets of autonomous Claude Code agents. Key components:
- **FleetManager**: Orchestrates agent lifecycle
- **Scheduler**: Triggers agents on intervals/cron schedules
- **Runners**: Execute agents as child processes or Docker containers
- **State**: Persists job history and schedule state to `.herdctl/`
- **Config**: YAML-based configuration with environment variable interpolation

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host System                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    herdctl Process                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │   Config    │  │  Scheduler  │  │   FleetManager  │   │   │
│  │  │   (YAML)    │  │             │  │                 │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                    spawns child processes                        │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Agent Execution Environment                  │   │
│  │  ┌─────────────────────┐  ┌─────────────────────────┐    │   │
│  │  │   CLI Runtime       │  │   Docker Container      │    │   │
│  │  │   (direct spawn)    │  │   (isolated)            │    │   │
│  │  └─────────────────────┘  └─────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    network access to
                              ▼
                   ┌─────────────────┐
                   │  Anthropic API  │
                   │  GitHub API     │
                   │  External URLs  │
                   └─────────────────┘
```

## Threat Actors

### 1. Malicious Agent Output
**Description**: An agent, through prompt injection or model misbehavior, attempts to:
- Escape its sandbox
- Access files outside its workspace
- Exfiltrate sensitive data
- Modify the herdctl configuration

**Mitigations**:
- Docker containers drop all capabilities (`CapDrop: ALL`)
- `no-new-privileges` security option prevents privilege escalation
- Working directory validation prevents directory traversal
- Permission modes limit what actions agents can take
- Resource limits (memory, CPU, PIDs) prevent denial of service

### 2. Configuration Tampering
**Description**: Attacker modifies fleet.yaml or agent configs to:
- Inject malicious prompts
- Bypass security controls
- Expose secrets

**Mitigations**:
- Zod schema validation with `.strict()` rejects unknown fields
- Environment variable interpolation uses simple substitution (no command execution)
- Safe vs dangerous options separated (agent-level vs fleet-level)
- Config files should be protected by filesystem permissions

**Gaps**:
- No config file integrity verification
- No signature validation on configs

### 3. State Directory Manipulation
**Description**: Attacker modifies `.herdctl/` state files to:
- Forge job history
- Manipulate schedule state
- Inject malicious data into logs

**Mitigations**:
- Working directory validation detects unexpected changes
- State files are append-only (JSONL format)
- Job metadata includes checksums (TODO: verify)

**Gaps**:
- File permissions not explicitly validated
- No encryption of sensitive state data

### 4. Container Escape
**Description**: Agent breaks out of Docker container isolation.

**Mitigations**:
- All capabilities dropped
- no-new-privileges enabled
- Memory and PID limits prevent resource exhaustion
- Network isolation options available

**Gaps**:
- `hostConfigOverride` can bypass safety constraints
- Privileged mode not explicitly blocked (relies on admin config)

### 5. Webhook Spoofing
**Description**: Attacker sends fake webhook events to trigger agents.

**Mitigations**:
- Webhook secret validation (implementation status: TODO)
- Rate limiting on triggers (implementation status: TODO)

**Gaps**:
- Webhook authentication may not be fully implemented

### 6. Secret Exposure
**Description**: Sensitive data (API keys, tokens) leaked through:
- Agent output logs
- Configuration files
- Error messages

**Mitigations**:
- Environment variables passed explicitly, not inherited
- Docker containers get clean environment
- Secrets should use env vars, not config files

**Gaps**:
- No automatic secret detection in logs
- No redaction of sensitive patterns

## Attack Surface by Component

### Config (`packages/core/src/config/`)

| Entry Point | Risk | Status |
|-------------|------|--------|
| `interpolate.ts` - env var substitution | Command injection | **Mitigated** - simple substitution only |
| `loader.ts` - YAML parsing | YAML bombs, prototype pollution | **Mitigated** - uses js-yaml safe load |
| `schema.ts` - validation | Schema bypass | **Mitigated** - Zod with `.strict()` |

### Runner (`packages/core/src/runner/`)

| Entry Point | Risk | Status |
|-------------|------|--------|
| `cli-runtime.ts` - process spawning | Command injection | **Review needed** - uses execa with array args |
| `container-manager.ts` - Docker API | Container escape | **Partially mitigated** - hardening applied |
| `container-manager.ts:hostConfigOverride` | Safety bypass | **Gap** - can override security settings |

### State (`packages/core/src/state/`)

| Entry Point | Risk | Status |
|-------------|------|--------|
| `directory.ts` - path construction | Path traversal | **Review needed** |
| `job-output.ts` - log writing | Log injection | **Review needed** |
| `working-directory-validation.ts` | Session hijacking | **Mitigated** - validates workspace |

### Scheduler (`packages/core/src/scheduler/`)

| Entry Point | Risk | Status |
|-------------|------|--------|
| `interval.ts` - parsing | Integer overflow | **Mitigated** - validated |
| `cron.ts` - parsing | Malformed expressions | **Review needed** - uses cron-parser |

## Recommended Security Improvements

### High Priority
1. **Block `hostConfigOverride` at agent level** - Only allow at fleet level with explicit opt-in
2. **Implement webhook signature verification** - Prevent spoofed triggers
3. **Add secret detection to log output** - Redact common patterns (API keys, tokens)

### Medium Priority
4. **Validate file permissions on `.herdctl/`** - Ensure proper ownership
5. **Add config file integrity checks** - Detect tampering
6. **Implement rate limiting on triggers** - Prevent abuse

### Low Priority
7. **Add audit logging** - Track sensitive operations
8. **Encrypt sensitive state data** - Protect at rest
9. **Add security event notifications** - Alert on anomalies

## Security Testing Checklist

- [ ] Attempt path traversal in workspace config
- [ ] Test malformed cron expressions
- [ ] Verify capability dropping in containers
- [ ] Test env var interpolation edge cases
- [ ] Attempt to bypass permission modes
- [ ] Verify working directory validation
- [ ] Test resource limit enforcement
- [ ] Attempt log injection attacks
