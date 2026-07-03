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
  tasks: AndroidWidgetTask[];
  projectColors: { [projectId: string]: string };
}
