# Sync Simplification: Docs Consolidation + Enforced Contributor Model

**Date:** 2026-05-15
**Status:** Design — revised after multi-review (gemini + Claude sub-agent; codex/copilot unavailable in this env). Three confirmed blockers from review folded in below.
**Scope:** Tier 1 + Tier 2 only (see "Scope"). No production TypeScript changes; behavior-preserving.

## Context & core finding

Goal: reduce the **maintenance burden** and **conceptual complexity** of the sync
architecture — less to hold in your head, easier to onboard.

Research (four parallel deep-dives, see "Evidence") produced a counterintuitive
conclusion that shapes this whole plan:

> **The sync *code* is not meaningfully over-engineered. The team already did the
> hard simplification (deleted PFAPI ~83 files, removed the vector-clock defense
> layers, unified both transports behind one `OperationSyncCapable` interface +
> a shared `@sp/sync-core` orchestrator). Three prior independent analyses
> rejected every simpler model (delta-sync, LWW, CRDT) for reasons tied to a
> hard, non-negotiable constraint: no silent data loss on concurrent
> multi-device edits, offline-first, with a dumb/E2EE file server.**

Findings per candidate area:

| Area | Verdict | Safe code reduction | Risk |
|---|---|---|---|
| Transport duplication | Already unified; `file-based-sync-adapter` is *necessary server-emulation on dumb storage*, not redundancy | ~50–120 LOC, touches the most fragile code (snapshot-hydration; issues #7339/#7330) | High — **excluded** |
| Validation/repair | Mostly load-bearing; "4522 LOC" includes 471 test-only LOC | ~155–215 LOC (Tier 3, **deferred**) | Low |
| Four contributor rules | **Real win** — all four are one invariant; codebase already 100% compliant | n/a (adds lint) | Very low |
| Doc sprawl | **Biggest win** — ~33 files/~600 KB, one provably-stale doc falsely marked "Completed" | n/a (docs) | Near-zero |

Therefore: the maintenance-burden ceiling for *code* is low and risky. The
**conceptual-complexity** pain has a large, cheap, low-risk fix that lives in
the **docs** and the **scattered/unenforced contributor rules** — that is this plan.

## Scope

**In scope (Tier 1 + 2):**

1. Consolidate `docs/sync-and-op-log/` from ~33 files to a lean authoritative set.
2. Add one new `contributor-sync-model.md` capturing the single sync invariant.
3. Add two ESLint rules to the existing `eslint-local-rules/` plugin to *enforce*
   the model instead of relying on memory.
4. Tighten CLAUDE.md sync rules 1–3,6 to one line each + link to the new doc.

**Explicitly out of scope (not in this plan):**

- Tier 3 code cleanup (dead `DataRepairService`, typia-redundant guards,
  `providerMode` discriminant). Tracked separately; low payoff, deferred.
- Any change to sync runtime behavior, the op-log core, vector clocks,
  conflict resolution, providers, or `super-sync-server`.
- Replacing the engine or dropping providers (rejected earlier in research).

## Tier 1 — Documentation consolidation

### Target active doc set (7 docs)

| Doc | Action |
|---|---|
| `README.md` | Rewrite as a pure navigation index. Drop the historical/status tables (they drift; that drift is part of the problem). |
| `operation-log-architecture.md` | Remains the **one** authoritative architecture doc. Fold in: (a) `quick-reference.md`'s unique cheat-sheet tables as an appendix; (b) a new condensed **"Rejected alternatives & why"** section preserving the load-bearing rationale from `background-info/` (no-silent-data-loss / offline / dumb-E2EE-server constraint; why delta-sync, LWW, CRDT were rejected). |
| `contributor-sync-model.md` | **New.** The single contributor mental model (see Tier 1 §"New doc"). |
| `vector-clocks.md` | Keep as-is (current; cited by CLAUDE.md rule 8). |
| `supersync-encryption-architecture.md` | Keep as-is (current; implemented). |
| `operation-rules.md` | Keep as-is (short, current, lint-aligned). |
| `package-boundaries.md` | Keep as-is (short, current, matches enforced eslint boundaries). |
| `diagrams/` (directory) | Keep as the canonical diagram set. Fold in the 3 stray flowcharts' content where unique. |

### Deletions (hard-delete; git history is the archive)

No `archive/` folder. Delete; if a surviving doc needs the rationale, link the
**git commit** that removed it (`see commit <hash> for historical <topic> design`).

- `long-term-plans/hybrid-manifest-architecture.md` — **provably stale & misleading**: describes a multi-file `manifest.json` + `ops/` scheme with **zero** code references (`OperationLogManifestService` does not exist; the live format is single-file `sync-data.json`), yet self-labels "Completed". Highest-priority removal.
- `long-term-plans/replace-pfapi-with-oplog-plan.md` — completed Jan 2026; outcome captured by current architecture doc.
- `long-term-plans/e2e-encryption-plan.md` — superseded by `supersync-encryption-architecture.md` (its own header says so).
- `operation-payload-optimization-discussion.md` — dated discussion, not a spec.
- `background-info/` (5 files) — historical research/LLM-synthesized analyses. **Note (review R3):** the synthesized reports self-caveat that the models analyzed different/stale artifacts, so their *specifics are unreliable*; only the durable constraint (no-silent-data-loss / offline / dumb-E2EE-server, and why delta-sync/LWW/CRDT were rejected) is load-bearing. `operation-log-architecture.md` currently has **no** rejected-alternatives section (it covers LWW only as the *implemented* strategy at :1365). So the fold is **net-new synthesis written from first principles**, not mechanical extraction — a writing-judgment task, done **before** deletion.
- `quick-reference.md` — unique cheat-sheet tables folded into the architecture doc, then deleted.
- `operation-log-architecture-diagrams.md` (86 KB monolith) — unique **current** diagrams folded into `diagrams/`, then deleted. **Carve-out (review C2): exclude §5 and §6 "Hybrid Manifest ✅ IMPLEMENTED" (lines ~1507–1546) from the fold** — they assert `OperationLogManifestService` is "Complete", the exact false claim driving the hybrid-manifest deletion. They are deleted, not migrated. Sweep the kept `diagrams/*` for any other `HybridManifest`/`OperationLogManifestService` content during step 2.
- `supersync-scenarios.md`, `supersync-scenarios-flowchart.md`, `file-based-sync-flowchart.md` — fold any unique current flow into `diagrams/`, then delete.

Net: ~33 files → **7 active docs + `diagrams/`**.

### Cross-reference fixes (must be done in the same change so no link dangles)

- `CLAUDE.md:46` → currently points at `operation-log-architecture-diagrams.md §8`; repoint to `contributor-sync-model.md`.
- `operation-log-architecture.md:1545` → ref to diagrams monolith Section 2c; repoint to the new `diagrams/` file.
- `operation-log-architecture.md:2340` → ref to `long-term-plans/hybrid-manifest-architecture.md`; remove (or replace with commit-hash note if rationale is wanted).
- `diagrams/README.md:59` → ref to `../quick-reference.md`; remove (folded into architecture doc).
- Inter-flowchart links in `supersync-scenarios-flowchart.md`, `file-based-sync-flowchart.md`, `quick-reference.md:3` → resolved by the merges.
- `README.md:41` (`replace-pfapi-...`), `README.md:42` (`e2e-encryption-plan`), `README.md:167` (`background-info/`) → all removed by the full README rewrite (step 5); listed for checklist completeness.
- **(review C1 — must-fix) External, outside `docs/sync-and-op-log/`:** `docs/long-term-plans/server-side-entity-versioning.md:328` links to `../sync-and-op-log/long-term-plans/e2e-encryption-plan.md` (a deleted doc). Repoint to `../sync-and-op-log/supersync-encryption-architecture.md` (the kept E2EE reference). This file is **not** in the doc set so it must be an explicit change-set item, not left to verify-time discovery.

### New doc: `contributor-sync-model.md`

States **one invariant, two boundaries, one atomicity rule**:

> **One user intent = exactly one operation. Replayed/remote ops must never
> re-trigger effects.**
>
> - **Action boundary** — effects inject `LOCAL_ACTIONS`, not `Actions`.
>   *Enforced by `local-rules/no-actions-in-effects` (Tier 2).*
> - **Selector boundary** — selector-driven effects guard with
>   `skipDuringSyncWindow()` / `HydrationStateService.isApplyingRemoteOps()`.
>   *Enforced by the existing `local-rules/require-hydration-guard`.*
> - **Atomicity** — multi-entity changes are meta-reducers (one reducer pass =
>   one op); bulk-dispatch loops yield with
>   `await new Promise(r => setTimeout(r, 0))`.

Plus a short decision table ("Writing an effect? → these checks; the linter
enforces two of them") and links to `operation-rules.md` for the deeper "why".

## Tier 2 — Enforce the model (ESLint)

Existing plugin: `eslint-local-rules/` (`eslint-plugin-local-rules` convention),
`rules/require-hydration-guard.js` + `require-entity-registry.js`, registered in
`eslint.config.js:216-222` for `**/*.effects.ts`. Add, following that exact pattern:

- **`eslint-local-rules/rules/no-actions-in-effects.js`** (`error`): bans
  `inject(Actions)` and the `Actions` import (incl. aliased
  `import { Actions as X } from '@ngrx/effects'`) in `*.effects.ts`;
  message/suggestion points to `LOCAL_ACTIONS`/`ALL_ACTIONS`. Codebase is
  **already 100% compliant** (verified: 0 `inject(Actions)`, 0 `@ngrx/effects`
  `Actions` imports across all 43 real `*.effects.ts`) → zero migration, pure
  regression guard. **Correction (review R2):** the existing rules do
  CallExpression/selector analysis only and have **no `ImportDeclaration`
  handling**; this rule follows the *plugin + spec structure* of the existing
  rules but adds new `ImportDeclaration` + `inject()`-call detection. The spec
  must cover the aliased-import case.
- **`eslint-local-rules/rules/no-multi-entity-effect.js`** (`warn`): heuristic —
  flags an effect whose dispatch arm references >1 feature slice / >1 entity action
  creator; message points to `root-store/meta/task-shared-meta-reducers/`. `warn`
  (like `require-entity-registry`) because the heuristic has false positives;
  inline-disable with a justification comment is allowed.

Each gets a co-located `.spec.js` (ESLint `RuleTester`) modeled on
`require-hydration-guard.spec.js`, registered in `eslint-local-rules/index.js`
and added to `eslint.config.js`. The `no-multi-entity-effect` spec must include a
**positive "blessed path" case** (a multi-entity change routed through a
`task-shared-meta-reducers/` meta-reducer) so the correct pattern is documented
in-test.

**Spec runner (review C3 — must-fix):** `npm test` runs Karma over `*.spec.ts`
only; it does **not** run `.spec.js`. The existing `require-hydration-guard.spec.js`
currently has **no runner and no CI step** (dead coverage). Add a
`"test:lint-rules"` npm script (e.g. `node --test "eslint-local-rules/**/*.spec.js"`)
plus a CI step, which also resurrects the existing orphaned spec. This is the
only addition beyond docs+rules and is in-scope for Tier 2.

No production TypeScript changes. No runtime behavior change.

## CLAUDE.md changes

- Rules **1, 2, 3, 6** (the four facets of the one invariant): tighten each to a
  single terse line that still states the guardrail (kept in always-loaded
  context) but moves mechanism/why to `contributor-sync-model.md` via link.
- Rule **1**'s doc pointer: `operation-log-architecture-diagrams.md §8` →
  `docs/sync-and-op-log/contributor-sync-model.md`.
- Rules **4, 5, 7, 8, 9** are unrelated to this invariant → unchanged
  (rule 8 still points at `vector-clocks.md`, which is kept).

## Execution order (so links never dangle mid-migration)

1. Create `contributor-sync-model.md`.
2. Fold `background-info/` rationale (net-new synthesis) + `quick-reference.md`
   tables + diagram monolith content into `operation-log-architecture.md` /
   `diagrams/` — **excluding** the monolith's stale §5/§6 Hybrid Manifest
   sections (C2).
3. Fix all cross-references (table above) to final destinations — **including
   the external `docs/long-term-plans/server-side-entity-versioning.md:328`
   (C1)**.
4. Delete the stale/superseded/folded source docs.
5. Rewrite `README.md` as an index of the final 7 docs + `diagrams/`; add
   `contributor-sync-model.md` to CLAUDE.md "Required reading per task" and link
   it from `CONTRIBUTING.md` (visibility — gemini suggestion).
6. Add the two ESLint rules + specs + `index.js`/`eslint.config.js`
   registration + the `test:lint-rules` npm script + CI step (C3).
7. Tighten CLAUDE.md rules 1–3,6 + repoint rule 1.
8. Run the full Verification checklist; only then is the change complete.

## Verification

- Markdown link check across **all of `docs/` (incl. `docs/long-term-plans/`) and
  CLAUDE.md** → zero dangling links. (The sweep must NOT exclude
  `docs/long-term-plans/` — that is where the C1 external ref lives.)
- `grep -rn "hybrid-manifest\|quick-reference\|architecture-diagrams\|background-info\|supersync-scenarios\|file-based-sync-flowchart\|payload-optimization\|replace-pfapi\|e2e-encryption-plan"` over `*.md *.ts *.js` (excluding only `docs/sync-and-op-log/` and `docs/plans/`) → zero hits after migration.
- `npm run lint` clean; `no-actions-in-effects` produces **0** violations on the
  current tree (proves it is a pure regression guard, not a migration).
- `npm run test:lint-rules` green (the new runner; also re-covers the
  previously-orphaned `require-hydration-guard.spec.js`).
- **Tightened (review R4):** `git grep -E "HybridManifest|OperationLogManifestService"`
  over `src/ packages/` → zero. (Do **not** grep bare `manifest.json` — it has
  dozens of unrelated plugin/i18n hits and would false-positive.)

## Risks

- **Low overall** — docs + non-bypassable lint + CLAUDE.md text. No production
  code path changes; no sync behavior change.
- *Knowledge loss on delete:* mitigated by folding load-bearing rationale into
  the architecture doc **before** deletion, plus git history + commit-hash
  references.
- *`no-multi-entity-effect` false positives:* mitigated by shipping as `warn`
  with an allowed inline-disable + justification.
- *CLAUDE.md too terse:* the guardrail sentence stays in always-loaded context;
  only the "why" moves to the linked doc.

## Evidence (research provenance)

- Complexity inventory: op-log ~28 K LOC; transports already unified behind
  `OperationSyncCapable` + `@sp/sync-core`.
- Prior analyses (`background-info/`): op-log chosen over delta-sync/LWW/CRDT
  due to the no-data-loss/offline/dumb-E2EE-server constraint.
- Stale-doc proof: zero `HybridManifest`/`manifest.json` refs in code; live
  format is `sync-data.json` (`file-based-sync-adapter.service.ts`).
- Contributor-rule unification: 0 `inject(Actions)` in any `*.effects.ts`;
  `require-hydration-guard` already enforces the selector boundary.
