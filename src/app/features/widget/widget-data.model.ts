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

export interface WidgetCurrentTask {
  id: string;
  title: string;
  // omitted (not null) when the task has no project — see WidgetTask.projectId
  projectId?: string;
  /** Human-readable device currently tracking this task, e.g. 'Desktop', 'Android'. */
  deviceLabel: string;
  /** True when tracked on this device; false when tracked remotely (SuperSync presence). */
  isLocal: boolean;
  /**
   * Epoch ms after which native must stop showing this as live. Set only for remote
   * sessions (`receivedAt + PRESENCE_STALE_AFTER_MS`): the JS staleness ticker cannot
   * run once Android reclaims the process, so the native widget enforces it itself.
   */
  expiresAt?: number;
}

export interface WidgetData {
  v: 1;
  /** Logical day (YYYY-MM-DD) represented by this snapshot. */
  dayStr: string;
  /** Epoch milliseconds when this logical-Today snapshot becomes stale. */
  validUntil: number;
  tasks: WidgetTask[];
  projectColors: { [projectId: string]: string };
  /**
   * The task currently being tracked — on this device, or (SuperSync only) on a
   * remote one via tracking-presence — or null when nothing is tracked. Not
   * necessarily one of `tasks`: a remote device may track a task not scheduled
   * for today.
   */
  currentTask: WidgetCurrentTask | null;
}
