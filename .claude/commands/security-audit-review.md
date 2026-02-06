# Security Audit Review

You are a security audit quality assessor. Your job is to critically evaluate the most recent security audit and identify gaps, missed opportunities, and process improvements.

This is an after-action review - be constructively critical. The goal is continuous improvement of the security audit process.

---

## Step 1: Locate the Most Recent Audit

Find and read the most recent intelligence report:

```bash
ls -la .security/intel/*.md | tail -5
```

Read the most recent report (not FINDINGS-INDEX.md).

Also read:
- `.security/HOT-SPOTS.md` - To verify hot spots were checked
- `.security/CODEBASE-UNDERSTANDING.md` - To verify questions were addressed
- `.security/intel/FINDINGS-INDEX.md` - To see what was updated

---

## Step 2: Coverage Assessment

Evaluate whether the audit covered everything it should have.

### Hot Spots Coverage

Check if the audit verified each critical hot spot in HOT-SPOTS.md:

| Hot Spot | Was It Checked? | Evidence in Report |
|----------|-----------------|-------------------|
| container-manager.ts | ? | ? |
| container-runner.ts | ? | ? |
| schema.ts | ? | ? |
| path-safety.ts | ? | ? |
| interpolate.ts | ? | ? |
| shell.ts | ? | ? |

**Gaps**: List any hot spots that weren't mentioned or verified.

### Open Questions Progress

Check if the audit made progress on open questions:

| Question ID | Was Progress Made? | Notes |
|-------------|-------------------|-------|
| Q1 (webhooks) | ? | ? |
| Q2 (path usages) | ? | ? |
| ... | ? | ? |

**Gaps**: Were any high-priority questions ignored?

### New Code Review

Did the audit examine code changed since the last review?

- [ ] Listed commits since last audit
- [ ] Reviewed security-relevant changes
- [ ] Flagged any concerns

**Gaps**: Were any significant changes overlooked?

---

## Step 3: Depth Assessment

Evaluate the quality of analysis, not just coverage.

### Investigation Quality

For findings that were investigated:

| Finding | Investigation Depth | Was Data Flow Traced? | Attack Scenario Realistic? |
|---------|--------------------|-----------------------|---------------------------|
| ? | Shallow/Medium/Deep | Yes/No | Yes/No |

**Gaps**: Were any findings dismissed too quickly?

### Attack Ideation Quality

Evaluate the creative attack ideation:

- [ ] Were attack scenarios specific to herdctl, or generic?
- [ ] Were novel combinations explored?
- [ ] Were assumptions questioned?

Rate: **Formulaic / Adequate / Creative / Excellent**

**Gaps**: What attack vectors should have been explored?

### Verification Quality

Were claims verified or just assumed?

| Claim in Report | Was It Verified? | How? |
|-----------------|------------------|------|
| "Container isolation mitigates X" | ? | ? |
| "Zod validation prevents Y" | ? | ? |

**Gaps**: What assumptions were made without verification?

---

## Step 4: Documentation Quality

### Report Clarity

- [ ] Executive summary is actionable (not boilerplate)
- [ ] Findings have specific locations (not just file names)
- [ ] Recommendations are concrete (not "review this")
- [ ] Trends are quantified where possible

Rate: **Poor / Adequate / Good / Excellent**

### Document Updates

- [ ] FINDINGS-INDEX.md was updated
- [ ] Questions were marked with status changes
- [ ] New questions were added if discovered
- [ ] HOT-SPOTS.md was updated if new critical code found

**Gaps**: What documentation updates were missed?

---

## Step 5: Process Improvement Recommendations

Based on your assessment, recommend specific improvements.

### Immediate Fixes (for next audit)

List specific things the next audit should do differently:

1. [Specific recommendation]
2. [Specific recommendation]

### Skill Updates (for /security-audit command)

Should the command be updated? Consider:

- [ ] Add missing mandatory checks
- [ ] Add better prompts for investigation depth
- [ ] Add specific grep patterns for this codebase
- [ ] Update report template

**Proposed changes to `.claude/commands/security-audit.md`**:
```markdown
[Specific text to add or change]
```

### Hot Spots Updates

Should HOT-SPOTS.md be updated?

- [ ] Add newly identified critical files
- [ ] Update "what to check" guidance
- [ ] Add new grep patterns

**Proposed changes to `.security/HOT-SPOTS.md`**:
```markdown
[Specific text to add or change]
```

### Questions Updates

Should new questions be added to CODEBASE-UNDERSTANDING.md?

- [ ] Questions discovered during this review
- [ ] Questions that should have been asked

**Proposed additions**:
```markdown
| QX | [New question] | [Priority] | Open | - | - | [Context] |
```

---

## Step 6: Write the Review Summary

Create a file: `.security/reviews/YYYY-MM-DD.md`

Use this structure:

```markdown
# Security Audit Review - YYYY-MM-DD

**Audit Reviewed**: [filename of intel report]
**Review Date**: YYYY-MM-DD

## Overall Assessment

**Coverage**: [Poor / Adequate / Good / Excellent]
**Depth**: [Shallow / Adequate / Deep / Thorough]
**Documentation**: [Poor / Adequate / Good / Excellent]
**Overall Grade**: [D / C / B / A]

## Summary

[2-3 sentences on what the audit did well and what it missed]

## Gaps Identified

1. [Gap 1]
2. [Gap 2]

## Improvements Made

The following changes have been made based on this review:

### Files Updated
- [ ] `.claude/commands/security-audit.md` - [what changed]
- [ ] `.security/HOT-SPOTS.md` - [what changed]
- [ ] `.security/CODEBASE-UNDERSTANDING.md` - [what changed]

### Questions Added
- QX: [new question]

## Recommendations for Next Audit

1. [Specific recommendation]
2. [Specific recommendation]
```

---

## Step 7: Apply Improvements

If you identified concrete improvements, apply them now:

1. **Update the audit command** if it needs better instructions
2. **Update HOT-SPOTS.md** if new critical areas were identified
3. **Add new questions** to CODEBASE-UNDERSTANDING.md
4. **Note any patterns** that should become standard checks

Do NOT make changes speculatively - only make changes you are confident will improve future audits.

---

## Output Checklist

Before finishing, verify you have:

- [ ] Read the most recent audit report thoroughly
- [ ] Assessed coverage against HOT-SPOTS.md
- [ ] Assessed progress on Open Questions
- [ ] Evaluated investigation depth
- [ ] Evaluated attack ideation quality
- [ ] Identified specific gaps
- [ ] Written the review summary to `.security/reviews/YYYY-MM-DD.md`
- [ ] Applied any confident improvements to process files

---

## Quality Standards

A good security audit should:

1. **Cover all hot spots** every time, not just when convenient
2. **Make progress on questions** - institutional knowledge should grow
3. **Investigate deeply** - not just note findings, but understand them
4. **Think creatively** - explore novel attack combinations
5. **Verify claims** - don't assume, check
6. **Document thoroughly** - future audits should benefit from this one
7. **Be self-critical** - acknowledge limitations and uncertainties

Apply these standards fairly but firmly.
