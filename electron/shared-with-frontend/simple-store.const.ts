export enum SimpleStoreKey {
  IS_USE_CUSTOM_WINDOW_TITLE_BAR = 'isUseCustomWindowTitleBar',
  ALLOWED_COMMANDS = 'allowedCommands',
  // Main-owned sync folder path (issue #8228); the renderer no longer holds it.
  SYNC_FOLDER_PATH = 'syncFolderPath',
  // Main-owned, never-synced persisted nodeExecution consent (issue #8512 Phase 2).
  // The renderer has no IPC write path that can grant consent into this key — only
  // a native Allow dialog in main writes it — so XSS/un-granted code cannot self-grant.
  PLUGIN_NODE_EXECUTION_CONSENT = 'pluginNodeExecutionConsent',
  // Legacy key kept for backwards compatibility when reading persisted settings
  LEGACY_IS_USE_OBSIDIAN_STYLE_HEADER = 'isUseObsidianStyleHeader',
}
