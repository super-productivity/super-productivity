// Import and re-export all types from the plugin-api package
export {
  PluginHooks,
  Hooks,
  PluginBaseCfg,
  DialogButtonCfg,
  DialogCfg,
  NotifyCfg,
  PluginManifest,
  PluginHookHandler,
  PluginInstance,
  PluginHookHandlerRegistration,
  PluginCreateTaskData,
  PluginShortcutCfg,
  PluginMenuEntryCfg,
  PluginHeaderBtnCfg,
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
  PluginSidePanelBtnCfg,
  // Export the new unified types
  Task,
  Project,
  Tag,
  // Keep legacy exports for compatibility
  TaskData,
  ProjectData,
  TagData,
  TaskCopy,
  ProjectCopy,
  TagCopy,
} from '@super-productivity/plugin-api';

// Import app-specific types
import { SnackParams } from '../core/snack/snack.model';

// App-specific types that differ from the plugin-api package
export type SnackCfgLimited = Omit<
  SnackParams,
  'actionFn' | 'actionStr' | 'actionPayload'
>;
