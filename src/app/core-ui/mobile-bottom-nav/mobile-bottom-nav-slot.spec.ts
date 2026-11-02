import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { AppFeaturesConfig } from '../../features/config/global-config.model';
import { LS } from '../../core/persistence/storage-keys.const';
import { PluginMenuEntryCfg } from '../../plugins/plugin-api.model';
import {
  BOTTOM_NAV_SLOT_OPTIONS,
  BottomNavSlotOption,
  getAvailableBottomNavSlotOptions,
  isBottomNavSlotActive,
  readStoredBottomNavSlot,
  resolveBottomNavSlot,
  writeStoredBottomNavSlot,
} from './mobile-bottom-nav-slot';

describe('mobile bottom nav slot', () => {
  const features = (over: Partial<AppFeaturesConfig> = {}): AppFeaturesConfig => ({
    ...DEFAULT_GLOBAL_CONFIG.appFeatures,
    ...over,
  });

  describe('resolveBottomNavSlot', () => {
    it('defaults to Planner when nothing is stored', () => {
      expect(resolveBottomNavSlot(null, features())?.id).toBe('planner');
    });

    BOTTOM_NAV_SLOT_OPTIONS.forEach((option) => {
      it(`resolves the stored "${option.id}" option`, () => {
        expect(resolveBottomNavSlot(option.id, features())).toBe(option);
      });
    });

    it('falls back to Planner for an unknown stored value', () => {
      expect(resolveBottomNavSlot('nonsense', features())?.id).toBe('planner');
      expect(resolveBottomNavSlot('', features())?.id).toBe('planner');
    });

    it('falls back to Planner when the stored option is disabled', () => {
      expect(
        resolveBottomNavSlot('boards', features({ isBoardsEnabled: false }))?.id,
      ).toBe('planner');
      expect(
        resolveBottomNavSlot('schedule', features({ isSchedulerEnabled: false }))?.id,
      ).toBe('planner');
      expect(
        resolveBottomNavSlot('search', features({ isSearchEnabled: false }))?.id,
      ).toBe('planner');
    });

    it('keeps an enabled choice while Planner is disabled', () => {
      expect(
        resolveBottomNavSlot('inbox', features({ isPlannerEnabled: false }))?.id,
      ).toBe('inbox');
    });

    it('hides the slot when the fallback Planner is disabled too', () => {
      const noPlanner = features({ isPlannerEnabled: false });
      expect(resolveBottomNavSlot(null, noPlanner)).toBeNull();
      expect(resolveBottomNavSlot('planner', noPlanner)).toBeNull();
      expect(
        resolveBottomNavSlot('boards', { ...noPlanner, isBoardsEnabled: false }),
      ).toBeNull();
    });
  });

  describe('getAvailableBottomNavSlotOptions', () => {
    it('offers every option by default', () => {
      expect(getAvailableBottomNavSlotOptions(features()).map((o) => o.id)).toEqual([
        'planner',
        'inbox',
        'boards',
        'schedule',
        'search',
      ]);
    });

    it('leaves out options whose feature is disabled, but always offers Inbox', () => {
      const ids = getAvailableBottomNavSlotOptions(
        features({
          isPlannerEnabled: false,
          isBoardsEnabled: false,
          isSchedulerEnabled: false,
          isSearchEnabled: false,
        }),
      ).map((o) => o.id);
      expect(ids).toEqual(['inbox']);
    });
  });

  describe('plugin entries', () => {
    const entry = (pluginId: string, label: string): PluginMenuEntryCfg => ({
      pluginId,
      label,
      onClick: () => undefined,
    });
    const entries = [
      entry('p1', 'Doc Mode'),
      entry('p1', 'Other'),
      entry('p2', 'Kanban'),
    ];

    it('offers every registered entry after the built-in options', () => {
      const ids = getAvailableBottomNavSlotOptions(features(), entries).map((o) => o.id);
      expect(ids.slice(5)).toEqual([
        'plugin:p1:Doc Mode',
        'plugin:p1:Other',
        'plugin:p2:Kanban',
      ]);
    });

    it('resolves a stored entry, with a fallback icon', () => {
      const slot = resolveBottomNavSlot('plugin:p2:Kanban', features(), entries);
      expect(slot?.kind).toBe('plugin');
      expect(slot?.icon).toBe('extension');
      expect(slot?.kind === 'plugin' && slot.pluginId).toBe('p2');
    });

    it("falls back to the plugin's first entry when the label changed", () => {
      expect(resolveBottomNavSlot('plugin:p1:Renamed', features(), entries)?.id).toBe(
        'plugin:p1:Doc Mode',
      );
    });

    it('falls back to Planner while the plugin is not (yet) registered', () => {
      expect(resolveBottomNavSlot('plugin:p3:Gone', features(), entries)?.id).toBe(
        'planner',
      );
      expect(resolveBottomNavSlot('plugin:p1:Doc Mode', features(), [])?.id).toBe(
        'planner',
      );
    });
  });

  describe('isBottomNavSlotActive', () => {
    const route = (id: string): BottomNavSlotOption =>
      BOTTOM_NAV_SLOT_OPTIONS.find((o) => o.id === id)!;
    const plugin: BottomNavSlotOption = {
      kind: 'plugin',
      id: 'plugin:p1:Doc Mode',
      pluginId: 'p1',
      label: 'Doc Mode',
      icon: 'extension',
      onClick: () => undefined,
    };

    it('is active on the slot route and below it', () => {
      expect(isBottomNavSlotActive(route('schedule'), '/schedule')).toBe(true);
      expect(isBottomNavSlotActive(route('planner'), '/planner?x=1')).toBe(true);
      expect(isBottomNavSlotActive(plugin, '/plugins/p1/index')).toBe(true);
    });

    it('is not active on a sibling route that shares the prefix', () => {
      expect(isBottomNavSlotActive(route('schedule'), '/scheduled-list')).toBe(false);
      expect(isBottomNavSlotActive(plugin, '/plugins/p12/index')).toBe(false);
    });

    it('is not active without a slot', () => {
      expect(isBottomNavSlotActive(null, '/planner')).toBe(false);
    });
  });

  describe('persistence', () => {
    afterEach(() => localStorage.removeItem(LS.BOTTOM_NAV_SLOT));

    it('round-trips the choice through localStorage', () => {
      expect(readStoredBottomNavSlot()).toBeNull();
      writeStoredBottomNavSlot('inbox');
      expect(localStorage.getItem(LS.BOTTOM_NAV_SLOT)).toBe('inbox');
      expect(readStoredBottomNavSlot()).toBe('inbox');
    });

    it('survives storage that throws', () => {
      spyOn(Storage.prototype, 'getItem').and.throwError('denied');
      spyOn(Storage.prototype, 'setItem').and.throwError('denied');
      expect(readStoredBottomNavSlot()).toBeNull();
      expect(() => writeStoredBottomNavSlot('inbox')).not.toThrow();
    });
  });
});
