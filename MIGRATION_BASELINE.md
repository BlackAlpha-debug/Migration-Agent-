# Migration Baseline — `bin/` callback → async/await

**Repo:** `ether/etherpad` (cloned from `https://github.com/ether/etherpad.git`)
**Commit:** `fce55df2b7229cb61e5a0aeb7e07230f566f24c5` — "Fix typos" (2019-01-12), the commit immediately preceding [PR #3559](https://github.com/ether/etherpad/pull/3559)
**Scope:** `bin/checkAllPads.js`, `bin/checkPad.js`, `bin/deletePad.js`, `bin/extractPadData.js`, `bin/repairPad.js`
**Status:** Investigation only — no source files were modified.

---

## 1. Environment setup

This is 2019-era code (`engines: {"node": ">=6.9.0"}`, `async@0.9.0`, bundled `npm@6.4.1` as a runtime dependency). Two environment issues had to be worked around to get anything running; both are environment-only changes, not code changes:

- **Node 22 (system default) crashes the server on startup.** The bundled `npm@6.4.1` dependency ships an old `graceful-fs` polyfill that throws `TypeError: cb.apply is not a function` against modern Node's `fs` internals. Worked around by downloading a **portable, non-system-wide Node v10.24.1** into the session scratch directory and using it to run install/server/tests. No system Node install was touched.
- **`bin/installDeps.sh`'s `ln -s ../src ep_etherpad-lite` does not produce a working symlink on this Windows/Git-Bash setup.** It silently leaves `node_modules/ep_etherpad-lite` as a real, separate populated directory while `src/` itself has no `node_modules`. Worked around with a Windows directory junction (`src/node_modules` → `node_modules/ep_etherpad-lite/node_modules`) so `npm test`'s relative paths resolve. This also explains a test-suite crash noted below — it is a pre-existing platform issue in the app's own path-detection code, not caused by this workaround.

## 2. Dependency install

`sh bin/installDeps.sh` completed successfully under Node 10: **419 packages added**, 1062 audited. Expected heavy deprecation noise from 2019-pinned transitive deps (`request`, `formidable@1.2.1`, `log4js@0.6.35`, etc.) and `npm audit` reports 103 known vulnerabilities (10 low / 23 moderate / 50 high / 20 critical) — all pre-existing in this dependency tree, not investigated further as out of scope for a callback→async/await migration.

## 3. Test suite results

**Direct coverage of the `bin/` scripts: none.** They are standalone CLI tools; nothing in `tests/` requires or exercises `checkAllPads.js`, `checkPad.js`, `deletePad.js`, `extractPadData.js`, or `repairPad.js`. The one file matched by a grep for these names (`tests/backend/specs/api/pad.js`) references the **HTTP API's** `deletePad` endpoint, unrelated to `bin/deletePad.js`.

The only runnable suite is the backend API integration suite (`src/package.json` → `"test": "nyc mocha --timeout 5000 ../tests/backend/specs/api"`), which requires a live Etherpad server (started against the portable Node 10 build, `dirty.db` backend, default `settings.json.template`).

| Spec file | Result |
|---|---|
| `chat.js`, `pad.js`, `sessionsAndGroups.js` (run together) | **68 passing / 7 failing** (75 total → **90.7% pass rate**) |
| `tidy.js` | **Crashes the process before any test runs** (see below) — excluded from the count above |

**The 7 failures** are a single cascading cluster in `pad.js`'s `setText`/`getText` block, all bottoming out in `superagent: double callback bug`. First failure: `pad.js:392`, `TypeError: Cannot read property 'body' of undefined`. This is a known flaky-test issue in this vintage of the suite (rapid consecutive `supertest` requests racing on keep-alive), not something introduced by this environment.

**`tidy.js` cannot run at all.** Its `before()` hook calls `require('../../../../src/node/utils/Settings')`, which pulls in `src/node/utils/AbsolutePaths.js`. On `win32`, `AbsolutePaths.findEtherpadRoot()` hardcodes the assumption that any resolved root path ends in `node_modules\ep_etherpad-lite`, and calls `process.exit(1)` directly (not a thrown error) if that assumption fails — which kills the whole Mocha process with no summary. Because the test file's `require()` path is hardcoded to `src/node/utils/...`, this assumption can never hold for this specific test's `before()` hook on any Windows install, whether or not the `ln -s` step above works correctly — this looks like a **pre-existing bug in etherpad 1.7.0's Windows path detection**, unrelated to the migration scope. Not fixed here since the task is investigation-only.

**Code coverage:** `nyc` is wired up via `npm test` but its default include-glob doesn't match the `src/` files reached through the test suite's relative `require()`s, so it reports a flat 0% across all files — not a meaningful signal, not a real baseline number. No coverage tooling is configured for `bin/` at all (consistent with "no direct test coverage" above).

## 4. Callback-pattern inventory

All five files share the same skeleton: top-level `async.series([...])` (from `async@0.9.0`) chaining a handful of step functions, bootstrapped by a `npm.load({}, callback)` call. Risk grouping below is based on nesting depth, error-handling correctness, and whether a genuine functional bug rides along with the callback code (all such bugs are called out explicitly since they matter for migration sequencing — an async/await rewrite is the natural place to fix them, but only if the agent is told they're there).

### Trivial (single-level callback, direct passthrough — mechanical `.then`/`await` conversion)

| File:Line | Pattern |
|---|---|
| [bin/checkAllPads.js:20-22](bin/checkAllPads.js#L20-L22) | `npm.load({}, callback)` step |
| [bin/checkAllPads.js:24-30](bin/checkAllPads.js#L24-L30) | settings/db require + `db.init(callback)` |
| [bin/checkAllPads.js:32-41](bin/checkAllPads.js#L32-L41) | `padManager.listAllPads(function(err, res){...})` |
| [bin/checkAllPads.js:137-145](bin/checkAllPads.js#L137-L145) | `async.series` final completion callback |
| [bin/checkPad.js:22-26](bin/checkPad.js#L22-L26) | `npm.load({}, function(er){callback(er)})` step |
| [bin/checkPad.js:28-34](bin/checkPad.js#L28-L34) | settings/db require + `db.init(callback)` |
| [bin/checkPad.js:48-52](bin/checkPad.js#L48-L52) | nested `padManager.getPad(padId, function(err,_pad){...})` |
| [bin/checkPad.js:133-141](bin/checkPad.js#L133-L141) | `async.series` final completion callback |
| [bin/deletePad.js:19](bin/deletePad.js#L19) | `async.series` — only 4 simple steps |
| [bin/deletePad.js:21-33](bin/deletePad.js#L21-L33) | `npm.load` step w/ inline error handling |
| [bin/deletePad.js:35-39](bin/deletePad.js#L35-L39) | settings/db require step |
| [bin/deletePad.js:41-44](bin/deletePad.js#L41-L44) | `db.init(callback)` step |
| [bin/deletePad.js:55-63](bin/deletePad.js#L55-L63) | `async.series` final completion callback |
| [bin/extractPadData.js:19](bin/extractPadData.js#L19) | `async.series` outer |
| [bin/extractPadData.js:21-33](bin/extractPadData.js#L21-L33) | `npm.load` step |
| [bin/extractPadData.js:35-40](bin/extractPadData.js#L35-L40) | settings/db/dirty require step |
| [bin/extractPadData.js:42-45](bin/extractPadData.js#L42-L45) | `db.init(callback)` step |
| [bin/extractPadData.js:47-56](bin/extractPadData.js#L47-L56) | `padManager.getPad(padId, function(err,_pad){...})` |
| [bin/extractPadData.js:95-103](bin/extractPadData.js#L95-L103) | `async.series` final completion callback |
| [bin/repairPad.js:21](bin/repairPad.js#L21) | `async.series` outer |
| [bin/repairPad.js:23-35](bin/repairPad.js#L23-L35) | `npm.load` step |
| [bin/repairPad.js:37-41](bin/repairPad.js#L37-L41) | settings/db require step |
| [bin/repairPad.js:43-46](bin/repairPad.js#L43-L46) | `db.init(callback)` step |
| [bin/repairPad.js:48-57](bin/repairPad.js#L48-L57) | `padManager.getPad(padId, function(err,_pad){...})` |
| [bin/repairPad.js:58-81](bin/repairPad.js#L58-L81) | key-list builder (pure sync, calls `callback()` at end) |
| [bin/repairPad.js:91-99](bin/repairPad.js#L91-L99) | `async.series` final completion callback |

### Moderate (2-level nesting, or an `async.series` step whose callback contract is bent but not broken)

| File:Line | Pattern |
|---|---|
| [bin/checkAllPads.js:18](bin/checkAllPads.js#L18) | Top-level `async.series` orchestrating 4 steps |
| [bin/checkPad.js:20](bin/checkPad.js#L20) | Top-level `async.series` orchestrating 4 steps |
| [bin/checkPad.js:36-54](bin/checkPad.js#L36-L54) | `doesPadExists` callback: **ignores `err` entirely**, only checks `exists`, and calls `process.exit(1)` at L45 without ever invoking `callback` — leaves the `async.series` step "hanging" by design (relies on process exit rather than proper error propagation) |
| [bin/extractPadData.js:57-94](bin/extractPadData.js#L57-L94) | 2-level nesting: `async.forEach(neededDBValues, ...)` → `db.db.db.wrappedDB.get(dbkey, function(err, dbvalue){...})` → `dirty.set(dbkey, dbvalue, callback)` passthrough |

### Risky (3+ levels of nesting, and/or a genuine functional bug entangled with the callback code — migrate these last, and read carefully before rewriting)

| File:Line | Pattern | Why risky |
|---|---|---|
| [bin/checkAllPads.js:42-136](bin/checkAllPads.js#L42-L136) | 5-level callback pyramid: `async.forEach(padIds)` → `padManager.getPad` → `async.forEachSeries(keyRevisions)` → `async.forEach(revisionsNeeded)` → `db.db.get(...)` | Deepest nesting in the whole scope; easy to get `return` placement wrong when flattening to `await` inside nested loops |
| [bin/checkAllPads.js:47-49](bin/checkAllPads.js#L47-L49) | `if (err) { callback(err); }` with **no `return`** after | Pre-existing bug: on error, execution falls through to `pad.pool` access on a possibly-undefined `pad`. Worth fixing as part of the rewrite, but flag it — don't silently "fix" it without noting the behavior change |
| [bin/checkPad.js:55-131](bin/checkPad.js#L55-L131) | 4-level pyramid: `async.forEachSeries(keyRevisions)` → `async.forEach(revisionsNeeded)` → `db.db.get(...)`, plus a `process.exit(1)` buried at L99 inside the innermost callback | `process.exit()` calls nested several callbacks deep bypass `async.series`'s own error propagation entirely — converting this to `await` requires deciding whether to keep the abrupt-exit behavior or replace it with a thrown/propagated error |
| [bin/deletePad.js:46-54](bin/deletePad.js#L46-L54) | `padManager.removePad(padId, function(err){callback(err)})` **immediately followed by a second, synchronous `callback()` call on line 53** | Real bug: `callback` is invoked twice — once synchronously (no error, before the removal actually completes) and again asynchronously when `removePad` finishes. This likely lets `async.series` proceed to "Finished deleting padId" before the pad is actually removed. High-value fix to carry through the migration, but must be called out explicitly since fixing it changes observable behavior (the success message will now genuinely wait for removal) |
| [bin/repairPad.js:82-90](bin/repairPad.js#L82-L90) | `neededDBValues.forEach(function(key, value) {...})` | **Uses synchronous `Array.prototype.forEach`, not `async.forEach`** — the callback signature `(key, value)` is actually `(element, index)` per the native `Array.forEach` contract, so `value` is really the array index, not any real data. `db.set(key, value)` therefore writes the index number as the "value" for every key. Additionally `db.remove`/`db.set` are fire-and-forget (not awaited), and `callback()` on line 89 fires before any of them settle. **This step never actually reads back the data it's supposed to be "repairing"** — it looks structurally incomplete/broken independent of callback style. Highest-priority item to understand fully (possibly consult `git blame`/later history) before attempting a mechanical async/await conversion, since a naive conversion would faithfully preserve a broken repair tool |

## 5. Summary

- 5 files, ~28 distinguishable callback-style call sites total: **21 trivial, 3 moderate, 4 risky** (risky items span more lines/nesting than the count suggests — see table).
- Two of the five files (`deletePad.js`, `repairPad.js`) carry real, pre-existing bugs inside the code being migrated. These should be flagged to a human reviewer regardless of migration approach — an automated callback→async/await pass could either faithfully preserve the bugs (safest for a pure refactor) or fix them as a side effect (needs explicit sign-off, since it changes behavior).
- `checkAllPads.js` and `checkPad.js` are near-duplicates (single-pad vs. all-pads variants of the same revision-integrity check) sharing the deepest nesting in the scope — a shared async helper extracted during migration could collapse a lot of duplication, though that's a step beyond a literal callback→async/await conversion.
