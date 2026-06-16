export enum SimpleStoreKey {
  IS_USE_CUSTOM_WINDOW_TITLE_BAR = 'isUseCustomWindowTitleBar',
  ALLOWED_COMMANDS = 'allowedCommands',
  // Main-owned sync folder path (issue #8228); the renderer no longer holds it.
  SYNC_FOLDER_PATH = 'syncFolderPath',
  // Legacy key kept for backwards compatibility when reading persisted settings
  LEGACY_IS_USE_OBSIDIAN_STYLE_HEADER = 'isUseObsidianStyleHeader',
}
