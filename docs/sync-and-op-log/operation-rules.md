# Operation Rules (Compatibility Pointer)

This path is retained so historical links do not break. The former rules
catalog mixed durable invariants with stale implementation details and is not a
source of current behavior.

Use these maintained owners instead:

- [`contributor-sync-model.md`](./contributor-sync-model.md) for effect,
  selector, reducer, and bulk-dispatch rules;
- [`sync-architecture.html`](./sync-architecture.html) for the current
  whole-system map and executable source owners;
- [`operation-log-architecture.md`](./operation-log-architecture.md) for
  append-only payload/lifecycle semantics, migration policy, and design history;
- [`section-conflict-replay.md`](./section-conflict-replay.md) for the narrow
  SECTION semantic-replay exception;
- [`vector-clocks.md`](./vector-clocks.md) for causality and clock storage; and
- [`supersync-encryption-architecture.md`](./supersync-encryption-architecture.md)
  for the E2EE wire and integrity boundaries.

Constants and validation limits are intentionally not copied here. Read their
executable owners under `src/app/op-log/`, `packages/sync-core/`, and
`packages/super-sync-server/`.
