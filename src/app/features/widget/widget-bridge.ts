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

  /** Read the pending done-target queue without deleting it. */
  readDoneQueue(): Promise<{ json: string | null; token: string | null }>;

  /**
   * Remove only entries whose unique revision still matches a lease token.
   * Every tap after the read remains pending, even if its final target matches.
   */
  acknowledgeDoneQueue(options: { token: string }): Promise<void>;
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');
