import { AppFeaturesConfig } from '../../features/config/global-config.model';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { LS } from '../../core/persistence/storage-keys.const';
import { T } from '../../t.const';
import { NAV_SECTION_ICON } from '../magic-side-nav/nav-section-icons.const';
import { PluginMenuEntryCfg } from '../../plugins/plugin-api.model';

export type BottomNavRouteSlotId = 'planner' | 'inbox' | 'boards' | 'schedule' | 'search';

export interface BottomNavRouteSlot {
  kind: 'route';
  id: BottomNavRouteSlotId;
  route: string;
  icon: string;
  labelKey: string;
  // Unset: always available.
  featureKey?: keyof AppFeaturesConfig;
}

/** A plugin's side-nav entry (`registerMenuEntry`); a tap runs its action. */
export interface BottomNavPluginSlot {
  kind: 'plugin';
  // `plugin:<pluginId>:<label>`: a plugin may register several entries.
  id: string;
  pluginId: string;
  label: string;
  icon: string;
  onClick: () => void;
}

export type BottomNavSlotOption = BottomNavRouteSlot | BottomNavPluginSlot;

export const DEFAULT_BOTTOM_NAV_SLOT: BottomNavRouteSlotId = 'planner';

const PLUGIN_SLOT_PREFIX = 'plugin:';

export const BOTTOM_NAV_SLOT_OPTIONS: readonly BottomNavRouteSlot[] = [
  {
    kind: 'route',
    id: 'planner',
    route: '/planner',
    icon: NAV_SECTION_ICON.PLANNER,
    labelKey: T.MH.PLANNER,
    featureKey: 'isPlannerEnabled',
  },
  {
    kind: 'route',
    id: 'inbox',
    route: `/project/${INBOX_PROJECT.id}/tasks`,
    icon: 'inbox',
    labelKey: T.G.INBOX_PROJECT_TITLE,
  },
  {
    kind: 'route',
    id: 'boards',
    route: '/boards',
    icon: NAV_SECTION_ICON.BOARDS,
    labelKey: T.MH.BOARDS,
    featureKey: 'isBoardsEnabled',
  },
  {
    kind: 'route',
    id: 'schedule',
    route: '/schedule',
    icon: NAV_SECTION_ICON.SCHEDULE,
    labelKey: T.MH.SCHEDULE,
    featureKey: 'isSchedulerEnabled',
  },
  {
    kind: 'route',
    id: 'search',
    route: '/search',
    icon: NAV_SECTION_ICON.SEARCH,
    labelKey: T.MH.SEARCH,
    featureKey: 'isSearchEnabled',
  },
];

const toPluginSlot = (entry: PluginMenuEntryCfg): BottomNavPluginSlot => ({
  kind: 'plugin',
  id: `${PLUGIN_SLOT_PREFIX}${entry.pluginId}:${entry.label}`,
  pluginId: entry.pluginId,
  label: entry.label,
  icon: entry.icon || 'extension',
  onClick: entry.onClick,
});

export const getAvailableBottomNavSlotOptions = (
  features: AppFeaturesConfig,
  pluginEntries: readonly PluginMenuEntryCfg[] = [],
): BottomNavSlotOption[] => [
  ...BOTTOM_NAV_SLOT_OPTIONS.filter((o) => !o.featureKey || features[o.featureKey]),
  ...pluginEntries.map(toPluginSlot),
];

/**
 * The stored choice if it is known and its feature is enabled, else Planner.
 * A plugin choice whose entry was renamed falls back to that plugin's first
 * entry. `null` when Planner is the fallback but disabled: the slot is then
 * hidden, as it was before the slot became configurable.
 *
 * Plugins register their entries after startup, so a stored plugin choice
 * shows Planner until the plugin has loaded. The stored value is never
 * rewritten here, so the choice comes back once the entry appears.
 */
export const resolveBottomNavSlot = (
  storedId: string | null,
  features: AppFeaturesConfig,
  pluginEntries: readonly PluginMenuEntryCfg[] = [],
): BottomNavSlotOption | null => {
  const available = getAvailableBottomNavSlotOptions(features, pluginEntries);
  const storedPluginId = storedId?.startsWith(PLUGIN_SLOT_PREFIX)
    ? storedId.slice(PLUGIN_SLOT_PREFIX.length).split(':')[0]
    : undefined;
  return (
    available.find((o) => o.id === storedId) ??
    available.find((o) => o.kind === 'plugin' && o.pluginId === storedPluginId) ??
    available.find((o) => o.id === DEFAULT_BOTTOM_NAV_SLOT) ??
    null
  );
};

/**
 * Whether `url` is the slot's page or below it. A bare `startsWith` would
 * also match a sibling route sharing the prefix (`/schedule` and
 * `/scheduled-list`).
 */
export const isBottomNavSlotActive = (
  slot: BottomNavSlotOption | null,
  url: string,
): boolean => {
  if (!slot) {
    return false;
  }
  // A plugin entry is an action; its page, when it opens one, lives here.
  const base = slot.kind === 'route' ? slot.route : `/plugins/${slot.pluginId}`;
  if (!url.startsWith(base)) {
    return false;
  }
  const rest = url.slice(base.length);
  return rest === '' || /^[/?#]/.test(rest);
};

// Device-local on purpose: the bar only exists on narrow screens, so the
// choice belongs to the device and is never synced.
export const readStoredBottomNavSlot = (): string | null => {
  try {
    return localStorage.getItem(LS.BOTTOM_NAV_SLOT);
  } catch {
    return null;
  }
};

export const writeStoredBottomNavSlot = (id: string): void => {
  try {
    localStorage.setItem(LS.BOTTOM_NAV_SLOT, id);
  } catch {
    // Storage unavailable: the choice just lasts for this session.
  }
};
