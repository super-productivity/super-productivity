# Android home-screen widget

> **Status:** Maintained
>
> **Last verified:** 2026-11-01

The widget displays up to 20 tasks from the app's last snapshot of either the
Today view or one selected active project and lets the user toggle completion.
It is a native projection of Angular state, not an independent task or calendar
engine.

Android's configuration screen can select Today or an unarchived, visible
project for each widget. Launchers that support optional configuration may add
the widget with Today as the default; the selection can be changed later from
the launcher's widget settings. Project choices come from the most recent
Angular snapshot, so immediately after upgrading from an older widget format
the picker can show only Today until the app has been opened once.

Selections are device-local and excluded from Android backup and device
transfer because launcher widget IDs are not stable across restoration. A
widget whose selected project is deleted, archived, or hidden falls back to
Today. The stored selection is retained, so making an archived or hidden
project available again restores it.

Tapping a project widget's header or a row opens that project's task list in
the app. Today widgets keep opening the app's default view.

Project widgets show open tasks only: the project list followed by the backlog,
up to the 20-row limit. Angular leaves done tasks out of the project lists, so
they never use up rows. A checkbox tap shows as checked at once through the
pending-done overlay; the row disappears with the next snapshot push, after the
app has applied the tap. Today widgets keep listing completed tasks.

A project tap is handed to Angular through a pending entry in
`task_list_widget`. It expires after a minute, because Android can block a row
tap's background activity launch without reporting it; the entry must not make
a much later app start jump into the project. Reopening the app from recents, or
the relaunch after a package update, does not repeat the navigation.

## Contract and ownership

- Angular's `WidgetDataService` is the only writer of the `widget_data` JSON
  snapshot, including the projected task lists for selectable projects. The
  TypeScript contract is
  `src/app/features/android/android-widget.model.ts`.
- Kotlin parses the versioned `v: 1` shape in
  `android/app/src/main/java/com/superproductivity/superproductivity/widget/WidgetData.kt`.
  Unknown versions fail closed to an empty list.
- Native checkbox taps write only to `WidgetDoneQueue`. The renderer overlays
  queued target states immediately; Angular later drains, deduplicates, and
  applies those intents. Native code must never rewrite the snapshot.
- Per-widget project selections and pending project navigation live in
  `task_list_widget` SharedPreferences. This file must remain excluded from
  Android backup and device transfer unless widget-ID remapping is implemented.
- Keep the explicit-component PendingIntent and exported-receiver restrictions;
  external apps must not be able to complete tasks.
- The header's "+" opens `QuickAddActivity`, a dialog over the home screen
  that writes the typed title to `CaptureInbox` (like a share) and finishes.
  Angular imports it on its next start or resume as one Today `addTask` with
  short syntax applied. Like checkbox taps, it never touches the snapshot: the
  renderer lists not-yet-imported title captures above the snapshot rows
  (`WidgetData.withPendingCaptures`, raw title, checkbox opens the app). This
  is a fact of the capture contract (title captures always go to Today), not
  Today membership computed natively.

The serializer and Kotlin parser are locked to the same golden shape by
`android-widget.selectors.spec.ts` and `WidgetDataTest.kt`. Update both ends and
both tests when the contract changes.

## Day and freshness semantics

Angular supplies `dayStr` and `validUntil`. Native code judges staleness only as
`now >= validUntil`; it must not reproduce logical-day offsets, recurring-task
materialization, overdue carry-over, or virtual `TODAY_TAG` membership.

The widget reflects the last state produced while the app was able to run. When
the process is dead it cannot create a new day's recurring tasks or receive
cross-client changes. Its 30-minute platform refresh is inexact and may be
deferred by Doze. A pre-`validUntil` snapshot cannot be classified as stale
until the app writes a current snapshot.

## Deliberate limitations

- No undo or per-task deep link. Quick add takes a title only (short syntax
  covers project, tags and dates) and always lands in Today, also from a
  project widget.
- A project widget lists open tasks only; a task checked there disappears once
  the app applies the tap. Undo it from the app's done list.
- Inbox, archived projects and projects hidden from the menu are not
  selectable.
- Native widget chrome is English-only and uses fixed styling.
- At most 20 tasks are rendered.
- Cross-client freshness while the app is dead requires a separate background
  sync design. The reminder worker's cursor is not an authoritative app-state
  cursor; see
  [Android background sync improvements](long-term-plans/android-background-sync-improvements.md).

Changes should preserve the single-writer snapshot, queued-intent delivery,
logical-day boundary, and post-sync refresh invariants.
