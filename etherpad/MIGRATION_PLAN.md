# Migration Plan — `bin/` callback → async/await

**Scope:** `bin/deletePad.js`, `bin/repairPad.js`, `bin/extractPadData.js`, `bin/checkPad.js`, `bin/checkAllPads.js` (listed in migration order — simplest first).
**Base commit:** `fce55df2b7229cb61e5a0aeb7e07230f566f24c5` (see `MIGRATION_BASELINE.md` for the pre-migration test results and callback inventory).
**Goal:** convert callback-style control flow to async/await.
**Planned independently** of the historical PR #3559; comparison against it happens only after execution.

---

## 0. Success criteria — definition of "zero behavior change" (amended during execution)

> **Amendment note (2026-07-09, during Step 2):** the original bar was "preserve all
> behavior including existing bugs, byte-for-byte." Execution showed two of the five
> scripts (`deletePad.js`, `repairPad.js`) contain **pre-existing timing races** whose
> on-disk effect is undefined/nondeterministic, and that the real historical migration
> (PR #3559) did **not** preserve those effects — it *fixed* deletePad (awaited the
> write so it actually deletes) and *disabled* repairPad (aborted before the
> data-corrupting block). Literal byte-identical preservation would mean shipping a
> deletePad that doesn't delete and a repairPad that corrupts data — which no sane
> migration, including the real one, did. The bar is therefore formally redefined as:

**"zero behavior change" means, for this project:**

- **stdout output and exit codes preserved exactly.**
- **Core side effects preserved under normal (non-racy) execution.**
- **Where the original code has a pre-existing race or undefined-behavior condition,
  the migration is not required to reproduce that undefined behavior byte-for-byte** —
  it should **match the intent and structure of the real historical migration
  (PR #3559)** where that ground truth exists, and be **explicitly documented as a
  divergence** where it doesn't.

**Process rule for the remaining files** (`checkPad.js`, `checkAllPads.js`,
`extractPadData.js`): if one hits a similar pre-existing race, check PR #3559 for that
file first and follow its approach if it addressed the same issue, documenting the
divergence. Only escalate to a human if the race has no precedent in PR #3559 to follow.
(Note: `checkPad`/`checkAllPads` are read-only and `extractPadData` uses an awaited
`dirty.set` callback + is dead-on-arrival, so none of the three is expected to hit this.)

### Per-file resolution of the race (ground truth from PR #3559, merge `4c45ac3cb`)

- **deletePad.js** — original prints "Finished deleting" but the buffered `db.remove`
  never flushes before `process.exit()`, so it **does not actually delete** (deterministic
  3/3 in testing). PR #3559 (`7709fd46e`) did `await padManager.removePad(padId)`,
  converting removePad to a promise so it truly deletes. Our migration reaches the same
  *observable* outcome (the pad is deleted, deterministic 3/3). Documented divergence from
  the broken original; matches #3559 intent.
- **repairPad.js** — the `neededDBValues.forEach(function(key, value){...})` block is
  unconditionally broken (`value` is the array index, not data) and writes racy garbage.
  PR #3559 (`c499a0803`) inserted an **unconditional** `console.info("aborting [gitlab #3545]");
  process.exit(1);` guard *before* the block, disabling it. We replicate that exact guard.
  It aborts on every invocation because the bug is unconditional — there is no non-broken
  call path being sacrificed.

---

## 1. Codebase conventions (investigated at this commit)

- **There is no native async/await anywhere in `src/node`.** Every `async` reference is the `async@0.9.0` library (`async.series`, `async.forEach`, `async.forEachSeries`, `async.waterfall`) plus the `ERR()` helper from `async-stacktrace`. These five scripts will be the first async/await in the repo, so there is no in-repo promise convention to follow — the conversion should lean on Node core (`util.promisify`) and add **no new dependencies**.
- All five scripts share one skeleton: top-level `async.series([...steps])` → each step does one thing (`npm.load`, lazy `require`s, `db.init`, pad fetch, work loop) → a final `function (err) { if (err) throw err; else { console.log("finished"); process.exit(0); } }` handler.
- Callback signatures of every API the scripts touch (verified in source):
  - `npm.load(opts, cb(err))`
  - `db.init(cb)` (`src/node/db/DB.js:38`)
  - `padManager.getPad(id, cb(err, pad))` (`src/node/db/PadManager.js:122`)
  - `padManager.listAllPads(cb(err, {padIDs}))` (`PadManager.js:178`)
  - `padManager.doesPadExists(padId, cb(err, exists))` (`PadManager.js:186`)
  - `padManager.removePad(padId)` — **takes no callback at all** (`PadManager.js:240`); it fire-and-forgets `db.remove` and returns synchronously.
  - `db.db.get(key, cb(err, value))` (ueberdb2) — **method, needs `this` bound to `db.db` when promisified**
  - `dirty.set(key, value, cb)` — same `this`-binding concern
- Lazy `require()` placement inside steps is deliberate (`Settings`/`DB` must load after `npm.load`) — the converted code must keep the same require ordering, just inside an async function body instead of series steps.

## 2. Shared conversion recipe (applies to every step)

1. Wrap the body in a single `async function main()` (or an async IIFE), replacing `async.series([...])` with sequential statements — the series steps were already strictly sequential.
2. Promisify with `util.promisify`. For methods, bind the receiver: `const dbGet = util.promisify(db.db.get.bind(db.db))`. Unbound promisified methods losing `this` is the most likely silent breakage in this whole migration.
3. `async.forEachSeries(items, iter, done)` → `for (const item of items) { await ... }` (sequential, same as before).
4. `async.forEach(items, iter, done)` → `await Promise.all(items.map(async (item) => ...))`. This preserves the **parallel** dispatch of `async.forEach`; a plain `for..of` + `await` would serialize DB reads and change performance/interleaving. Failure semantics are close but not identical (both settle on first error while stragglers keep running); noted as an accepted micro-deviation.
5. Final handler: `main().then(() => { console.log("finished"); process.exit(0); })` plus, at the top of the file, `process.on('unhandledRejection', (err) => { throw err; });` and **no `.catch`**. Rationale: the old code does `if (err) throw err` inside a callback → uncaught exception → nonzero exit with a stack trace. A naive `.catch(err => { throw err })` produces an *unhandled rejection*, which on the Node versions this vintage supports (8/10/12) prints a **warning and exits 0** — a real, silent behavior change in error paths. The `unhandledRejection → throw` idiom reproduces the original crash semantics exactly.
6. Bare `process.exit(1)` calls buried inside callbacks stay verbatim — they work identically inside async functions.

## 3. Verification harness (set up once, before step 1)

Everything below was **tested and proven working during planning** on this machine (Windows, portable Node v10.24.1 from the baseline session):

- **Windows shim:** four of the five scripts require `Settings` via `../src/...`, which trips etherpad's `AbsolutePaths` win32 heuristic (`process.exit(1)` before any script logic). Running with `node -r <scratch>/posixify.js` — a preload that masks `process.platform` as `linux` — routes path detection down the Unix branch and the scripts run fully. This preload lives in the session scratch directory, is verification-only, and never touches repo code.
- **Test data:** `var/dirty.db` already contains ~15 pads with real revision history left by the baseline test run. `bin/checkPad.js 245qa` and `bin/checkAllPads.js` both run to `finished` against it (verified).
- **Golden-output protocol per file:**
  1. Snapshot `var/dirty.db` to scratch.
  2. Run the **pre-migration** script (happy path + at least one error path, e.g. nonexistent pad), capturing stdout+stderr with timestamps/ANSI stripped, plus the exit code, plus (for destructive scripts) a post-run copy of `dirty.db`.
  3. Restore the snapshot, apply the migration, re-run identical invocations.
  4. Require: identical normalized output, identical exit codes, identical resulting `dirty.db` bytes for destructive scripts.
- **Syntax gate:** `node --check bin/<file>.js` after each edit.
- **Regression gate after all five files:** re-run the backend API suite and require the same 68/75 passing as the baseline. The suite doesn't exercise `bin/`, but it's a cheap guard that nothing shared was touched by accident.

## 4. Ordered steps

### Step 1 — `bin/deletePad.js` (trivial, but one landmine)

- **Conversion:** four series steps → `await promisify(npm.load)({})` (keeping the exact `"Could not load NPM: " + er` / `process.exit(1)` handling), requires, `await promisify(db.init)()`, then the delete step.
- **Landmine:** `deletePad.js:50-53` currently calls `padManager.removePad(padId, function(err){ callback(err) })` — but `removePad` **accepts no callback**, so that anonymous function is dead code that never runs; the stray `callback()` on line 53 is the only live completion path. Zero-behavior-change conversion is therefore: plain synchronous `padManager.removePad(padId);` with **no await**, then proceed immediately to the success message. Do **not** "fix" this by promisifying removePad's nonexistent callback — there is nothing to await at this commit.
- **Could break:** awaiting something that never resolves (if the dead callback were naively promisified, the script would hang forever — this is the exact failure mode to avoid); losing the immediate-exit timing that lets buffered `db.remove` writes race `process.exit()` (identical race exists today; preserve it).
- **Verify:** golden protocol with a real pad ID from `dirty.db` — pad key must be absent from the post-run DB copy in both pre and post runs; same "Finished deleting padId: X" line; same exit code. Also run with a nonexistent pad ID (today this "succeeds" — must still "succeed").

### Step 2 — `bin/repairPad.js` (structurally simple; the broken step ports verbatim)

- **Conversion:** six series steps → sequential awaits. Steps 2, 5, 6 are already synchronous bodies ending in `callback()` — they become plain statements. `getPad` gets promisified.
- **Landmine:** `repairPad.js:82-90` uses **synchronous `Array.prototype.forEach`** with signature `(key, value)` — `value` is actually the array index, so it writes index numbers as values, and it never reads back the data it claims to restore. This is a pre-existing functional bug (per baseline). Zero behavior change means porting this block **unchanged** — it contains no callbacks except the trailing `callback()`, so it moves over as-is. Fixing it is explicitly out of scope; flag for a follow-up issue.
- **Could break:** accidentally "improving" the forEach into an awaited loop would turn fire-and-forget `db.remove`/`db.set` into completed writes and change what lands in the DB before `process.exit()`; the `db = db.db` reassignment (line 83) shadows the module — keep the same reassignment or an equivalent local so later references match.
- **Verify:** golden protocol against a snapshot pad; compare post-run `dirty.db` bytes pre- vs post-migration (both will contain the same index-valued garbage for the touched keys — identical garbage is the pass criterion). Restore snapshot afterwards.

### Step 3 — `bin/extractPadData.js` (moderate; currently cannot run at all)

- **Fact established during planning:** line 38's `require(".../ueberDB/node_modules/dirty")` crashes with `MODULE_NOT_FOUND` on a fresh install of this commit (the installed package is `ueberdb2`, and `dirty` is a sibling, not nested). The script is dead-on-arrival **before and after** migration.
- **Conversion:** same recipe; the interesting part is the step at lines 81-93: `async.forEach` over DB keys → `Promise.all` map; inside, `db.db.db.wrappedDB.get` and `dirty.set` both need `this`-bound promisification. Preserve the exact `if(err) { callback(err); return }` → `throw`/rejection ordering and the JSON.parse-if-not-object quirk.
- **Could break:** `this`-binding on `wrappedDB.get` and `dirty.set`; serializing the parallel key fetch.
- **Verify:** golden protocol degenerates to "identical crash": same `Cannot find module` error, same nonzero exit, at the same phase (after settings load). This is honest but weak — the converted `Promise.all` block is unreachable and therefore **not executable-verified** on this environment. Mitigation: keep the diff for this file purely mechanical, and rely on review + `node --check`. Flagged in §5.

### Step 4 — `bin/checkPad.js` (risky; 4-level pyramid + embedded exits)

- **Conversion:**
  - Steps 1–2 per recipe.
  - Step 3 (lines 36-54): `doesPadExists` → `await`; **note** the current code ignores the `err` argument entirely and only branches on `exists`. After promisification, a DB error becomes a rejection instead of `exists === undefined` (which today falls into "Pad does not exist" → `exit(1)`). Both paths end in nonzero termination, but the message differs on that error path. Accepted micro-deviation, documented in §5. The `exists === false` path keeps `console.error("Pad does not exist"); process.exit(1);` verbatim — including the fact that it exits without ever calling its series callback.
  - Step 4 (lines 55-132): outer `forEachSeries(keyRevisions)` → sequential `for..of`; inner `forEach(revisionsNeeded)` → `Promise.all` with bound `dbGet`; the `revisions[revNum] = revision` sparse-array accumulation carries over unchanged. The `process.exit(1)` at line 99 (missing pool) and the `continue`-style early `callback(); return` branches (missing atext at line 106, bad changeset at line 124) become `continue` in the loop.
- **Could break:** the early-return branches are per-key-revision "skip and keep going" semantics — mapping them to `return`/`throw` instead of `continue` would silently change how many revisions get checked; `this`-binding on `db.db.get`; accidentally serializing the inner parallel fetch (performance only, but contract says preserve).
- **Verify:** golden protocol: nonexistent pad (`Pad does not exist`, exit 1 — verified working today via the posixify preload), healthy pad (`finished`, exit 0 — verified today with pad `245qa`), and ideally a corrupted pad: hand-craft one in a scratch copy of `dirty.db` by deleting a `revs:N` key so the "No atext in key revision" branch fires pre- and post-migration.

### Step 5 — `bin/checkAllPads.js` (riskiest; 5-level pyramid + known error-path bug)

- **Conversion:** same inner structure as checkPad, plus one more outer layer: `async.forEach(padIds)` → `Promise.all(padIds.map(async ...))` (parallel across pads today — keep it parallel).
- **Landmine:** lines 47-49 — `if (err) { callback(err); }` **without `return`**, so today a `getPad` error reports the error *and* falls through to `pad.pool` on an undefined `pad`, throwing a synchronous `TypeError` inside a DB callback → process crash. Exact preservation of "call callback with err, then crash anyway" is neither possible nor sane in async/await. Planned mapping: `getPad` rejection → propagate (script dies with the underlying error, nonzero exit). The observable outcome class (abnormal termination on getPad failure) is preserved; the crash shape differs. Documented deviation, §5.
- **Could break:** everything from Step 4, times N pads running concurrently; the `padIds` variable is an accidental global (assigned without `var` at line 38) — keep the same effective scoping or a proper local, either works since it's single-file.
- **Verify:** golden protocol against the multi-pad `dirty.db` (verified today: runs to `finished` across ~15 pads). Corrupted-pad variant as in Step 4 to exercise the per-pad error messages (`Missing revision`, `Missing atext`, `Bad changeset`). Compare the full sorted set of per-pad error lines pre/post (sorted, because parallel ordering is nondeterministic in both versions).

### Step 6 — Final gate

- Re-run all golden comparisons in one pass.
- Re-run the backend API suite; require 68/75 (baseline parity).
- `git diff --stat` must touch only the five `bin/` files.

## 5. Known deviations & open flags (things I'm not fully confident about)

1. **Error-path fidelity is approximate in three places** (checkPad step-3 DB error message; checkAllPads getPad crash shape; `Promise.all` vs `async.forEach` straggler semantics). All preserve the outcome *class* (nonzero abnormal termination / settle-on-first-error) but not byte-identical output. If the project's bar is strict byte-identity even on error paths, these need sign-off first.
2. **`extractPadData.js` cannot be executable-verified** in this environment (pre-existing `MODULE_NOT_FOUND`). Its conversion will be review-verified only. Alternative if stronger verification is wanted: temporarily symlink the expected `ueberDB/node_modules/dirty` path in scratch — but that tests a configuration the commit never shipped, so I lean against it.
3. **Node floor:** `engines` says `>=6.9.0`, but async/await requires ≥7.6 and `util.promisify` requires ≥8. The migrated scripts implicitly raise the floor to Node 8 for `bin/` tools. CI (`.travis.yml`) uses `lts/*` (≥8 in this era), so CI is unaffected, but strictly this is a compatibility change that zero-behavior-change purism would reject. Needs a call: accept (recommended — matches what the ecosystem did) or add a note to `engines`.
4. **Windows verification is shimmed.** All golden runs go through the `posixify.js` preload because of the pre-existing `AbsolutePaths` win32 bug. The comparison is still apples-to-apples (same shim both sides), but absolute behavior on a real Linux box is inferred, not observed.
5. **`console.debug` in repairPad** (line 85) is an alias of `console.log` on Node ≥8 but didn't exist on very old Node — irrelevant under the Node-8 floor above, noted only for completeness.
6. **Timing races preserved by construction, not proven:** deletePad and repairPad both `process.exit()` while buffered ueberdb writes may be in flight. The conversion keeps the same fire-and-forget calls and exit points, but byte-identical DB state across runs has inherent nondeterminism today; verification compares snapshots but a rare flake there would be pre-existing nondeterminism, not migration breakage.

## 6. Explicitly out of scope (flag, don't fix)

- `repairPad.js` `(key, value)`/index bug and its never-reading-data design.
- `extractPadData.js` broken `ueberDB` require path.
- `deletePad.js` dead callback argument to `removePad` (dies naturally in conversion, but the underlying "no completion signal" API stays).
- `checkAllPads.js` missing-`return` error handling (behavior mapped, root cause untouched).
- The `AbsolutePaths` win32 `process.exit` bug and the `tidy.js` test crash (baseline §3).
