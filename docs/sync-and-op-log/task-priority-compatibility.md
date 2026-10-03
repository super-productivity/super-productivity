# Task priority encoding compatibility

The optional task `priority` field accepts `high`/`medium`/`low`, their numeric
equivalents `3`/`2`/`1`, and `null`. Missing and `null` mean no priority.
Readers preserve the original value across validation, import, replay, restart,
archive/restore and duplication. `getTaskPriority` supplies the numeric meaning
for icons, labels, menu selection, sorting and filtering. Explicit priority
changes still write numbers (or `null` to clear); selecting the same semantic
level emits no operation.

Saved device-local priority filters also accept historical `high`/`medium`/`low`
presets. On reload they adopt the equivalent current `3`/`2`/`1` menu value, so
both task encodings remain visible and the selected menu entry is marked.

No migration, new field, schema bump, new action or plugin API change is needed.
The task-row template is unchanged: the existing indicator caches normalization
with a computed signal, and the menu caches it when its task input changes.

## Why fix forward

`132f090056` introduced string priorities; `6bcdb7e6ac` (#10360) replaced them
with numbers and deleted legacy strings in validation auto-fix and duplication.
At the audited base `d5ccda515a`, a real browser backup import of `high`, `medium`
and `low` produced three missing priorities. Numeric values and `null` survived.
The browser log identified the `task-priority-invalid-to-undefined` repair.

On 2026-10-03, `git tag --contains 132f090056` and
`git tag --contains 6bcdb7e6ac` returned no tags. Master nevertheless distributes
to Play internal and Snap edge. This is reproduced content loss on a normal
import path, with two historical master cohorts already writing different data.
A straight revert to string-only validation would reject the numeric cohort's
stored values. The authorized bounded repair reads both instead of reversing
which cohort loses compatibility.

## Rollout and limits

Both historical commits and the audited base identify as app version `19.1.0`.
That version cannot distinguish string-only, numeric-only and repaired readers.
The normal release process must ship this repair under a **distinct future app
version** and tell users to upgrade every participating priority-aware device.
This change does not reserve or bump a release version.

An updated reader cannot fix an installed old binary. A string-only reader can
reject numeric priorities; a numeric-only reader can erase string priorities.
An older client that predates the priority field treats it as an unknown optional
property. The repair cannot recover priorities already erased; recovery needs an
intact backup or another copy of the data. SuperSync currently **does not enforce
a minimum app version**; this task adds no gate. See the
[client version floor contract](client-version-floor.md).

## Regression evidence

The dedicated browser test is
[`supersync-priority-compatibility.spec.ts`](../../e2e/tests/sync/supersync-priority-compatibility.spec.ts).
It generates a real backup, imports all six representations plus `null`, checks
both encrypted sync directions, unrelated edits, the icon/menu, semantic no-op
operation count, archive/restore on both clients, null clearing, restart and
backup export. Duplication (including subtasks), sorting/filtering and all icon
presets are covered by focused Angular specs. Three additional browser cases
reload saved historical filters after receiving both task encodings through
SuperSync, checking matching tasks and the selected menu entry at every level.
Real validator cases invoke `appDataValidators.archiveYoung/archiveOld` directly;
invalid-priority negative controls prove both archive checks can fail.

Run with the provider runner:

```sh
npm run e2e:supersync:file e2e/tests/sync/supersync-priority-compatibility.spec.ts -- --retries=0
```

For the coordinated local audit, the server was already running on port 1901
and a worktree-specific frontend on 4246. The equivalent required-server command
avoids stopping other workers' server:

```sh
E2E_BASE_URL=http://localhost:4246 E2E_REQUIRE_SUPERSYNC=true npm run e2e:file -- e2e/tests/sync/supersync-priority-compatibility.spec.ts --workers=1 --retries=0
```

Baseline: failed with all three string priorities changed to `undefined`.
The original mixed-encoding browser regression passed. During the follow-up
review, all three saved-filter browser cases failed before the preset repair
with zero matching tasks instead of two; the matching Angular reload cases also
failed. After repair, all three saved-filter browser cases passed, no skips.
The repaired focused Angular suites passed 202 tests (priority indicator,
duplication, bulk actions, context menu, customizer, auto-fix validation and
frozen-state compatibility). The archive validator file independently passed
53 tests, including its two negative controls. These counts describe separate
runs, not a full repository suite.

## Review

Fresh-context review-and-improve pass:

- **Fixed:** the initial bidirectional sync test rewrote each priority with its
  existing value, so it could pass even if an update were ignored. Each direction
  now switches every non-null priority to the equivalent other encoding and
  asserts the exact received values. It also verifies unrelated notes arrive.
  The strengthened browser test passed (one test, no skips).
- **Fixed:** historical saved priority presets were retained as strings, while
  the filter compared their numeric coercion to task priorities. Reload hid all
  tasks. Restoring each historical preset now adopts its current numeric menu
  value using the existing priority semantics; both task encodings are preserved.
- **Fixed:** the original archive assertions used `validateAllData`, which omits
  both archives. The tests now call each real archive validator directly and
  verify an invalid priority is rejected. No archive production defect was found.
- **Not fixed:** CI's App Features Sync-button test remained unchecked after
  re-enabling it. The exact test passed three local runs with retries disabled,
  and the entire App Features file passed eight tests with CI's three workers.
  The failure remains unexplained; no unsupported workaround was added.

Follow-up checks include `checkFile` on all four TypeScript files changed during
review, app TypeScript and E2E TypeScript compilation
(`-p e2e/tsconfig.json --noEmit --baseUrl .`, resolving the existing `src/` alias),
and documentation link validation.
