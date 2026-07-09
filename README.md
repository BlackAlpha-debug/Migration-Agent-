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
| Tests passing | `[FILL IN]` | `[FILL IN]` |
| Files migrated | — | 5 (`bin/*.js`) |
| Commits | — | `[FILL IN]` |
| Time | — | `[FILL IN]` |
| Model cost | — | `[FILL IN]` |

## Reusable skill

The planner/executor/verifier workflow — including the framework for handling pre-existing bugs during a "zero behavior change" migration — is packaged as a standalone [Claude Skill](./migration-agent) that works on any codebase, not just this one. Drop it into your own Claude Code setup to reuse the same process.

## Limitations

`[FILL IN — one honest paragraph. E.g.: scoped to 5 files, not a full-codebase migration. Verifier ran on the same model family as the planner rather than a fully independent model. Ground-truth comparison only exists because this repo happened to have a prior human migration to compare against — most migrations won't have that.]`

## Attribution

The migrated code in `bin/` is derived from [Etherpad](https://github.com/ether/etherpad), licensed under Apache License 2.0 (see `LICENSE`). This repository is a derivative case study, not a fork of the full application — only the relevant `bin/` scripts and generated documentation are included here.
