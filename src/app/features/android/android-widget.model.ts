/**
 * Contract for the `widget_data` KeyValStore blob consumed by the native Android
 * home screen widget. The native reader is
 * `android/app/src/main/java/com/superproductivity/superproductivity/widget/WidgetData.kt`
 * — keep both ends in sync. Bump `v` on breaking changes; the native side renders
 * unknown versions as an empty widget instead of mis-parsing them.
 *
 * Angular is the ONLY writer of this blob. Pending widget done-taps are overlaid
 * natively at render time from WidgetDoneQueue, never written into the blob.
 */
export const ANDROID_WIDGET_DATA_KEY = 'widget_data';

export interface AndroidWidgetTask {
  id: string;
  title: string;
  isDone: boolean;
  // omitted (not null) when the task has no project — org.json's optString maps
  // JSON null to the literal string "null"
  projectId?: string;
}

export interface AndroidWidgetData {
  v: 1;
  /**
   * DISPLAY ONLY — the logical day (YYYY-MM-DD) this snapshot was computed for, shown
   * in the header once the snapshot expires. Never compare it natively to derive
   * staleness; that is `validUntil`'s job. Parsing it wrong yields a wrong label; the
   * verdict stays correct.
   */
  dayStr: string;
  /**
   * THE VERDICT — epoch ms at which this snapshot stops describing "today", i.e. the
   * end of `dayStr` including the user's start-of-next-day offset. Native's whole
   * staleness check is `now >= validUntil`; no platform re-derives the app's calendar
   * rules.
   *
   * Why the app ships the decision rather than its inputs: native cannot recompute
   * today's list anyway — it only exists once Angular has run its day-change effects
   * (repeat instances get materialized, overdue carried over), so with the process
   * dead across midnight the blob is simply yesterday's, and the widget's only honest
   * move is to say so. Shipping the boundary instant keeps that judgement in one
   * language instead of mirroring `getDbDateStr` semantics into Kotlin, then Swift.
   *
   * Tradeoff: this freezes the writer's timezone, because the boundary is resolved in
   * whatever zone the device was in at push time. Fly west and the snapshot expires
   * early — a false "outdated", the fail-safe direction; fly east and it expires late,
   * briefly reproducing #9098 for the delta. Note the device timezone is NOT a selector
   * input, so a bare push after landing reuses the memoized boundary: it is recomputed
   * only when one of the selector's own inputs changes (today's task ids, a task, a
   * project, todayStr, or the offset) — or on a restart. Travelling alone does not do
   * it, and neither does unrelated state churn. (#9098)
   */
  validUntil: number;
  tasks: AndroidWidgetTask[];
  projectColors: { [projectId: string]: string };
}
