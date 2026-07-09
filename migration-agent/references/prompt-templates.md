# Prompt Templates

Fill in the bracketed `[...]` placeholders for your actual repo and goal. Use with Claude Code (or any coding agent that can run commands and edit files).

---

## Step 1 — Baseline
```
I'm setting up a baseline before an automated migration project. In this repo,
focus on: [scope — e.g. a specific directory, module, or file list].

1. Install dependencies and get the existing test suite running.
2. Run the full test suite (or whatever checks exist) and report the pass rate.
3. Produce an inventory of every instance of [the legacy pattern you're
   migrating away from], with file:line references, grouped by rough
   complexity (trivial / moderate / risky).
4. Do NOT modify any code yet — this is investigation only.

Output a MIGRATION_BASELINE.md file with the test results and the inventory.
```

## Step 2 — Plan
*(Use your strongest available model for this step.)*
```
You have access to MIGRATION_BASELINE.md from the previous session.
Your job right now is to plan, not execute.

Goal: [state the migration goal precisely — what changes, what must not
change, e.g. "migrate X to Y with zero change to external behavior"].

Please:
1. Investigate the codebase's actual patterns and conventions — don't assume
   a generic approach.
2. Break the migration into an ordered list of discrete, independently
   testable steps (one logical change per step).
3. For each step, note: files touched, risk level, what could break, and how
   to verify it worked.
4. Flag anything you're not confident about, or that needs a human decision
   before proceeding.
5. Write this out as a committed file, MIGRATION_PLAN.md — not just a chat
   response. This becomes the spec the execution phase works from.

Do not make any code changes in this session.
```

## Step 3 — Execute
```
Execute MIGRATION_PLAN.md step by step, in order. For each step:
1. Make only the change described in that step — nothing broader.
2. Run the relevant tests immediately after.
3. If tests pass, commit with a clear message referencing the step number.
4. If tests fail — or you hit a case where the plan's success criteria don't
   cleanly apply (e.g. the original code has a pre-existing bug or race) —
   stop, report exactly what you found, and don't proceed until confirmed.
5. After all steps are done, run the full test suite once more and report
   the final pass rate compared to MIGRATION_BASELINE.md.

Work through this incrementally — small verified commits, not one giant diff.
```

## Step 4 — Verify (fresh session — do not continue the execution session)
```
You are acting as an independent verifier. You have not seen how this
migration was performed — only the result. Do not assume the intent was
correct; check it.

Original goal: [paste the one-paragraph goal from MIGRATION_PLAN.md's
intro — not the whole plan, so you're not seeing its self-assessment].

Please:
1. Review the full diff between the baseline and the final state.
2. Run the test suite yourself and report the actual results — don't trust
   any prior report.
3. Independently assess: does the diff fully satisfy the stated goal? Is
   there any behavior change tests didn't catch? Is anything partially done?
4. Produce VERIFICATION_REPORT.md with: pass/fail per major area, your
   confidence level, and an explicit list of anything you'd flag for human
   review before merging.

Be skeptical by default — your job is to find problems, not confirm the work
was fine.
```

## Step 5 — Ground-truth comparison (when a real precedent exists)
```
A real historical example of this same kind of migration exists: [link to
the PR, commit, or changelog entry]. Compare your migration's diff against
it. Note:
1. Where the two approaches converge (same pattern, same structure).
2. Where they genuinely diverge, and whether it's a style choice or an
   actual functional difference.
3. Whether the reference version caught anything (edge cases, error
   handling) that this migration missed, or vice versa.

Add this comparison as a section in VERIFICATION_REPORT.md.
```

## When "preserve exact behavior" turns out to be incoherent
Use this once, the first time the agent hits a pre-existing bug/race/undefined-behavior case — not per-instance:
```
Update MIGRATION_PLAN.md's success criteria section right now, before
continuing, to formally redefine what "preserve behavior" means for this
project. Suggested framing — adapt to your actual stakes:

  "[External contract — e.g. output, exit codes, API responses] must be
  preserved exactly. Internal side effects are preserved under normal
  (non-buggy/non-racy) execution. Where the original code has a
  pre-existing bug, race, or undefined-behavior condition, the migration
  is not required to reproduce that exact broken behavior — it should
  follow [ground truth, if available] where one exists, and be explicitly
  documented as an intentional divergence where it doesn't."

Apply this bar going forward without re-asking me for each new instance.
Only escalate to me if a case has no precedent to follow and carries real
stakes (e.g. data loss/corruption, not cosmetic output differences).
```

## Wrap-up — writeup
```
Using MIGRATION_BASELINE.md, MIGRATION_PLAN.md, and VERIFICATION_REPORT.md,
write a README.md summarizing this project: the problem, the architecture
(planner / executor / verifier split), the ground-truth comparison if one
was done, before/after metrics, and one honest paragraph about what didn't
go perfectly and what you'd change. Lead with the most interesting judgment
call made during the migration, not the architecture — that's the part
worth reading.
```
