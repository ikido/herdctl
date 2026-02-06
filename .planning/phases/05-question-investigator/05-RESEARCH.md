# Phase 5: Question Investigator - Research

**Researched:** 2026-02-05
**Domain:** Security question investigation and research for open questions in CODEBASE-UNDERSTANDING.md
**Confidence:** HIGH

## Summary

This phase creates the `question-investigator` agent that systematically researches open security questions from CODEBASE-UNDERSTANDING.md. Unlike mapper agents (which produce comprehensive documentation), this is an **investigator agent** that researches assigned questions and returns findings with evidence to the orchestrator.

The agent follows the established investigator pattern from Phase 4's hot-spot-verifier: it reads questions from CODEBASE-UNDERSTANDING.md, deeply investigates the codebase to answer them, and returns structured findings. The `/security-audit` command spawns this agent when open questions exist (particularly High priority ones).

**Primary recommendation:** Create a question-investigator agent that follows the hot-spot-verifier pattern but focuses on researching questions rather than verifying properties. Return structured findings with evidence and recommend status updates (Answered/Partial/Blocked).

## Standard Stack

This phase does not introduce new libraries. It uses the existing agent definition pattern.

### Core

| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| Agent definition pattern | `.claude/agents/security/*.md` | YAML frontmatter + XML sections | Established in Phase 2, verified working |
| CODEBASE-UNDERSTANDING.md | `.security/CODEBASE-UNDERSTANDING.md` | Input data source (Open Questions table) | Already exists, well-structured with question IDs |
| Hot-spot-verifier pattern | `.claude/agents/security/hot-spot-verifier.md` | Reference investigator agent | Established in Phase 4, proven pattern |

### Supporting

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| Grep/Read tools | Search codebase for answers | Primary investigation method |
| Glob tool | Find relevant files | When question involves file discovery |
| Bash tool | Run git commands, check file state | For git history, file metadata |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Return to orchestrator | Write findings to file | Orchestrator needs to update CODEBASE-UNDERSTANDING.md - returning is cleaner |
| Single question per spawn | Multiple questions | Single question allows deeper investigation without context pressure |
| Agent updates CODEBASE-UNDERSTANDING.md | Orchestrator updates | Orchestrator has context of all agent results - better for coordinated updates |

## Architecture Patterns

### Agent Definition Structure

Follow the exact pattern from hot-spot-verifier:

```
.claude/agents/security/question-investigator.md
├── YAML frontmatter (name, description, tools, model, color)
├── <role> - Investigation purpose, inputs, outputs
├── <why_this_matters> - How output is consumed by orchestrator
├── <philosophy> - Investigation principles
├── <process> - Step-by-step investigation workflow
├── <investigation_strategies> - How to research different question types
├── <forbidden_files> - Same secret protections as other agents
├── <critical_rules> - Investigation-specific constraints
└── <success_criteria> - What constitutes successful investigation
```

### Input: Open Questions Table Format

The agent receives questions from CODEBASE-UNDERSTANDING.md:

```markdown
| ID | Question | Priority | Status | Assigned | Last Checked | Notes |
|----|----------|----------|--------|----------|--------------|-------|
| Q1 | How are GitHub webhooks authenticated? | Medium | Open | - | - | Check work-sources/ for webhook handling |
| Q2 | Are there other places where user-controlled strings become file paths? | High | Partial | - | 2026-02-05 | Checked session.ts, job-metadata.ts. Need grep broadly. |
```

### Output: Investigation Results

The agent returns structured results (not a written document):

```markdown
## Question Investigation Results

**Date:** YYYY-MM-DD
**Questions investigated:** N

### Q[ID]: [Question text]

**Status recommendation:** Answered | Partial | Blocked

**Finding:**
[Clear answer or partial findings]

**Evidence:**
- `file/path.ts:line` - [what was found]
- `another/file.ts:line` - [supporting evidence]

**Reasoning:**
[Why this answer is correct / Why more investigation needed]

**Notes for CODEBASE-UNDERSTANDING.md:**
[Suggested text for the Notes column]

---

### Q[ID]: [Next question]
...

---

## Summary

| Question | Priority | Previous Status | New Status | Key Finding |
|----------|----------|-----------------|------------|-------------|
| Q1 | Medium | Open | Answered | [one-liner] |
| Q2 | High | Partial | Answered | [one-liner] |

**Questions investigated:** N
**Status changes:** M
**Blocked questions:** K (need: [what's needed])
```

### Investigator vs Mapper vs Verifier Pattern

| Aspect | Mapper Agents | Hot-Spot Verifier | Question Investigator |
|--------|---------------|-------------------|----------------------|
| Purpose | Comprehensive analysis | Targeted verification | Deep research |
| Input | Codebase | HOT-SPOTS.md list | Question from table |
| Output | Writes document | Returns pass/fail report | Returns answer/findings |
| Scope | Entire domain | Specific files | Open-ended investigation |
| Result type | Documentation | PASS/FAIL/WARN status | Answered/Partial/Blocked |
| Invocation | /security-map-codebase | /security-audit (if hot spots changed) | /security-audit (if questions exist) |

### Anti-Patterns to Avoid

- **Surface-level investigation:** Don't stop at first finding. Follow threads until question is truly answered.
- **Answering without evidence:** Every answer needs file paths and code references.
- **Scope expansion:** Answer the question asked, don't map the entire related subsystem.
- **Forgetting existing notes:** The Notes column often has hints - read them first.
- **Not recommending status:** Always recommend a status update, even if it's "keep as Open."

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Question parsing | Custom markdown parsing | Simple grep for `\| Q` rows | Questions are in standardized table format |
| Status values | Invent new statuses | Use established: Open, Partial, In Progress, Answered, Blocked | Consistent with existing tracking |
| Evidence format | Free-form text | `file.ts:line - description` format | Matches hot-spot-verifier output |
| Priority handling | Custom priority logic | Trust orchestrator's assignment | Orchestrator picks high-priority questions |

**Key insight:** The question table already has a well-defined structure. The agent's job is to research and return findings, not redesign the tracking system.

## Common Pitfalls

### Pitfall 1: Shallow Investigation

**What goes wrong:** Agent finds one piece of evidence and declares question answered.
**Why it happens:** Trying to be efficient, not thorough.
**How to avoid:** For each question, ask "Is there anywhere else this could happen?" Follow up with broader grep searches.
**Warning signs:** Answers that could be invalidated by checking one more file.

### Pitfall 2: Forgetting the Notes Column

**What goes wrong:** Agent starts investigation from scratch, missing existing context.
**Why it happens:** Not reading the full question row.
**How to avoid:** Always read and incorporate existing Notes. They often contain hints from previous partial investigations.
**Warning signs:** Re-investigating areas marked as already checked.

### Pitfall 3: Reporting "Not Found" as "Answered"

**What goes wrong:** Agent doesn't find evidence of a problem and concludes there is no problem.
**Why it happens:** Absence of evidence treated as evidence of absence.
**How to avoid:** Distinguish between "verified safe" (positive evidence) and "couldn't find problem" (negative result).
**Warning signs:** "Answered: No issues found" without explaining what was checked.

### Pitfall 4: Over-scoping the Investigation

**What goes wrong:** Agent maps entire subsystem instead of answering the specific question.
**Why it happens:** Question touches broad area, agent follows every thread.
**How to avoid:** Stay focused on the question. Note related questions for future investigation.
**Warning signs:** Investigation takes 30+ minutes, report is 500+ lines.

### Pitfall 5: Not Handling "Blocked" Properly

**What goes wrong:** Agent reports "Partial" when actually blocked waiting for external input.
**Why it happens:** Reluctance to admit investigation can't proceed.
**How to avoid:** If the answer requires something the agent can't access (external docs, human knowledge), report "Blocked" with what's needed.
**Warning signs:** Same question stays "Partial" across multiple audits with no progress.

## Code Examples

### Question Types and Investigation Strategies

Different question types need different investigation approaches:

#### Type 1: "Does X exist?" / "Is X implemented?"

**Example:** Q1 - "How are GitHub webhooks authenticated? Is signature verification implemented?"

**Strategy:**
```bash
# Search for implementation
grep -rn "webhook\|signature\|hmac\|sha256" packages/ --include="*.ts" | head -30

# Check for GitHub-specific handling
grep -rn "x-hub-signature\|X-Hub-Signature" packages/ --include="*.ts"

# Look in likely locations
ls -la packages/core/src/work-sources/ 2>/dev/null
```

**Result patterns:**
- Found implementation: "Answered - signature verification in `file.ts:line`"
- Not implemented: "Answered - webhook signature verification is NOT implemented"
- Partially implemented: "Partial - signature header is checked but verification is incomplete"

#### Type 2: "Are there other places where X happens?"

**Example:** Q2 - "Are there other places where user-controlled strings become file paths?"

**Strategy:**
```bash
# Broad search for path construction
grep -rn "path\.join\|path\.resolve" packages/core/src --include="*.ts" | grep -v "__tests__"

# Check what was already investigated (from Notes)
# "Checked session.ts, job-metadata.ts"

# Filter to find NEW locations
grep -rn "path\.join\|path\.resolve" packages/core/src --include="*.ts" | \
  grep -v "__tests__\|session\.ts\|job-metadata\.ts"

# For each new location, trace if input is user-controlled
```

**Result patterns:**
- Found more: "Partial - found 3 additional locations: `file1.ts:line`, `file2.ts:line`, `file3.ts:line`"
- None found: "Answered - all path construction uses buildSafeFilePath or safe patterns"

#### Type 3: "What happens if X?"

**Example:** Q3 - "What happens if Docker container name contains special characters?"

**Strategy:**
```bash
# Find where container names are used
grep -rn "containerName\|container.*name" packages/core/src --include="*.ts" | head -20

# Check if names are validated
grep -rn "containerName" packages/core/src/config/schema.ts

# Trace through to Docker API calls
grep -A10 "containerName" packages/core/src/runner/runtime/container-manager.ts
```

**Result patterns:**
- Validated: "Answered - container names validated by pattern in schema.ts:line"
- Not validated: "Answered - container names NOT validated. Special chars would cause docker exec errors"
- Needs testing: "Partial - unclear without testing. Recommend creating test case."

#### Type 4: "Is X properly escaped/handled?"

**Example:** Q8 - "Is the prompt in SDK wrapper (HERDCTL_SDK_OPTIONS) properly escaped?"

**Strategy:**
```bash
# Find the specific code mentioned
grep -n "HERDCTL_SDK_OPTIONS" packages/core/src --include="*.ts" -r

# Read the surrounding context
# Then trace what escaping is applied
grep -B5 -A10 "HERDCTL_SDK_OPTIONS" packages/core/src/runner/runtime/container-runner.ts
```

**Result patterns:**
- Properly escaped: "Answered - uses JSON.stringify + shell escaping at `file.ts:line`"
- Not escaped: "Answered - NO escaping applied. Injection risk at `file.ts:line`"
- Partially: "Partial - JSON.stringify applied but shell escaping incomplete"

### Status Recommendation Logic

```
IF found_definitive_answer AND answer_has_evidence:
    status = "Answered"
ELIF found_partial_information AND can_continue_investigating:
    status = "Partial"
ELIF blocked_by_external_dependency:
    status = "Blocked"
    note_what_is_needed()
ELIF question_is_unclear:
    status = "Open"
    recommend_question_refinement()
```

### Evidence Documentation Pattern

Good evidence format:
```markdown
**Evidence:**
- `packages/core/src/config/schema.ts:45` - CONTAINER_NAME_PATTERN validates names
- `packages/core/src/runner/runtime/container-manager.ts:89` - name used directly in Docker create
- `packages/core/src/runner/runtime/container-runner.ts:156` - name used in docker exec command
```

Bad evidence format:
```markdown
**Evidence:**
- Checked the schema file
- Looked at container manager
- It seems fine
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual question tracking in auditor's head | Formal table in CODEBASE-UNDERSTANDING.md | Phase 1 | Persistent question tracking |
| Questions answered ad-hoc during audits | Dedicated investigation agent | This phase | Deep, focused investigation |
| No status tracking | Open/Partial/Answered/Blocked status | Existing | Clear progress visibility |

**Deprecated/outdated:**
- None - this is new capability

## Integration with /security-audit

The `/security-audit` orchestrator needs to:

### 1. Detect When to Spawn

```bash
# Check for open questions
grep -c "| Open \|| Partial " .security/CODEBASE-UNDERSTANDING.md

# Check for high-priority open questions specifically
grep "| High | Open \|| High | Partial " .security/CODEBASE-UNDERSTANDING.md
```

Spawn question-investigator when:
- High priority questions are Open or Partial
- Medium priority questions have been Open for multiple audits
- Explicit request to investigate a specific question

### 2. Prepare Agent Input

Pass to agent:
- The specific question(s) to investigate (by ID)
- Relevant context from previous Notes
- Time budget (optional - helps agent scope appropriately)

Example orchestrator prompt to agent:
```
Investigate the following security question from CODEBASE-UNDERSTANDING.md:

**Q2:** Are there other places where user-controlled strings become file paths?
**Priority:** High
**Current Status:** Partial
**Notes:** Checked session.ts, job-metadata.ts. Need to grep more broadly.

Research this question thoroughly and return your findings with evidence.
```

### 3. Handle Results

When question-investigator returns:
1. Update CODEBASE-UNDERSTANDING.md question status
2. Update Notes column with key findings
3. If Answered, optionally move to archive after 30 days
4. Include findings in intelligence report

## Open Questions

Things that couldn't be fully resolved:

1. **Should agent handle multiple questions per spawn?**
   - What we know: Single question allows deeper investigation
   - What's unclear: Context efficiency of spawning multiple times vs batch
   - Recommendation: Start with single question. Add batch mode later if needed.

2. **How to handle questions that need code changes to answer?**
   - What we know: Some questions (like Q3) might need test cases
   - What's unclear: Should agent create tests, or just report what's needed?
   - Recommendation: Agent reports what's needed. Orchestrator can create separate tasks.

3. **Priority decay - should old questions get elevated?**
   - What we know: Questions sitting Open for weeks may indicate problem
   - What's unclear: Should agent suggest priority changes?
   - Recommendation: Agent can note "has been open for N audits" but orchestrator decides priority.

## Sources

### Primary (HIGH confidence)

- `.security/CODEBASE-UNDERSTANDING.md` - Authoritative question format and current questions (280 lines, reviewed)
- `.claude/agents/security/hot-spot-verifier.md` - Reference investigator agent pattern (565 lines, reviewed)
- `.security/GSD-SECURITY-SYSTEM-SPEC.md` - Original specification for investigator agents (704 lines, reviewed)
- `.claude/commands/security-audit.md` - Current audit command with Phase 3.5 question handling (310 lines, reviewed)

### Secondary (MEDIUM confidence)

- `.planning/phases/04-hot-spot-verifier/04-RESEARCH.md` - Previous investigator research (314 lines, reviewed)
- `.planning/STATE.md` - Project decisions affecting this phase (79 lines, reviewed)
- `.security/HOT-SPOTS.md` - Context for security-critical areas (122 lines, reviewed)

### Tertiary (LOW confidence)

- None - all findings from codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using established patterns from Phase 4
- Architecture: HIGH - Clear investigator pattern from spec and hot-spot-verifier
- Investigation strategies: MEDIUM - Based on reasoning about question types from actual questions
- Pitfalls: MEDIUM - Based on reasoning about potential issues

**Research date:** 2026-02-05
**Valid until:** 2026-02-19 (14 days - pattern is stable)

---

## Appendix: Current Open Questions Reference

From CODEBASE-UNDERSTANDING.md (as of 2026-02-05):

| ID | Question | Priority | Status | Notes |
|----|----------|----------|--------|-------|
| Q1 | How are GitHub webhooks authenticated? | Medium | Open | Check work-sources/ for webhook handling |
| Q2 | Are there other places where user-controlled strings become file paths? | High | Partial | Checked session.ts, job-metadata.ts. Need grep broadly. |
| Q3 | What happens if Docker container name contains special characters? | Low | Open | Could cause issues in docker exec commands |
| Q4 | Could malicious agent output cause log injection in job-output.ts? | Medium | Open | Output streams to files - check for escape sequences |
| Q5 | When fleet config merges with agent config, are there unexpected overrides? | Medium | Open | Check config merging logic in loader.ts |
| Q7 | What user does the Docker container run as? Root or unprivileged? | Medium | Open | Check container-manager.ts User config |
| Q8 | Is the prompt in SDK wrapper (HERDCTL_SDK_OPTIONS) properly escaped? | Medium | Open | container-runner.ts:206-207 uses JSON.stringify + shell escaping |

Note: Q6 was answered and moved to archive.
