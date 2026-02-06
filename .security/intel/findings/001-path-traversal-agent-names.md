# Finding 001: Path Traversal via Agent Names

**Severity**: High → Fixed
**First Detected**: 2026-02-05
**Status**: ✅ Resolved
**Fixed In**: Branch `feature/security-scanner`

---

## Summary

Agent names from configuration files were used directly in file path construction
without validation. This allowed potential path traversal attacks where a
malicious agent name like `../../../tmp/evil` could cause files to be written
outside the intended `.herdctl/sessions/` directory.

---

## Technical Details

### Vulnerable Code (Before Fix)

**packages/core/src/state/session.ts**
```typescript
function getSessionFilePath(sessionsDir: string, agentName: string): string {
  return join(sessionsDir, `${agentName}.json`);  // No validation!
}
```

**packages/core/src/state/job-metadata.ts**
```typescript
function getJobFilePath(jobsDir: string, jobId: string): string {
  return join(jobsDir, `${jobId}.yaml`);  // Also no validation
}
```

**packages/core/src/config/schema.ts**
```typescript
// Agent names only had basic string validation
name: z.string(),  // No pattern restriction
```

### Attack Scenario

1. Attacker creates a fleet config with a malicious agent name:
   ```yaml
   agents:
     - name: "../../../tmp/evil"
       prompt: "innocent looking prompt"
   ```

2. When herdctl processes this config, it calls `getSessionFilePath()`:
   ```typescript
   const path = join("/home/user/.herdctl/sessions", "../../../tmp/evil", ".json")
   // Results in: "/tmp/evil.json"
   ```

3. Session data (including potentially sensitive info) is written to `/tmp/evil.json`
   instead of the intended location.

4. **Potential impacts**:
   - Arbitrary file write (if path points to writable location)
   - Information disclosure (session data written to unexpected location)
   - Denial of service (overwrite important files)
   - Privilege escalation (if combined with other vulnerabilities)

### Data Flow Analysis

```
fleet.yaml (attacker-controlled input)
  │
  ▼
ConfigLoader.load()
  │
  ▼
AgentConfigSchema.parse()  ← WAS: only z.string(), no pattern
  │
  ▼
FleetManager.startAgent()
  │
  ▼
getSessionFilePath(sessionsDir, agent.name)  ← VULNERABLE: used name directly
  │
  ▼
atomicWriteJson(filePath, sessionData)
  │
  ▼
fs.writeFile(filePath)  ← FILE WRITTEN TO ATTACKER-CONTROLLED PATH
```

### Why This Wasn't Caught Earlier

1. **Job IDs were secure by accident**: Job IDs used a strict pattern
   (`job-YYYY-MM-DD-<random>`) that happened to prevent path traversal

2. **Agent names assumed to be simple**: We assumed users would use simple
   names like "developer" or "reviewer", not malicious strings

3. **No adversarial testing**: Test cases only used valid, simple names

4. **Trust boundary confusion**: Config was treated as "trusted input" but
   it's actually user-controlled

---

## Fix Applied

### Layer 1: Schema Validation (First Defense)

**packages/core/src/config/schema.ts**
```typescript
/**
 * Regex for valid agent names - alphanumeric with underscores and hyphens.
 * Must start with alphanumeric character.
 * This prevents path traversal attacks (../) when names are used in file paths.
 */
export const AGENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export const AgentConfigSchema = z.object({
  name: z.string().regex(AGENT_NAME_PATTERN, {
    message: "Agent name must start with a letter or number and contain only letters, numbers, underscores, and hyphens",
  }),
  // ...
});
```

### Layer 2: Safe Path Utility (Defense in Depth)

**packages/core/src/state/utils/path-safety.ts** (new file)
```typescript
export const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function buildSafeFilePath(
  baseDir: string,
  identifier: string,
  extension: string
): string {
  // First defense: validate identifier format
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new PathTraversalError(baseDir, identifier, "(invalid identifier)");
  }

  const fileName = `${identifier}${extension}`;
  const filePath = join(baseDir, fileName);

  // Second defense: verify resolved path stays within baseDir
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(filePath);

  if (!resolvedPath.startsWith(resolvedBase + "/") && resolvedPath !== resolvedBase) {
    throw new PathTraversalError(baseDir, identifier, resolvedPath);
  }

  return filePath;
}
```

### Layer 3: Updated Call Sites

**packages/core/src/state/session.ts**
```typescript
import { buildSafeFilePath } from "./utils/path-safety.js";

function getSessionFilePath(sessionsDir: string, agentName: string): string {
  return buildSafeFilePath(sessionsDir, agentName, ".json");
}
```

**packages/core/src/state/job-metadata.ts**
```typescript
import { buildSafeFilePath } from "./utils/path-safety.js";

function getJobFilePath(jobsDir: string, jobId: string): string {
  return buildSafeFilePath(jobsDir, jobId, ".yaml");
}
```

---

## Verification

### Unit Tests Added

**path-safety.test.ts** (56 tests)
- Valid identifier acceptance
- Path traversal rejection (`../`, `..\\`, absolute paths)
- Special character rejection
- Boundary verification (resolved path must start with base)

**agent.test.ts** (19 tests added)
- Valid agent names accepted
- Malicious names rejected at schema level
- Error messages are helpful

### Test Coverage

```
path-safety.ts: 94.73% statements, 90% branches
```

### Security Scanner

```
path-safety... PASS (0 findings)
```

---

## Lessons Learned

1. **All user-controllable strings used in paths need validation**
   - Even if they "should" be simple values
   - Config files are user input, not trusted

2. **Defense in depth is essential**
   - Schema validation catches most cases
   - Path safety utility catches edge cases
   - Resolved path verification is the final check

3. **Patterns that work for one field might not exist for another**
   - Job IDs were secure (strict pattern)
   - Agent names weren't (just `z.string()`)
   - Must audit all identifiers used in paths

4. **Test with adversarial mindset**
   - "What's the worst input someone could provide?"
   - Include path traversal, special characters, empty strings

---

## Related Findings

- Job IDs: Already had strict pattern, not vulnerable
- Directory names in `.herdctl/`: Should audit for similar issues
- Any other user strings becoming file paths: Need review

---

## Timeline

| Date | Event |
|------|-------|
| 2026-02-05 | Initial security scan flagged potential path traversal |
| 2026-02-05 | Investigation confirmed vulnerability |
| 2026-02-05 | Fix implemented (schema + path-safety utility) |
| 2026-02-05 | Tests added (75 total tests for this fix) |
| 2026-02-05 | Verified scanner no longer flags |
