import { registerPlugin } from '@capacitor/core';

/**
 * Local Capacitor plugin bridging the web layer to the iOS WidgetKit
 * extension (native side: `ios/App/App/WidgetBridgePlugin.swift`). Only
 * registered natively on iOS — Android goes through `androidInterface`
 * instead (see WidgetDataService), so never call this off iOS.
 */
export interface WidgetBridgePlugin {
  /**
   * Persist the `widget_data` v:1 JSON blob to the shared App Group container
   * and ask WidgetKit to re-render the widget timeline.
   */
  setWidgetData(options: { json: string }): Promise<void>;

  /**
   * Atomically read and clear the pending widget done-tap queue.
   * @returns JSON object string `{taskId: targetIsDone}`, or null if empty —
   * same shape as `androidInterface.getWidgetDoneQueue()`.
   */
  getAndClearDoneQueue(): Promise<{ json: string | null }>;
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');
