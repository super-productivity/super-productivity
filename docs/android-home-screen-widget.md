# Android home-screen widget

> **Status:** Maintained
>
> **Last verified:** 2026-09-11

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

Opening a project widget opens that project's task list in the app. Today widgets
retain the normal default-app behavior.

Selected-project widgets show open tasks from the active list followed by the
backlog, up to the 20-row limit. A task completed from the widget stays visible
for a five-second undo window based on the device's local tap time. Completions
first observed from app or sync state do not start a grace window. Today retains
its existing completed-task display. The provider schedules each expiry with
`AlarmManager`, which can re-enter the provider after Android stops the app process
when the device is active. When exact alarms are unavailable, an in-process timer
provides the timely refresh while a non-waking inexact alarm remains as the
process-death fallback. The expiry path does not wake a sleeping device or bypass
Doze for this cosmetic update.

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

- No task creation or per-task deep link. Undo is available only while a
  completed row remains visible during its five-second grace window.
- Inbox, archived projects, and projects hidden from the menu are not selectable.
- Native widget chrome is English-only and uses fixed styling.
- At most 20 tasks are rendered.
- Cross-client freshness while the app is dead requires a separate background
  sync design. The reminder worker's cursor is not an authoritative app-state
  cursor; see
  [Android background sync improvements](long-term-plans/android-background-sync-improvements.md).

Changes should preserve the single-writer snapshot, queued-intent delivery,
logical-day boundary, and post-sync refresh invariants.
