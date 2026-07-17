/**
 * Contract for the `widget_data` blob consumed by the native home screen
 * widgets. The native readers are
 * `android/app/src/main/java/com/superproductivity/superproductivity/widget/WidgetData.kt`
 * (blob stored in the Android KeyValStore) and
 * `ios/App/SupWidget/WidgetData.swift` (blob stored in the App Group
 * UserDefaults) — keep all ends in sync. Bump `v` on breaking changes; the
 * native sides render unknown versions as an empty widget instead of
 * mis-parsing them.
 *
 * Angular is the ONLY writer of this blob. Pending widget done-taps are overlaid
 * natively at render time from the platform's done queue, never written into
 * the blob.
 */
export const WIDGET_DATA_KEY = 'widget_data';

export interface WidgetTask {
  id: string;
  title: string;
  isDone: boolean;
  // omitted (not null) when the task has no project — org.json's optString maps
  // JSON null to the literal string "null"
  projectId?: string;
}

export interface WidgetData {
  v: 1;
  tasks: WidgetTask[];
  projectColors: { [projectId: string]: string };
  /** Epoch milliseconds when this logical-Today snapshot becomes stale. */
  validUntil?: number;
}
