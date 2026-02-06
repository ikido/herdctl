# Security Scan Checklist

This document describes what the automated security scanner checks and how to interpret results.

## Automated Checks

### 1. npm-audit

**Purpose**: Detect known vulnerabilities in npm dependencies.

**What it checks**:
- All direct and transitive dependencies
- Known CVEs from npm advisory database

**Severity mapping**:
- `critical` → CVE with CVSS 9.0+
- `high` → CVE with CVSS 7.0-8.9
- `medium` → CVE with CVSS 4.0-6.9
- `low` → CVE with CVSS below 4.0

**Common fixes**:
```bash
# Auto-fix where possible
pnpm audit fix

# Manual update for specific package
pnpm update <package-name>
```

---

### 2. docker-config

**Purpose**: Detect dangerous Docker configuration patterns.

**What it checks**:

| Pattern | Risk | Why it's dangerous |
|---------|------|-------------------|
| `hostConfigOverride` | HIGH | Bypasses all Docker security hardening |
| `privileged: true` | CRITICAL | Full host access, container escape trivial |
| `CapAdd: SYS_ADMIN` | HIGH | Allows mount operations, kernel module loading |
| `CapAdd: SYS_PTRACE` | HIGH | Allows debugging other processes |
| `network: none` | HIGH | Breaks Claude API access |
| `network: host` | MEDIUM | Shares host network namespace |
| Docker socket mount | CRITICAL | Full Docker control = root on host |

**Safe defaults (already applied)**:
```typescript
CapDrop: ["ALL"],
SecurityOpt: ["no-new-privileges:true"],
PidsLimit: 256,
```

---

### 3. permission-modes

**Purpose**: Track usage of dangerous permission modes.

**What it checks**:

| Mode | Risk | Description |
|------|------|-------------|
| `bypassPermissions` | HIGH | Bypasses ALL Claude Code safety checks |
| `acceptEdits` | MEDIUM | Auto-accepts file modifications |
| `dontAsk` | MEDIUM | Allows all operations without prompting |

**Expected baseline**:
- `bypassPermissions`: Should be 0 in production configs
- `acceptEdits`: May be needed for automation, review each use
- `dontAsk`: Similar to acceptEdits, review each use

---

### 4. subprocess-patterns

**Purpose**: Detect command injection vulnerabilities.

**What it checks**:

| Pattern | Risk | Example |
|---------|------|---------|
| Template literal in execa | HIGH | ``execa(`git ${cmd}`)`` |
| Variable command | MEDIUM | `execa(userInput)` |
| shell: true option | MEDIUM | `execa("cmd", { shell: true })` |
| Direct child_process | LOW | Using spawn/exec directly |

**Safe patterns**:
```typescript
// Good: Array arguments
execa("git", ["commit", "-m", message])

// Good: Hardcoded command
execa("npm", ["install"])

// Bad: String interpolation
execa(`git commit -m "${message}"`)  // Command injection!
```

---

### 5. path-safety

**Purpose**: Detect path traversal vulnerabilities.

**What it checks**:
- `path.join()` with user-controlled input
- Missing validation in state directory paths
- String concatenation for file paths
- Working directory validation usage

**Key files to protect**:
- `packages/core/src/state/directory.ts` - All state file paths
- `packages/core/src/state/job-output.ts` - Log file paths
- `packages/core/src/config/loader.ts` - Config file loading

**Safe patterns**:
```typescript
// Validate IDs before using in paths
if (agentId.includes('..') || agentId.startsWith('/')) {
  throw new Error('Invalid agent ID');
}
const statePath = path.join(stateDir, agentId);

// Use path.resolve to normalize
const normalizedPath = path.resolve(basePath, userInput);
if (!normalizedPath.startsWith(basePath)) {
  throw new Error('Path traversal detected');
}
```

---

### 6. env-handling

**Purpose**: Detect potential secret exposure.

**What it checks**:

| Pattern | Risk | Description |
|---------|------|-------------|
| Hardcoded API keys | CRITICAL | `sk-...`, `ghp_...` in code |
| Secrets in logs | HIGH | Logging variables named `token`, `secret` |
| ENV in Dockerfile | HIGH | Baking secrets into image |
| ARG with secrets | MEDIUM | Build-time secrets can leak in layers |

**Safe patterns**:
```typescript
// Good: Read from environment
const token = process.env.GITHUB_TOKEN;

// Good: Validate with Zod
const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
});

// Bad: Hardcoded
const token = "ghp_xxxxxxxxxxxxxxxxxxxx";

// Bad: Logging secrets
console.log(`Token: ${token}`);
```

---

## Interpreting Results

### Status Levels

| Status | Meaning | Action |
|--------|---------|--------|
| `pass` | No issues found | No action needed |
| `warn` | Non-critical issues | Review and fix when convenient |
| `fail` | Critical issues found | Fix before deploying |

### Exit Codes

- `0` - Pass or warn (safe to continue)
- `1` - Fail (critical issues found)
- `2` - Scanner error (couldn't complete scan)

---

## Manual Review Areas

The automated scanner can't catch everything. Manually review:

1. **Business logic flaws** - Authorization checks, data validation
2. **Cryptographic issues** - Random number generation, key management
3. **Race conditions** - Concurrent file access, state updates
4. **Information disclosure** - Error messages, stack traces
5. **Denial of service** - Unbounded loops, memory leaks

---

## Running the Scanner

```bash
# Default human-readable output
npx tsx .security/tools/scan.ts

# JSON output (for automation)
npx tsx .security/tools/scan.ts --json

# Save results to .security/scans/
npx tsx .security/tools/scan.ts --save

# Combined
npx tsx .security/tools/scan.ts --json --save
```

---

## Adding New Checks

To add a new security check:

1. Create a new file in `.security/tools/checks/`
2. Export an async function that returns `Finding[]`
3. Import and register in `.security/tools/scan.ts`
4. Document in this checklist

Template:
```typescript
import type { Finding } from "../scan.js";

export async function checkNewThing(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Your check logic here

  return findings;
}
```
