# Callback → async/await migration: `bin/` scripts (Etherpad)

An agentic migration of five legacy CLI tools in [Etherpad](https://github.com/ether/etherpad)
from `async@0.9.0`-style callback pyramids to native `async`/`await`, run as a
**planner → executor → verifier** pipeline and checked against the project's *actual* historical
migration for the same files ([PR #3559](https://github.com/ether/etherpad/pull/3559), merged
March 2019) as ground truth.

## The problem

Etherpad 1.7.0 (Jan 2019) has five standalone CLI tools in `bin/` —
`checkAllPads.js`, `checkPad.js`, `deletePad.js`, `extractPadData.js`, `repairPad.js` — written
in deeply nested `async.series`/`async.forEach`/`async.forEachSeries` callback style, with zero
test coverage (they're operator tools, not exercised by the API test suite) and, as it turned
out, real latent bugs baked into the callback plumbing. The task: convert all five to
async/await **with zero behavior change**, working from a 2019-era commit
(`fce55df2b`, "Fix typos" — the commit immediately before the real PR landed) so the outcome
could be diffed against what human maintainers actually shipped for the identical starting
point.

The environment itself was adversarial: 2019-pinned dependencies (`async@0.9.0`, a vendored
`npm@6.4.1`) don't run on a modern Node install, Windows breaks the project's own symlink-based
install step, and one of the five target files was already dead-on-arrival (`MODULE_NOT_FOUND`)
before anything was touched.

## Architecture: planner / executor / verifier

The work was split into four accountable phases, each producing a standalone artifact, with the
model tier deliberately matched to the phase:

| Phase | Artifact | Model | What it did |
|---|---|---|---|
| **Baseline** | `MIGRATION_BASELINE.md` | Sonnet 5 | Stood up the 2019 environment (portable Node 10, since system Node 22 crashes the server), ran the real test suite, inventoried every callback site by risk (trivial/moderate/risky) |
| **Plan** | `MIGRATION_PLAN.md` | Fable 5 | Independently designed the conversion strategy and a golden-output verification harness *before* touching code — deliberately without looking at PR #3559 first |
| **Execute** | 5 commits, one per file | Opus 4.8 | Applied the plan file-by-file, simplest → riskiest, running the golden-output harness after every file and stopping to escalate when reality contradicted the plan (see below) |
| **Verify** | `VERIFICATION_REPORT.md` | Fable 5 → Sonnet 5 | A *separate context* with no memory of how the migration was done — re-read the raw diff, re-ran every comparison from scratch, and issued independent pass/fail verdicts |

The planner/executor split mattered in practice, not just on paper: the plan's stated bar
("zero behavior change, preserve even existing bugs, byte-for-byte") **collided with reality**
mid-execution. Two of the five scripts turned out to have pre-existing timing races with
genuinely nondeterministic on-disk effects — there was no single "original behavior" to
preserve. That forced a human-in-the-loop decision (documented as an amendment in
`MIGRATION_PLAN.md` §0) to redefine the bar as *stdout/exit-code exact, core side effects under
non-racy execution, follow the real historical migration's intent where a pre-existing race has
no single correct answer*. The verifier, working independently afterward, caught that even this
amendment overstated one detail (see below) — which is exactly the failure mode a separate
verification pass exists to catch.

## Ground-truth comparison against PR #3559

Because the local clone carries full history, the real merge (`4c45ac3cb`) was diffable directly
— no network fetch needed. The comparison (`VERIFICATION_REPORT.md` §7) found:

- **Convergent architecture.** Both migrations independently flatten `async.series` into linear
  `await` chains and land on the same three landmines (repairPad's index-as-value bug,
  extractPadData's broken `require`, deletePad's dead callback argument).
- **One correction to our own documentation.** PR #3559's `await padManager.removePad(padId)`
  *looks* like it fixes deletePad's race — but `removePad` never returns the promise it creates
  internally, so the `await` awaits nothing. `MIGRATION_PLAN.md` had claimed the real PR "truly
  deletes" because of this await; that claim was wrong and is flagged for correction.
- **Five defects in the real PR that this migration avoided**, all independently verified against
  the merge commit: both `check*` tools in PR #3559 exit after processing only the *first* pad /
  key-revision (a control-flow relocation bug that silently defeats the tools); `checkAllPads`
  references an undefined loop variable in its own corruption-report message (crashes exactly
  when it finds corruption); `deletePad`'s `catch` block references an undefined `err`
  (masks real errors); `repairPad`'s author-ID collection drops the actual IDs. Several of these
  needed upstream fix-up commits over the following two years.
- **One place we deliberately diverged from the real PR:** PR #3559 also serialized the original
  script's *parallel* revision-fetch loops into sequential `for` loops — a behavior change from
  the original this migration did not replicate, preserving the original's concurrent dispatch
  via `Promise.all` instead.

For this narrow slice, the machine-executed migration was measurably more behavior-faithful than
the human one — the real PR's 40-file scope treated these five CLI tools as an afterthought it
could afford to get subtly wrong.

## Before / after

| | Before | After |
|---|---|---|
| Control flow | `async@0.9.0` callback pyramids, up to 5 levels deep | Native `async`/`await`, `util.promisify` with bound receivers |
| Callback sites inventoried | 28 across 5 files (21 trivial / 3 moderate / 4 risky) | 0 remaining (confirmed by grep in the verification pass) |
| Direct test coverage of `bin/` | None (unchanged — these are untested CLI tools either way) | None |
| Backend API suite (proxy regression gate) | 68 passing / 7 failing (pre-existing flaky cluster) | **68 passing / 7 failing — exact parity**, same failures |
| `repairPad.js` | Executes an unconditionally broken write loop (writes array indices as "data", corrupts DB) | Deliberately aborts before the broken block (matches PR #3559's fix), documented and signed off |
| `extractPadData.js` | `MODULE_NOT_FOUND` crash, dead on arrival | Same crash, same exit code — preserved intentionally (non-race bug, out of scope) |
| `deletePad.js` | Prints success; DB write is buffered and races `process.exit()` | Same messaging; write timing behavior is session/timing-dependent in *both* versions (see honest paragraph below) |
| Pre-existing bugs found | — | 3 flagged as out-of-scope (not fixed): `checkAllPads`' missing `return` after an error callback, `repairPad`'s broken restore logic, `extractPadData`'s dead require path |

## Cost and time

I don't have access to token counts or dollar billing for this session, so I won't invent
numbers — anyone reproducing this should pull those from their own usage dashboard. What's
verifiable from the repository itself: **8 commits** spanning **~29 hours of wall-clock time**
(first commit `2026-07-08 02:39`, last `2026-07-09 07:18`) across **4 conversational sessions**,
with the model tier switched deliberately per phase (Sonnet for investigation, Fable for
planning/verification, Opus for the actual code execution). Wall-clock time here reflects gaps
between separate sessions, not continuous engineering effort — it isn't a meaningful proxy for
actual compute cost.

## What didn't go perfectly

The plan's initial "zero behavior change" bar was too strict for the codebase it met, and I
didn't catch that until execution was already in progress — the plan (written in a *separate*
session, without running the destructive scripts against real data) assumed deletePad's failure
to delete was deterministic, when in fact it depends on ambient timing and turned out, on the
verifier's independent re-runs, to go the *other* way just as often. That imprecision then
propagated into a commit message ("preserving the exact... race") that overstated what had
actually been verified, and into a plan-document claim about what PR #3559 did for deletePad
that was flatly wrong (the real PR's `await` doesn't actually await anything — I didn't check
that closely enough when writing the amendment under time pressure mid-execution). Both errors
were only caught because the verification phase was run as a genuinely independent pass — a
different context, told to distrust the artifacts it was handed and re-derive everything from
the diff and fresh test runs — rather than the executor grading its own work. If I were doing
this again, I'd push harder to characterize the racy scripts' *actual* nondeterminism (e.g., a
tight loop of N runs measuring the split) during planning, before writing down words like
"deterministic," and I'd have the verifier check documentation claims about third-party ground
truth (the PR) with the same skepticism it applied to the migration's own diff, rather than
treating those as settled background fact.

---

*Supporting documents: [`MIGRATION_BASELINE.md`](MIGRATION_BASELINE.md) (environment setup,
test baseline, callback inventory) · [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) (conversion
strategy, verification harness, the mid-execution bar amendment) ·
[`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md) (independent audit, per-file verdicts,
PR #3559 comparison). All work is local commits on branch `bin-async-migration`; nothing in
this project has been pushed to any remote.*
