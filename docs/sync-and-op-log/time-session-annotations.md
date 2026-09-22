# Time session annotations

`Task.timeSessions?: TimeSession[]` is optional detail attached to the existing
synced task, not a new entity or source of truth. Its runtime default is an empty
array. `timeSpentOnDay` remains authoritative; no schema bump or migration is
needed. This follows discussion #5432's August 14, 2026 direction.

The existing `[TimeTracking] Sync time spent` payload may include `session`.
The duration is still a positive batch delta. The annotation carries a stable
recording ID and cumulative duration. Local dispatch records the annotation;
remote replay also applies the existing total delta. Periodic flushes extend a
recording; a task switch, pause, day change, or explicit time edit closes it.
IDs and timestamps originate before dispatch, never in reducers. The existing
commutation rule for timer deltas is unchanged. Independent recording IDs merge,
and repeated annotation versions retain the maximum cumulative duration.
Operation-log deduplication still owns deduplication of the additive totals.

Pending ticks update only live totals. Session annotations are added when the
batch becomes an operation, so the existing pending-time snapshot projection
can exclude uncommitted totals without separately projecting annotations.
Tasks carry their annotations through the existing archive and backup paths.

Manual daily-total corrections use the existing absolute task update and leave
recordings untouched. The displayed correction is `day total - sum(recordings)`;
there is no second persisted adjustment field to synchronize. Explicit session
edits update the annotation and total in one ordinary task update, using the
existing conflict policy for such edits. Concurrent explicit edits are not a
session-level CRDT. A legacy client may replace annotation detail via an entity
snapshot; totals remain authoritative in that case.

`d` identifies the logical work day. `s` is UTC milliseconds and `o` is the
recorded `Date.getTimezoneOffset()` value. Display uses that offset so travelling
does not move a historical recording's displayed clock time. Old durations and
native recovery without interval metadata do not fabricate exact start times.

Verification covers seeded task-state replay, separate device recordings,
periodic flushes, stop/resume, day changes, snapshot/tail reconstruction,
explicit corrections, frozen legacy hydration, and the daily-summary browser
workflow. The baseline replay test first failed because master discarded
session metadata while preserving the summed duration.
