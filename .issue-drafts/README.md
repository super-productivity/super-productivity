# Architecture issue drafts

Six issue drafts produced from the 2026-06 architecture review.

**Posted 2026-06-12:** 01 → [#8296](https://github.com/super-productivity/super-productivity/issues/8296),
02 → [#8297](https://github.com/super-productivity/super-productivity/issues/8297),
03 → [#8298](https://github.com/super-productivity/super-productivity/issues/8298),
04 → [#8299](https://github.com/super-productivity/super-productivity/issues/8299),
05 → [#8300](https://github.com/super-productivity/super-productivity/issues/8300),
06 → [#8301](https://github.com/super-productivity/super-productivity/issues/8301) (umbrella, cross-links the rest).
Issue bodies contain the issue draft + implementation plan; the verification notes
below each draft remain only in these files. Each file contains a
self-contained GitHub issue body (`## Issue draft (for GitHub)`), a phased
implementation plan, and verification notes documenting which review claims were
confirmed, corrected, or dropped against the working tree.

| # | Draft | One-liner | First shippable win |
| --- | --- | --- | --- |
| 01 | [typed-operation-capture](01-typed-operation-capture.md) | Make op-log capture compile-enforced instead of `meta.isPersistent` convention | Prod ordering validation + typed LWW action types (both S) |
| 02 | [deferred-action-buffer](02-deferred-action-buffer.md) | Stop silently dropping buffered user actions during sync; harden stuck-window paths | Loud failure + cap raise (S) — most shippable of the set |
| 03 | [platform-abstraction](03-platform-abstraction.md) | Capability layer + lint ratchet to drive raw `IS_ELECTRON` out of feature code | Single platform-truth module (S) |
| 04 | [core-decoupling](04-core-decoupling.md) | Chip away at TaskService/task.component; feature-boundary lint rule | Boundary lint rule + baseline (S) |
| 05 | [issue-provider-unification](05-issue-provider-unification.md) | One registry path for built-in and plugin issue providers; shared HTTP kit | Registry skeleton + Redmine pilot (M) |
| 06 | [finish-migrations](06-finish-migrations.md) | Tracking issue: pfapi dead-code deletion, NgModule retirement, Signals policy | Delete `src/app/pfapi/` (half a day, zero importers) |

## Cross-issue notes (resolve when posting)

- **06 → 03:** draft 06 item 4 (platform detection) defers to draft 03 — replace the
  draft reference with the real issue number when posting.
- **04 ↔ 06:** both touch `task.service.ts` (04 extracts slices; 06 proposes it as the
  Signals flagship PR). Sequence: land 04's extractions first, then the Signals
  conversion on the slimmer file.
- **02 ↔ 01:** complementary, no conflict — 02 hardens the hydrator/window paths; 01
  deliberately defers its capture-meta-reducer DI refactor (Phase 4) to a possible
  follow-up issue.
- **Not covered by any draft** (called out as separate-issue candidates in 04):
  `plugin-bridge.service.ts` split (2,093 LOC / 23 injects) and a `StartupService`
  rework.

## Suggested labels when posting

All: `architecture`. 01/02: `sync`. 02: `bug` (it is one). 06: `tracking`.
