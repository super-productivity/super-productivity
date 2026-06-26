import {
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
} from '../../packages/plugin-api/src/types';

/**
 * Shape of the Electron main-process bridge the renderer uses to grant, run, and
 * revoke Node script execution for a plugin. This is a host-internal IPC contract
 * (not part of the public plugin API), shared between the renderer
 * (`plugin-bridge.service.ts`) and the Electron API typing
 * (`electron/electronAPI.d.ts`) so the two cannot drift.
 */
export interface PluginNodeExecutionElectronApi {
  requestGrant(
    pluginId: string,
    displayInfo?: { name?: string; version?: string },
  ): Promise<{ token: string } | null>;
  executeScript(
    pluginId: string,
    grantToken: string,
    request: PluginNodeScriptRequest,
  ): Promise<PluginNodeScriptResult>;
  revokeGrant(pluginId: string, grantToken: string): Promise<void>;
  /**
   * Drop the live session grant AND the main-owned persisted consent for this plugin so
   * the next node call re-prompts. Called by the renderer on disable / uninstall /
   * re-upload. There is deliberately no `setConsent` counterpart — only a native Allow
   * dialog in main can write consent, so the renderer can never self-grant.
   */
  clearConsent(pluginId: string): Promise<void>;
}
