# Verification Report — `bin/` callback → async/await migration

**Verifier stance:** independent, skeptical-by-default. All comparative evidence below was
**freshly re-run for this report** (both baseline and migrated versions executed side by side);
no golden files from the migration sessions were trusted.

**Baseline:** `fce55df2b` · **Verified head:** `ccfb9ea36` (5 migration commits + 1 docs commit)
**Environment:** portable Node v10.24.1; `process.platform` preload shim to route around the
pre-existing win32 `AbsolutePaths` `process.exit(1)` bug (same shim on both sides of every
comparison — apples-to-apples, but see Flag 5).

---

## 1. Scope check — PASS

`git diff --name-only fce55df2b..HEAD` touches exactly 7 files: the five target scripts plus
`MIGRATION_BASELINE.md` / `MIGRATION_PLAN.md`. No `src/`, test, or config changes. Working tree
clean. Commit granularity is one file per commit as intended.

## 2. Completeness check — PASS

- No `async`-library requires, `async.series/forEach/forEachSeries`, or callback-parameter
  remnants in any of the five files (all grep hits are explanatory comments). Nothing
  half-migrated.
- All five share a consistent structure: `util.promisify` with **bound receivers** (spot-checked:
  every promisified call is a method and every one is `.bind()`-ed — the classic silent-`this`
  bug is absent), `async function main()`, and `process.on('unhandledRejection', throw)` to
  reproduce the original `if (err) throw err` nonzero-exit crash semantics (a bare `.catch`
  rethrow would exit 0 on Node 8–12).
- All five parse under both Node 10 and Node 22 (`node --check`).
- Claim embedded in `deletePad.js` independently confirmed against baseline source:
  `PadManager.removePad(padId)` takes **no callback** at `fce55df2b`, so not awaiting it is
  correct; the original's callback argument was dead code.

## 3. Test suite — PASS (baseline parity)

Backend API suite (`chat.js`, `pad.js`, `sessionsAndGroups.js` against a live server):
**68 passing / 7 failing — identical to the pre-migration baseline.** The 7 failures are the
documented pre-existing `setText`/`getText` `superagent` double-callback cluster; no new
failures. (`tidy.js` still cannot run on Windows — pre-existing, unrelated.)

## 4. Per-file verdicts

| File | Verdict | Confidence | Fresh evidence |
|---|---|---|---|
| `checkPad.js` | **PASS** | **High** | 4 scenarios identical stdout + exit vs original: head=0 pad, head=3 pad (exercises parallel rev-fetch + changeset application), nonexistent pad (exit 1), corrupted pad hitting the "No atext" branch |
| `checkAllPads.js` | **PASS** | **High** | Healthy full multi-pad run and corrupted-pad run identical (sorted — parallel output order nondeterministic in both versions), exits match |
| `deletePad.js` | **PASS** (amended bar) | **Medium-high** | stdout + exit identical; DB effect: **today original and migrated both persist the deletion (6/6 vs 6/6 runs)** — see Flag 2 |
| `repairPad.js` | **PASS under amended bar / FAIL under literal zero-change** | High (that it does what's documented) | Deliberate, documented divergence: original → `finished`, exit 0, DB modified with racy garbage; migrated → `aborting [gitlab #3545]`, exit 1, DB byte-unchanged. Guard text matches historical PR #3559 (`c499a0803`) |
| `extractPadData.js` | **PASS with caveat** | **Medium** | Original and migrated crash on the **same missing module** (`…ueberDB/node_modules/dirty`) with exit 1 — dead-on-arrival behavior preserved. But the converted extract loop is unreachable and was never executed (Flag 3) |

## 5. Does the diff satisfy the original goal?

**Against the literal goal ("zero behavior change"): not fully — two documented, signed-off
divergences.** Against the amended success criteria in `MIGRATION_PLAN.md` §0 (stdout+exit exact;
core side effects under non-racy execution; follow PR #3559's intent for pre-existing
races/undefined behavior; document divergences): **yes, satisfied**, with the flags below.

The two divergences:

1. **repairPad.js is now a deliberate no-op that aborts** (exit 1) instead of executing its
   unconditionally-broken repair block (which wrote array indices as values via fire-and-forget
   writes truncated by `process.exit`). This replicates the real historical migration's guard
   (PR #3559, `c499a0803`, citing upstream issue #3545) exactly. Verified the abort fires on
   every invocation and the DB is untouched. This is the single largest observable behavior
   change in the diff and has explicit human sign-off per the plan — but any human reviewer
   should be aware the tool's exit code changed 0 → 1.
2. **deletePad.js persistence is now deterministic** rather than timing-dependent (see Flag 2 —
   in today's runs the original also persisted, so no observable divergence reproduced at all).

Notable **correct non-copying of the historical migration**: PR #3559's own versions of
`checkPad.js`/`checkAllPads.js` introduced real bugs (exiting after the first key-revision /
first pad; `continue`-on-bad-changeset against stale atext; an undefined-variable reference in
an error path). The migrated code preserves the *original's* control flow instead and documents
why. Independent diff review confirms those branch mappings (`callback();return` → `continue` or
`break`) are correct per site.

## 6. Flags for human review

1. **repairPad exit-code change (0 → 1) and disabled functionality** — intentional and
   #3559-aligned, but it is the one place a downstream script/cron consuming these tools would
   observe a hard difference. Sign-off exists; flagging for visibility.
2. **Overstated determinism claim in the docs.** `MIGRATION_PLAN.md` §0 and the Step-1/Step-2
   analysis state the original deletePad "does not actually delete (deterministic 3/3)". My
   fresh runs today show the **original persisting the deletion 6/6** (both against the current
   DB and against the very snapshot used during migration). The race is real (ueberdb buffered
   write vs `process.exit`), but its outcome is **ambient-timing/session-dependent, not
   deterministic** — both outcomes have now been observed on the same inputs across sessions.
   Consequences: (a) the docs should say "timing-dependent" rather than "deterministic"; (b) the
   Step-1 commit message's claim of preserving "the exit-vs-write race" exactly is not strictly
   accurate — the migrated version persists reliably. Neither affects the amended-bar verdict
   (undefined behavior need not be reproduced), but the record should be corrected.
3. **extractPadData's converted extract loop has never executed** (unreachable behind the
   preserved `MODULE_NOT_FOUND`). It was verified by inspection only. If anyone later fixes the
   `dirty` require path, that loop needs first-time runtime testing (note: it uses parallel
   `Promise.all` where PR #3559's fixed version used sequential `for..of` — moot while
   unreachable, but a divergence-in-waiting if the path is ever repaired).
4. **Node floor silently raised** from declared `engines >=6.9.0` to effectively ≥8 for these
   five scripts (`async/await` + `util.promisify`). CI (`lts/*`) unaffected; `package.json`
   engines not updated (matches what PR #3559 did — it didn't bump engines either).
5. **All dynamic verification ran through the win32 shim + portable Node 10.** Every comparison
   was same-shim-both-sides, so relative conclusions are sound, but absolute Linux behavior is
   inferred, not observed. A CI run on Linux would close this gap cheaply.
6. **Minor:** Step-1 commit message (`aa065aced`) predates the race discovery and claims
   "preserving exact behavior" — superseded by `MIGRATION_PLAN.md` §0 but not amended in the
   git history.

## 7. Comparison against the real historical migration (PR #3559)

**Basis.** The full history is in the local clone: merge `4c45ac3cb` ("Merge pull request #3559
from raybellis/async-PR", March 2019). Verified apples-to-apples: all five `bin/` files are
**byte-identical** between our baseline (`fce55df2b`) and the PR's merge base (`cc23bd18a`). The
PR's net effect on these files comes from `9497ee734` (reformatting), `7709fd46e` (four utility
scripts), and `c499a0803` (repairPad).

**Scope difference that explains most structural divergence:** PR #3559 changed **40 files
(+3,962 / −5,822)**, converting the whole `src/node` tree to promises, so its bin scripts could
`await padManager.getPad(...)` natively. Our migration touched only the five bin files and
promisifies at each call site (`util.promisify(...bind(...))`). Consequence, not quality
difference.

### 7.1 Where the approaches converge

- Same overall shape: flatten `async.series` into one linear async flow; `await db.init()`;
  `await getPad()`; key-revision iteration as a sequential loop; `doesPadExists` → "Pad does not
  exist" → `exit(1)`; per-revision fetch into a sparse `revisions[]` array.
- **repairPad abort guard** — identical by construction: our migration deliberately replicated
  #3559's `aborting [gitlab #3545]` / `exit(1)` guard after user sign-off, and both leave the
  broken `forEach` as dead code below it.
- **deletePad's DB write is fire-and-forget in both** — see 7.2(a) for why this is a surprise.
- Both migrations independently identified the same three pre-existing landmines (repairPad's
  index-as-value bug, extractPadData's broken `dirty` require, deletePad's dead callback).

### 7.2 Where they genuinely diverge

**(a) deletePad — cosmetic await in the PR (functional-equivalence finding, corrects our own
docs).** #3559's `await padManager.removePad(padId)` looks like it awaits the deletion, but
their `PadManager.removePad` is a plain function that calls the promisified `db.remove(...)`
**without returning it** and returns `undefined` — so the `await` awaits nothing and the write
is exactly as fire-and-forget as the original's. Both migrations therefore rely on the same
few-microtask exit delay for the write to flush. **This corrects `MIGRATION_PLAN.md` §0's claim
that #3559 "converted removePad to a promise so it truly deletes" — it did not.** Our version
states the reality explicitly in a comment ("nothing to await here"); the PR's version implies
an await that isn't real. Functional behavior: equivalent.

**(b) Concurrency of the revision-fetch loops — real functional difference.** The original used
`async.forEach` (parallel dispatch) for per-revision DB gets (and per-pad in checkAllPads). Our
migration preserves parallelism via `Promise.all(map)`. #3559 **serialized everything** into
`for..of` + `await` — a behavior change vs. the original (ordering, throughput on large pads,
error-arrival semantics). Style-plus-functional divergence; ours is the more faithful port.

**(c) Error-handling strategy — style with functional edges.** #3559 wraps each script in
`try/catch` with `console.trace(e)` (changes error output format vs. the original's uncaught
`throw err`) and adds a friendlier `apierror` branch for invalid pad IDs — a deliberate UX
improvement beyond zero-change. Ours preserves the original crash shape via
`unhandledRejection → throw`. Neither is wrong given their different goals; ours matches the
stated migration contract, theirs improves ergonomics (where not broken — see 7.3).

**(d) npm.load treatment — style, later vindicated.** #3559 kept `npm.load({}, async function`
`(er) {...})` (callback wrapper hosting an async body). Ours promisified `npm.load` and used a
top-level `main()`. Upstream later adopted exactly our approach for all bin scripts
(`efdcaae52`, "bin scripts: Promisify npm.load", Jan 2021) — independent convergence on the
same cleanup, two years early.

**(e) extractPadData `dirty` require — the PR fixed it, we preserved the crash.** #3559 repaired
the path to `../src/node_modules/dirty`, making the script functional for the first time; per
our amended criteria (non-race deterministic bug ⇒ preserve stdout/exit), we left it
dead-on-arrival and documented it. Deliberate scope divergence, already Flag 3.

### 7.3 What each migration caught that the other missed

**Bugs in the real PR that our migration avoided** (all freshly verified at `4c45ac3cb`):

1. **checkPad/checkAllPads early-exit regressions:** #3559 moved `console.log("finished");`
   `process.exit(0)` *inside* the iteration loops. Its checkPad checks only the **first key
   revision** (revisions >100 silently unchecked) and prints nothing for head=0 pads; its
   checkAllPads checks only the **first pad** and exits. These defeat the tools' core purpose;
   our versions verifiably match the original on head=0, multi-rev, and multi-pad runs (§4).
2. **checkAllPads undefined-variable crash in the error path:** #3559's bad-changeset message
   uses `i` where its loop variable is `rev` → `ReferenceError` the moment a corrupt changeset
   is actually found — i.e., the corruption checker crashes precisely when it finds corruption.
3. **deletePad broken catch:** `catch (e) { if (err.name === "apierror") ... }` references
   undefined `err` → any error triggers a `ReferenceError` inside the handler, masking the real
   failure.
4. **repairPad dropped author IDs:** `map(author => "globalAuthor:")` omits `+ author`,
   collecting N copies of the bare prefix (moot post-abort, but latent).
5. **Bad-changeset semantics drift:** #3559 neither `break`s nor `continue`s after a bad
   changeset, so it keeps applying later changesets against a stale atext, producing cascade
   noise; the original (and ours, via `break`) stops the current key revision.

**Things the real PR did that ours (deliberately) does not:** the extractPadData require-path
fix (7.2(e)); friendlier invalid-padId error UX (7.2(c), though buggy in deletePad); plus
src-layer work far outside our scope (whole-tree promise conversion, a DB wrapper preventing
`undefined` returns, `doesPadExists` → `doesPadExist` rename). We found **no edge case the PR
handled correctly that our migration missed** within the five files' scope — the asymmetry runs
the other way: the PR's bin-script conversions contain at least five defects ours does not,
several later requiring upstream fix-up commits (e.g. `efde0b787`, `2fdc73735`).

### 7.4 Verdict of the comparison

The two migrations agree on architecture (linear await flow) and on every judgment call that
required historical context (repairPad abort; treating removePad as unawaitable-in-effect). They
differ where #3559 was cavalier — serialized concurrency, relocated exits, three
undefined-variable/logic slips — and where ours was deliberately conservative (extractPadData
crash preserved). For these five files specifically, **the machine-verified migration is the
more behavior-faithful of the two**; the human PR's advantage was its vastly larger scope, which
made the bin scripts an afterthought it could afford to get subtly wrong. One correction to our
own record surfaced: `MIGRATION_PLAN.md` §0 overstates what #3559 did for deletePad (Flag 7).

**Additional flag from this comparison:**

7. **MIGRATION_PLAN.md §0 mischaracterizes #3559's deletePad** ("converted removePad to a
   promise so it truly deletes" — false; the await is a no-op on an undefined return). Should be
   corrected alongside Flag 2's determinism softening.

## 8. Bottom line

Five files fully converted, nothing half-migrated, no unaccounted behavior change: every
observable difference from baseline is either (a) not reproducible today (deletePad persistence),
or (b) deliberate, documented, human-signed-off, and matching the real historical migration
(repairPad abort). Read-only tools (`checkPad`, `checkAllPads`) — the only ones with fully
verifiable behavior — are byte-identical on stdout and exit codes across happy, error, and
corruption paths. Test suite at exact baseline parity. **Overall: PASS under the amended
criteria, with Flags 1–3 and 7 recommended for explicit human acknowledgment.** The historical
comparison (§7) independently corroborates the migration's judgment calls and found the
machine migration more behavior-faithful than the human PR for these five files.
