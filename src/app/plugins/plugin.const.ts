/**
 * Plugin system constants - KISS approach: be generous with limits
 */
export const MAX_PLUGIN_ZIP_SIZE = 10 * 1024 * 1024; // 10MB - plenty of room
export const MAX_PLUGIN_MANIFEST_SIZE = 100 * 1024; // 100KB - why limit JSON?
export const MAX_PLUGIN_CODE_SIZE = 5 * 1024 * 1024; // 5MB - let them build complex plugins
// Combined cap for all of a plugin's translation files; bounds what one upload
// adds to the IndexedDB cache. Real plugins ship all languages in well under 200KB.
export const MAX_PLUGIN_TRANSLATIONS_TOTAL_SIZE = 5 * 1024 * 1024;
