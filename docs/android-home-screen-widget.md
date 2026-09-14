# Android home-screen widget

> **Status:** Maintained
>
> **Last verified:** 2026-07-29

The widget displays up to 20 tasks from the app's last snapshot of either the
Today view or one selected active project and lets the user toggle completion.
It is a native projection of Angular state, not an independent task or calendar
engine.

Each new widget uses Android's configuration screen to select Today or an
unarchived visible project. The selection is stored only for that widget ID;
existing widgets and a selection whose project is no longer available fall back
to Today.

Opening a project widget opens that project's task list in the app. Today widgets
retain the normal default-app behavior.

In a selected-project widget, a completed task stays visible for five seconds before
leaving the widget. It remains completed and available in the app's normal done-task
list. Today retains its existing completed-task display.

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

- No task creation, undo, or per-task deep link.
- Native widget chrome is English-only and uses fixed styling.
- At most 20 tasks are rendered.
- Cross-client freshness while the app is dead requires a separate background
  sync design. The reminder worker's cursor is not an authoritative app-state
  cursor; see
  [Android background sync improvements](long-term-plans/android-background-sync-improvements.md).

Changes should preserve the single-writer snapshot, queued-intent delivery,
logical-day boundary, and post-sync refresh invariants.
