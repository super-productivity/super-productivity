import type { PluginAPI as PluginAPIInterface } from '@super-productivity/plugin-api';

// Record over keyof makes the compiler fail when a PluginAPI member is added
// or removed without updating this list, so suggestions cannot drift.
const PLUGIN_API_MEMBERS: Record<keyof PluginAPIInterface, true> = {
  cfg: true,
  Hooks: true,
  registerHook: true,
  registerHeaderButton: true,
  registerMenuEntry: true,
  registerTaskContextMenuEntry: true,
  registerConfigHandler: true,
  registerShortcut: true,
  unregisterShortcut: true,
  registerSidePanelButton: true,
  registerWorkContextHeaderButton: true,
  registerIssueProvider: true,
  getActiveWorkContext: true,
  showInWorkContext: true,
  closeWorkContextView: true,
  onReady: true,
  onUnload: true,
  onMessage: true,
  showSnack: true,
  notify: true,
  showIndexHtmlAsView: true,
  openDialog: true,
  getTasks: true,
  getArchivedTasks: true,
  getCurrentContextTasks: true,
  getSelectedTask: true,
  getFocusedTask: true,
  getAppState: true,
  selectTask: true,
  reInitData: true,
  updateTask: true,
  addTask: true,
  deleteTask: true,
  batchUpdateForProject: true,
  getAllProjects: true,
  addProject: true,
  updateProject: true,
  deleteProject: true,
  getAllTags: true,
  addTag: true,
  updateTag: true,
  reorderTasks: true,
  log: true,
  persistDataSynced: true,
  loadSyncedData: true,
  triggerSync: true,
  listSyncedDataKeys: true,
  getConfig: true,
  translate: true,
  formatDate: true,
  getCurrentLanguage: true,
  startOAuthFlow: true,
  getOAuthToken: true,
  clearOAuthToken: true,
  setSecret: true,
  getSecret: true,
  deleteSecret: true,
  request: true,
  downloadFile: true,
  executeNodeScript: true,
  dispatchAction: true,
  isWindowFocused: true,
  onWindowFocusChange: true,
  setCounter: true,
  getCounter: true,
  incrementCounter: true,
  decrementCounter: true,
  deleteCounter: true,
  getAllCounters: true,
};

export const PLUGIN_API_MEMBER_NAMES: readonly string[] = Object.keys(PLUGIN_API_MEMBERS);

export const PLUGIN_API_TYPES_URL =
  'https://raw.githubusercontent.com/super-productivity/super-productivity/master/packages/plugin-api/src/types.ts';

// Probed by the runtime itself (await, JSON.stringify), not by plugin authors.
export const IGNORED_PROBES = new Set(['then', 'toJSON']);

/**
 * Builds the console warning for a `PluginAPI` member that does not exist.
 * AI-written plugins often call invented methods (#7173: `showIframe`); the
 * plain "is not a function" error looks like an app bug, while naming close
 * real methods lets the author (or their assistant) fix the call.
 *
 * Must stay self-contained (no references outside its body): the iframe
 * bridge embeds it via `toString()`. That is why its helpers are inlined and
 * it runs longer than usual.
 */
export const unknownPluginApiMemberMessage = (
  name: string,
  knownNames: readonly string[],
  typesUrl: string,
): string => {
  const words = (s: string): string[] =>
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  const distance = (a: string, b: string): number => {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      prev = cur;
    }
    return prev[b.length];
  };
  const nameWords = words(name);
  const suggestions = knownNames
    .map((known) => ({
      known,
      shared: words(known).filter((w) => nameWords.includes(w)).length,
      dist: distance(name.toLowerCase(), known.toLowerCase()),
    }))
    .filter((c) => c.shared > 0 || c.dist <= 2)
    .sort((a, b) => b.shared - a.shared || a.dist - b.dist)
    .slice(0, 3)
    .map((c) => c.known);
  const hint = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '';
  return `PluginAPI.${name} does not exist.${hint} All methods: ${typesUrl}`;
};

/**
 * Wraps the host-side `PluginAPI` so reading a member that is not part of the
 * API logs which real members are close. Reads still return `undefined`, so
 * feature detection (`if (PluginAPI.onUnload)`) keeps working.
 */
export const withUnknownMemberWarning = <T extends object>(
  api: T,
  warn: (msg: string) => void,
): T => {
  const warned = new Set<string>();
  const bound = new WeakMap<object, unknown>();
  return new Proxy(api, {
    get: (target, prop) => {
      if (
        typeof prop === 'string' &&
        !(prop in target) &&
        !Object.prototype.hasOwnProperty.call(PLUGIN_API_MEMBERS, prop) &&
        !IGNORED_PROBES.has(prop) &&
        !warned.has(prop)
      ) {
        warned.add(prop);
        warn(
          unknownPluginApiMemberMessage(
            prop,
            PLUGIN_API_MEMBER_NAMES,
            PLUGIN_API_TYPES_URL,
          ),
        );
      }
      const value: unknown = Reflect.get(target, prop);
      if (typeof value !== 'function') {
        return value;
      }
      // PluginAPI methods read #private fields, which throw when `this` is the
      // proxy; bind once so repeated reads keep returning the same function.
      if (!bound.has(value)) {
        bound.set(value, value.bind(target));
      }
      return bound.get(value);
    },
  });
};
