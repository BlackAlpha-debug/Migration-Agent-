---
name: migration-agent
description: Use this skill whenever the user wants to autonomously migrate, refactor, or modernize a codebase using AI agents — framework upgrades, language-version bumps, callback-to-async conversions, monolith-to-service extraction, deprecated-library replacement, or any "port this code to the new way" task. Also trigger when the user wants a reliable, trustworthy agent workflow for code changes (not just a one-shot "fix this" prompt), asks about agent verification, blind/independent review of AI-written code, planner-executor-verifier patterns, or how to safely let an agent run unsupervised on a codebase. Critically, also trigger when a migration hits an ambiguous case where "preserve existing behavior exactly" turns out to be impossible or undesirable — e.g. the original code has a pre-existing bug, race condition, or undefined behavior — since this skill provides a concrete decision framework for that situation rather than defaulting to either blind escalation or blind byte-for-byte replication.
---

# Migration Agent: Autonomous Code Migration with Independent Verification

A workflow for using AI agents to migrate legacy code safely — not just "make it work," but produce a result a human can actually trust, with a paper trail proving why.

The core idea: don't use one agent to write code and grade its own work. Split the job into three roles that don't share context, so no single step can quietly mark its own homework.

## The three roles

1. **Planner** — investigates the codebase and writes a scoped, ordered migration plan as a committed file (not just chat output). Use your strongest available model here; this step benefits most from deep, coherent reasoning over a lot of context.
2. **Executor** — works through the plan step by step, one logical change at a time, running tests and committing after each step. A capable mid-tier model is normally enough here — this is standard execution against a clear spec, not novel reasoning.
3. **Verifier** — reviews the final diff in a **fresh session with no memory of the executor's reasoning**. It only sees: the stated goal, the diff, and the ability to run tests itself. Its job is to find problems, not confirm the work was fine. This independence is the entire point — skip it and you've just built an agent that grades its own test.

If a stronger/frontier-tier model is available (at the time of writing, Claude's top tier is Opus, with an even more capable Mythos-tier model — Fable 5 — for the hardest work), use it for the Planner and Verifier roles and save the cheaper model for the Executor role. That split gets you the most reliability per dollar, since planning coherence and skeptical review matter more than raw execution here.

See `references/prompt-templates.md` for ready-to-adapt prompts for all four steps below.

## The workflow

### Step 1 — Baseline
Before any code changes: get the existing test suite running, record the pass rate, and produce a concrete inventory of what needs to change (file:line references, not vague descriptions). This becomes the yardstick everything else is measured against. Do not let the agent change any code in this step — investigation only.

### Step 2 — Plan
Give the planner the baseline and a clearly stated goal. Ask it to break the work into small, independently verifiable steps (ideally one file or one logical unit per step), note the risk and verification method for each, and flag anything it's not confident about. Output this as a committed plan file — that file becomes the spec the executor works from, and later, the artifact you can show someone to explain what happened and why.

### Step 3 — Execute
Work through the plan incrementally. One step, run tests, commit if it passes, stop and report if it doesn't. Resist the urge to let it batch everything into one giant diff — small verified commits are what make the whole thing auditable later, and what let you catch a bad step before it compounds into the next ten.

### Step 4 — Verify independently
Fresh session, no shared context with the executor. Give it the goal and the diff, tell it to run tests itself rather than trust prior reports, and tell it explicitly to be skeptical by default. Have it produce a written verification report: pass/fail per area, confidence level, anything flagged for human review.

### Step 5 — Ground-truth comparison (when available)
If the codebase has a real historical example of a similar migration — a merged PR, a changelog entry, another team's past effort — have the verifier compare your agent's result against it. This turns "our own tests say it's fine" into "it holds up against what real humans actually shipped," which is a categorically stronger claim. It also surfaces disagreements worth understanding even when your version is different-but-also-correct.

## The hard part: when "zero behavior change" turns out to be incoherent

This will happen on any real, non-trivial codebase: the agent finds a spot where the original code has a bug, race condition, or undefined behavior, and "preserve existing behavior exactly" stops being a coherent instruction — because there is no single well-defined "existing behavior" to preserve.

Do not solve this by defaulting to either extreme:
- **Don't** have the agent silently replicate the bug byte-for-byte just to hit a literal "zero change" bar — you'll waste effort making broken code more precisely broken, and in the worst case (a tool whose job is correctness or safety) you'll ship a known bug forward with a false sense of parity.
- **Don't** have the agent escalate to a human on every single instance of this — it happens more than once on any real codebase, and constant escalation defeats the purpose of an autonomous agent.

Instead:
1. **Distinguish bug category from consequence.** A race that changes which garbage bytes get written is different from a race that determines whether a delete operation actually deletes, which is different again from one that could corrupt user data. Match your response to what's actually at stake, not to how the bug was introduced.
2. **Redefine success criteria explicitly, in writing, once — not case by case.** The first time this comes up, stop and update the plan file with a concrete, reusable rule (e.g. "external contract — stdout, exit codes, API responses — must match exactly; internal side effects under a pre-existing race are not required to match byte-for-byte, and should follow ground truth where available, or be explicitly documented where not"). Apply that rule going forward instead of re-litigating it on every file.
3. **Set a narrow, specific re-escalation trigger, not a blanket one.** E.g. "only come back to me if this pattern has no precedent in the ground-truth comparison to follow" — so the agent keeps moving on cases you've already effectively decided, and only interrupts you for the genuinely novel ones.
4. **Document every divergence in the commit message**, not just in a report — "diverges from a literal port; matches [ground truth] fix for a pre-existing [category] bug" is the sentence that makes this defensible later, to a reviewer, a hiring manager, or your future self.

This decision — knowing when to hold a strict line and when to deliberately bend it, and being able to explain why in one sentence — is the actual skill this workflow is designed to exercise. It's a stronger thing to be able to show someone than a large, clean migration with nothing interesting in it.

## What "done" looks like

- A baseline file, a plan file, and a verification report — all committed, all readable independently of the chat history that produced them
- Small, individually verifiable commits, not one large diff
- Every intentional divergence from "exact" behavior documented with a reason
- A verifier that ran its own checks rather than trusting the executor's self-report
