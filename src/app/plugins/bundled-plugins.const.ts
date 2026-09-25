// Each plugin's `id` (from its manifest.json, distinct from the asset path
// here) becomes the entityId prefix for all data it persists via
// `persistDataSynced` — keyed entries land under `<pluginId>:<key>` in IDB,
// the op-log, and on the sync wire. Once a plugin ships, renaming its id
// orphans every user's stored data: there is no automatic re-keying. Treat
// pluginIds as permanent for any plugin that has ever been published.
export const BUNDLED_PLUGIN_PATHS = [
  'assets/bundled-plugins/yesterday-tasks-plugin',
  'assets/bundled-plugins/sync-md',
  'assets/bundled-plugins/api-test-plugin',
  'assets/bundled-plugins/procrastination-buster',
  'assets/bundled-plugins/automations',
  'assets/bundled-plugins/github-issue-provider',
  'assets/bundled-plugins/clickup-issue-provider',
  'assets/bundled-plugins/gitea-issue-provider',
  'assets/bundled-plugins/linear-issue-provider',
  'assets/bundled-plugins/trello-issue-provider',
  'assets/bundled-plugins/azure-devops-issue-provider',
  'assets/bundled-plugins/brain-dump',
  'assets/bundled-plugins/voice-reminder',
  'assets/bundled-plugins/google-calendar-provider',
  'assets/bundled-plugins/caldav-calendar-provider',
  'assets/bundled-plugins/doc-mode',
  'assets/bundled-plugins/todoist-import',
  // Defer parallel-code until registerTaskContextMenuEntry (#9617) is available.
] as const;

// Reserved ids: an uploaded plugin may not reuse a bundled plugin's manifest id (it would
// let unverified code impersonate a built-in — and, with nodeExecution now openable to
// uploaded plugins, claim a bundled dir's "verified built-in" consent dialog in the main
// process, which decides bundled-vs-uploaded by on-disk dir). This set MUST contain the
// manifest id of every entry in BUNDLED_PLUGIN_PATHS; the invariant is guarded by
// electron/bundled-plugin-ids.test.cjs (a filesystem-reading node test, since a browser
// Karma spec cannot read the manifests) so the two lists cannot silently drift again.
export const BUNDLED_PLUGIN_IDS = new Set<string>([
  'ai-productivity-prompts',
  'api-test-plugin',
  'automations',
  'azure-devops-issue-provider',
  'brain-dump',
  'caldav-calendar-provider',
  'clickup-issue-provider',
  'doc-mode',
  'gitea-issue-provider',
  'github-issue-provider',
  'google-calendar-provider',
  'linear-issue-provider',
  'parallel-code', // Keep the id reserved while its bundled entry is deferred.
  'procrastination-buster',
  'sync-md',
  'todoist-import',
  'trello-issue-provider',
  'voice-reminder',
  'yesterday-tasks',
]);
