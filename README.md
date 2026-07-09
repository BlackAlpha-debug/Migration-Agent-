# Autonomous Migration Agent — Case Study

An AI agent system that migrates legacy code and proves its own work is trustworthy — not just "it ran," but independently verified and checked against a real historical migration as ground truth.

## The problem

Most companies can get an AI coding agent to demo well. Very few trust one to run unsupervised on real code, because almost nobody builds the reliability layer around it — the part that catches the agent's own mistakes before a human has to. This project is a small, concrete attempt at that layer, applied to a real, bounded task: migrating legacy callback-style code to async/await.

## Architecture

Three roles, deliberately kept separate so no single step can grade its own work:

```
   PLANNER                EXECUTOR                VERIFIER
(investigates,   →    (makes the changes,   →   (fresh context,
 writes a plan)        commits incrementally)    checks independently)
```

- **Planner** — read the codebase, produced a scoped, ordered migration plan as a committed file
- **Executor** — worked through the plan step by step, running tests and committing after each change
- **Verifier** — a separate session with no memory of the executor's reasoning, graded the diff independently and ran its own tests

Full docs: [`MIGRATION_BASELINE.md`](./MIGRATION_BASELINE.md) · [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md) · [`VERIFICATION_REPORT.md`](./VERIFICATION_REPORT.md)

## The interesting part

Partway through, the agent hit a case where "preserve existing behavior exactly" turned out to be an incoherent instruction: `repairPad.js` — a script whose entire job is fixing corrupted data — had a pre-existing race condition where a fire-and-forget database write could be truncated by the process exiting. A literal byte-for-byte port would have shipped that data-corrupting bug forward, just with different garbage than before.

The decision: don't fake behavioral parity with a known bug, and don't stop and ask a human every single time this class of issue appeared. Instead, the plan's success criteria got explicitly redefined mid-project — external contract (stdout, exit codes) preserved exactly; internal side effects under a pre-existing race not required to match byte-for-byte, resolved by following [the real historical fix](https://github.com/ether/etherpad/pull/3559) where one existed, and documented as an intentional divergence where it didn't.

That redefinition, written once and applied consistently afterward, is the actual contribution of this project — not the migration itself.

## Ground truth

This migration mirrors a real merged PR: [ether/etherpad#3559](https://github.com/ether/etherpad/pull/3559), which did the same callback → async/await migration in March 2019. Rather than only trusting this project's own test suite, the verifier compared this agent's output against that real, human-reviewed migration directly. See the comparison section in `VERIFICATION_REPORT.md`.

## Results

| | Before | After |
|---|---|---|
| Tests passing | 68/75 (90.7%) | 68/75 (90.7%) — exact parity, same 7 pre-existing failures |
| Files migrated | — | 5 (`bin/*.js`) |
| Commits | — | 8 (1 baseline+plan, 5 one-per-file migration steps, 2 verification) |
| Time | — | ~29 hours wall-clock across 4 sessions (not continuous effort — see note below) |
| Model cost | — | not tracked (no token/billing access this session) |

*Time reflects calendar time between the first and last commit across separate conversational
sessions, not continuous active work — it isn't a real proxy for engineering effort or cost.
Model cost isn't included because no token/billing data was available from within the session;
anyone reproducing this should pull that from their own usage dashboard.*

## Reusable skill

The planner/executor/verifier workflow — including the framework for handling pre-existing bugs during a "zero behavior change" migration — is packaged as a standalone [Claude Skill](./migration-agent) that works on any codebase, not just this one. Drop it into your own Claude Code setup to reuse the same process.

## Limitations

This is scoped to 5 standalone CLI scripts with no existing test coverage, not a full-codebase
migration under an active test suite — the verification strategy here (golden-output diffing
against the pre-migration behavior) doesn't obviously generalize to code with real dependents.
The verifier also ran on the same model family as the planner rather than a fully independent
one, which matters: an early planning claim ("the original script's failure mode is
deterministic") went unchallenged until the verifier re-ran the comparison from scratch and found
it wasn't — a genuinely independent verifier is a check against the *executor's* mistakes, not
against a flawed premise the planner and verifier both inherited from the same model family. And
the ground-truth comparison against a real historical PR is a lucky feature of this specific
repo, not something most migrations can lean on — without it, the project would have had no way
to catch that the redefined success criteria (see "The interesting part," above) matched what
human maintainers actually shipped rather than just being a plausible-sounding rationalization.

## Attribution

The migrated code in `bin/` is derived from [Etherpad](https://github.com/ether/etherpad), licensed under Apache License 2.0 (see `LICENSE`). This repository is a derivative case study, not a fork of the full application — only the relevant `bin/` scripts and generated documentation are included here.
