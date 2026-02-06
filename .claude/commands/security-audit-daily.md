---
name: security-audit-daily
description: Automated daily security audit with branch isolation and executive summary
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Edit
  - Task
  - Skill
---

<objective>
Meta-orchestrator for fully automated daily security audits with branch isolation.

This command wraps the full security audit workflow with:
1. **Branch management** - Commits to `security-audits` branch, keeping main clean
2. **Full audit execution** - Invokes `/security-audit` with all its subagents
3. **Self-review** - Invokes `/security-audit-review` to assess and improve
4. **Executive summary** - GREEN/YELLOW/RED status for quick triage
5. **Unattended execution** - No user prompts or manual steps required

**Intended use:** Scheduled daily execution via herdctl or cron.
</objective>

<context>
**Branch strategy:**
- Daily audits commit to `security-audits` branch
- Main branch stays clean from automated commits
- Branch rebases on main before each audit to stay current
- Use `--force-with-lease` for safe push after rebase

**Execution model:**
- This is a meta-orchestrator that invokes other commands
- `/security-audit` handles all deep analysis via its own subagents
- `/security-audit-review` handles quality assessment and improvements
- This orchestrator stays on security-audits branch throughout
- All file writes happen on the correct branch automatically

**Key outputs:**
- `.security/scans/YYYY-MM-DD.json` - Scanner output (from /security-audit)
- `.security/intel/YYYY-MM-DD.md` - Intelligence report (from /security-audit)
- `.security/reviews/YYYY-MM-DD.md` - Self-review (from /security-audit-review)
- `.security/summaries/YYYY-MM-DD.md` - Executive summary (this command)
- `.security/STATE.md` - Audit baseline tracking (updated by both)
</context>

<process>

<step name="phase_0_preflight">
## Phase 0: Pre-flight Checks

Verify clean working state before audit execution.

**Check for uncommitted changes:**
```bash
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "ERROR: Uncommitted changes detected"
  git status --short
  echo ""
  echo "Please commit or stash changes before running daily audit."
  echo "The audit will commit to the security-audits branch."
  exit 1
fi
echo "Working tree clean"
```

**Save original branch:**
```bash
ORIGINAL_BRANCH=$(git branch --show-current)
echo "Original branch: $ORIGINAL_BRANCH"
```

Store `$ORIGINAL_BRANCH` for restoration in Phase 5.

**Set today's date:**
```bash
TODAY=$(date +%Y-%m-%d)
echo "Audit date: $TODAY"
```

**Pre-flight complete:** Working tree clean, original branch saved.
</step>

<step name="phase_1_branch_setup">
## Phase 1: Branch Setup

Switch to security-audits branch for all audit work.

**Create or switch to security-audits branch:**
```bash
# Create branch if it doesn't exist, or switch to it
git checkout -B security-audits
echo "On branch: $(git branch --show-current)"
```

**Rebase on main to stay current:**
```bash
# Quiet rebase, handle conflicts gracefully
if git rebase main --quiet 2>/dev/null; then
  echo "Rebased on main successfully"
else
  echo "WARN: Rebase had conflicts, continuing on current state"
  git rebase --abort 2>/dev/null || true
fi
```

**Branch setup complete:** Now on security-audits branch, rebased on main.
</step>

<step name="phase_2_run_security_audit">
## Phase 2: Run Full Security Audit

Invoke the `/security-audit` command which handles all deep analysis.

**Use the Skill tool to invoke /security-audit:**

The `/security-audit` command will:
1. Run the security scanner (scan.ts)
2. Spawn change-analyzer to categorize commits since last audit
3. Conditionally spawn hot-spot-verifier if critical files changed
4. Conditionally spawn question-investigator if high-priority questions exist
5. Aggregate all results
6. Write intelligence report to `.security/intel/{TODAY}.md`
7. Update FINDINGS-INDEX.md, CODEBASE-UNDERSTANDING.md, STATE.md
8. Commit changes (if commit_docs=true in config)

**Capture the audit result:**
After /security-audit completes, extract key metrics from its output:
- Overall result: PASS / WARN / FAIL
- Scanner findings count
- Commits analyzed
- Hot spots verified (count)
- Questions investigated (count)
- Any new findings

Store these for the executive summary in Phase 4.

**Wait for audit completion before proceeding.**
</step>

<step name="phase_3_run_security_review">
## Phase 3: Run Security Audit Review

Invoke the `/security-audit-review` command to assess audit quality and apply improvements.

**Use the Skill tool to invoke /security-audit-review:**

The `/security-audit-review` command will:
1. Read the intelligence report just created
2. Assess coverage against HOT-SPOTS.md (were all hot spots checked?)
3. Assess progress on open questions
4. Evaluate investigation depth
5. Identify gaps and missed opportunities
6. Write review to `.security/reviews/{TODAY}.md`
7. Apply confident improvements:
   - Update HOT-SPOTS.md if new critical areas found
   - Add new questions to CODEBASE-UNDERSTANDING.md
   - Propose updates to /security-audit.md if needed

**Capture the review result:**
After /security-audit-review completes, extract:
- Overall grade: A / B / C / D
- Coverage rating
- Depth rating
- Gaps identified (count)
- Improvements applied (count)

Store these for the executive summary.

**This is the self-improvement loop:** The review can modify the audit command itself, making future audits better.
</step>

<step name="phase_4_executive_summary">
## Phase 4: Generate Executive Summary

Create a summary at `.security/summaries/{TODAY}.md` for quick triage.

**Read results from the audit and review:**
```bash
# Get audit result from today's intel report
AUDIT_RESULT=$(grep "Overall Result" .security/intel/${TODAY}.md 2>/dev/null | head -1 | awk -F': ' '{print $2}' || echo "UNKNOWN")

# Get review grade from today's review
REVIEW_GRADE=$(grep "Overall Grade" .security/reviews/${TODAY}.md 2>/dev/null | head -1 | awk -F': ' '{print $2}' || echo "UNKNOWN")

# Get scanner findings count
SCANNER_FINDINGS=$(grep -A5 "Scanner Results" .security/intel/${TODAY}.md 2>/dev/null | grep -oE "[0-9]+ findings" | head -1 || echo "0 findings")

# Get commits analyzed
COMMITS_ANALYZED=$(grep "Commits" .security/intel/${TODAY}.md 2>/dev/null | head -1 | grep -oE "[0-9]+" | head -1 || echo "0")

# Get open findings count from STATE.md
OPEN_FINDINGS=$(grep "^open_findings:" .security/STATE.md 2>/dev/null | awk '{print $2}' || echo "0")

# Get open questions count from STATE.md
OPEN_QUESTIONS=$(grep "^open_questions:" .security/STATE.md 2>/dev/null | awk '{print $2}' || echo "0")
```

**Determine status color:**
```
GREEN: PASS result, grade B or better, no new Critical/High findings
YELLOW: WARN result, or grade C, or new Medium findings
RED: FAIL result, or grade D, or new Critical/High findings
```

**Write executive summary:**

Create `.security/summaries/{TODAY}.md`:

```markdown
# Security Daily Summary - {TODAY}

## Status: {GREEN | YELLOW | RED}

---

## Quick Stats

| Metric | Value |
|--------|-------|
| Audit Result | {PASS | WARN | FAIL} |
| Review Grade | {A | B | C | D} |
| Open Findings | {count} |
| Open Questions | {count} |
| Commits Analyzed | {count} |
| Scanner Findings | {count} |

---

## Executive Summary

{2-3 sentence summary based on results}

---

## Action Items

### Immediate (Today)
{If RED: List urgent items from audit/review}
{If YELLOW: List recommended reviews}
{If GREEN: "No immediate action required"}

### This Week
{Medium priority follow-ups from review recommendations}

---

## Audit Details

- **Intelligence Report**: `.security/intel/{TODAY}.md`
- **Review Report**: `.security/reviews/{TODAY}.md`
- **Scan Data**: `.security/scans/{TODAY}.json`

---

## Self-Improvement Applied

{List any changes made by /security-audit-review:}
- HOT-SPOTS.md: {changes or "No changes"}
- CODEBASE-UNDERSTANDING.md: {changes or "No changes"}
- security-audit.md: {changes or "No changes"}

---

*Generated by /security-audit-daily on {TODAY}*
```
</step>

<step name="phase_5_commit_push">
## Phase 5: Commit and Push

Stage and commit all security artifacts to security-audits branch.

**Note:** The /security-audit command may have already committed some files. Stage any remaining changes.

**Stage any uncommitted security files:**
```bash
git add .security/summaries/${TODAY}.md
git add .security/reviews/${TODAY}.md
git add .security/intel/${TODAY}.md
git add .security/intel/FINDINGS-INDEX.md
git add .security/scans/${TODAY}.json
git add .security/STATE.md
git add .security/CODEBASE-UNDERSTANDING.md
git add .security/HOT-SPOTS.md
git add .claude/commands/security-audit.md

# Check what's staged
STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then
  echo "No new changes to commit (audit commands already committed)"
else
  echo "Files to commit:"
  echo "$STAGED"
fi
```

**Create status-rich commit (if there are changes):**
```bash
if [ -n "$STAGED" ]; then
  git commit -m "security: daily audit ${TODAY}

Status: ${STATUS}
Audit Result: ${AUDIT_RESULT}
Review Grade: ${REVIEW_GRADE}
Open Findings: ${OPEN_FINDINGS}
Open Questions: ${OPEN_QUESTIONS}

Summary: ${STATUS} - Full audit with review completed
Generated by /security-audit-daily

Co-Authored-By: Claude <noreply@anthropic.com>
"
fi
```

**Push to remote:**
```bash
# Use --force-with-lease for safety after rebase
git push -u origin security-audits --force-with-lease
echo "Pushed to origin/security-audits"
```

**Handle push failures gracefully:**
If push fails, log warning but don't fail the workflow. Changes are committed locally.
</step>

<step name="phase_6_restore_branch">
## Phase 6: Restore Original Branch

Return to the branch we started on.

**Always restore, even on failure:**
```bash
git checkout "$ORIGINAL_BRANCH" --quiet
echo "Returned to branch: $ORIGINAL_BRANCH"
```

**Final status report:**
```
==========================================
  DAILY SECURITY AUDIT COMPLETE
==========================================

Status:        {GREEN | YELLOW | RED}
Audit Result:  {PASS | WARN | FAIL}
Review Grade:  {A | B | C | D}
Open Findings: {count}
Open Questions: {count}

Artifacts on security-audits branch:
  - .security/intel/{TODAY}.md
  - .security/reviews/{TODAY}.md
  - .security/summaries/{TODAY}.md
  - .security/scans/{TODAY}.json

Self-Improvement:
  - {List any files updated by review}

Current branch: {ORIGINAL_BRANCH}
==========================================
```
</step>

</process>

<edge_cases>

### Uncommitted Changes
If `git diff-index --quiet HEAD --` fails (uncommitted changes exist):
- Print clear error message with `git status --short`
- Exit immediately without modifying anything
- User must commit or stash before running daily audit

### First Run (No security-audits branch)
`git checkout -B security-audits` handles this automatically:
- Creates branch if doesn't exist
- Switches to it if it does exist
- No special handling needed

### Rebase Conflicts
If `git rebase main` has conflicts:
- Abort the rebase with `git rebase --abort`
- Log warning: "Rebase had conflicts, continuing on current state"
- Continue with audit on current branch state
- User can manually rebase later

### /security-audit Fails
If the audit command fails or times out:
- Capture whatever output is available
- Set AUDIT_RESULT="ERROR"
- Still run /security-audit-review if possible (review can identify issues)
- Include error in executive summary
- Don't fail the entire workflow

### /security-audit-review Fails
If the review command fails:
- Set REVIEW_GRADE="ERROR"
- Still write executive summary based on audit results
- Note review failure in summary
- Continue to commit/push phase

### Push Fails
If `git push --force-with-lease` fails:
- Log warning with the error
- Note that changes are committed locally
- Provide manual push command
- Don't fail the entire workflow

### No Changes Since Last Audit
If /security-audit reports no commits since last audit:
- Audit still runs (scanner check)
- Review still runs (verify hot spots periodically)
- Summary notes "No changes since last audit"
- This is normal for a daily audit

</edge_cases>

<success_criteria>
Checklist for complete daily audit:

**Pre-flight (Phase 0)**
- [ ] Working tree is clean
- [ ] Original branch saved

**Branch Setup (Phase 1)**
- [ ] On security-audits branch
- [ ] Rebased on main (or graceful fallback)

**Security Audit (Phase 2)**
- [ ] /security-audit invoked via Skill tool
- [ ] Audit completed (PASS/WARN/FAIL)
- [ ] Intelligence report written
- [ ] STATE.md updated

**Security Review (Phase 3)**
- [ ] /security-audit-review invoked via Skill tool
- [ ] Review completed (grade assigned)
- [ ] Review report written
- [ ] Improvements applied (if any)

**Executive Summary (Phase 4)**
- [ ] Status determined (GREEN/YELLOW/RED)
- [ ] Summary written to .security/summaries/{TODAY}.md

**Commit/Push (Phase 5)**
- [ ] All security artifacts staged
- [ ] Commit message includes status and grade
- [ ] Pushed to origin/security-audits

**Restore (Phase 6)**
- [ ] Returned to original branch
- [ ] Final status printed
</success_criteria>

<unattended_execution>
This command is designed for unattended daily execution.

**No user prompts:**
- All decisions are automated based on data
- Edge cases are handled gracefully
- Failures are logged but don't block completion

**The self-improvement loop:**
1. `/security-audit` does deep analysis with subagents
2. `/security-audit-review` evaluates the audit quality
3. Review applies improvements to HOT-SPOTS.md, CODEBASE-UNDERSTANDING.md
4. Review can even update /security-audit.md to improve future audits
5. Next daily run uses the improved configuration

**Scheduling example (herdctl):**
```yaml
agents:
  security-auditor:
    schedule:
      cron: "0 6 * * *"  # 6 AM daily
    prompt: "/security-audit-daily"
    timeout: 900  # 15 minutes max (audit + review)
```

**Scheduling example (cron):**
```bash
0 6 * * * cd /path/to/herdctl && claude -p "/security-audit-daily" >> /var/log/security-audit.log 2>&1
```

**Output handling:**
- Summary is written to files, not just stdout
- Final status report is printed for logging
- Non-zero exit only on pre-flight failure (uncommitted changes)
</unattended_execution>
