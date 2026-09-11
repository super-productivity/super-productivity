import { FormlyFieldConfig } from '@ngx-formly/core';
import { GenericConfigFormSection } from './global-config.model';
import { T } from '../../t.const';

/** A single search hit — everything needed to render the row and jump to it. */
export interface SettingsSearchTarget {
  labelKey: string;
  tabLabelKey: string;
  tabIndex: number;
  /** CSS selector of the element to scroll to, scoped to the config page. */
  scrollSelector: string;
  /** Set for collapsible sections — the key to expand on arrival. */
  sectionKey?: string;
  /** Translation key of the field label that matched, when it wasn't the title. */
  matchedLabelKey?: string;
}

/** Tab order must mirror the `mat-tab-group` in `config-page.component.html`. */
export interface SettingsSearchTab {
  labelKey: string;
  sections: readonly GenericConfigFormSection[];
}

/**
 * Settings that aren't formly sections (bespoke components with no `items` to
 * filter), so they can only be found via a hand-written entry. Anything added
 * to the config page that isn't a `config-section` needs a row here or it stays
 * unsearchable.
 */
const CUSTOM_TARGETS: readonly SettingsSearchTarget[] = [
  {
    labelKey: T.GCF.MISC.DARK_MODE,
    tabLabelKey: T.PS.TABS.GENERAL,
    tabIndex: 0,
    scrollSelector: '.dark-mode-select',
  },
  {
    labelKey: T.GCF.MISC.THEME_EXPERIMENTAL,
    tabLabelKey: T.PS.TABS.GENERAL,
    tabIndex: 0,
    scrollSelector: '.theme-select',
  },
  {
    labelKey: T.GCF.MISC.WALLPAPER,
    tabLabelKey: T.PS.TABS.GENERAL,
    tabIndex: 0,
    scrollSelector: '.wallpaper-select',
  },
  {
    labelKey: T.GCF.SOUND.TITLE,
    tabLabelKey: T.PS.TABS.TASKS,
    tabIndex: 1,
    scrollSelector: '.sound-section',
  },
  {
    labelKey: T.PS.PLUGINS,
    tabLabelKey: T.PS.TABS.PLUGINS,
    tabIndex: 4,
    scrollSelector: '.plugin-section',
  },
  {
    labelKey: T.PS.SYNC.SET_UP_SYNC,
    tabLabelKey: T.PS.TABS.SYNC_BACKUP,
    tabIndex: 5,
    scrollSelector: '.sync-summary',
  },
];

/** Every field of a section, with `fieldGroup` wrappers (sync providers) flattened out. */
const _allFields = (fields: FormlyFieldConfig[] = []): FormlyFieldConfig[] =>
  fields.flatMap((field) => [field, ..._allFields(field.fieldGroup)]);

/**
 * Turns a query into a flat, jump-to-able list of settings across every tab.
 *
 * Matching a tab's own name returns all of that tab's sections, so "time
 * tracking" lists the whole tab rather than a single section.
 */
export const searchSettings = (
  tabs: readonly SettingsSearchTab[],
  query: string,
  translate: (key: string) => string,
): SettingsSearchTarget[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const has = (key?: string): boolean =>
    !!key && translate(key).toLowerCase().includes(q);

  return tabs.flatMap((tab, tabIndex) => {
    const isTabMatch = has(tab.labelKey);
    const sectionTargets = tab.sections.flatMap((section) => {
      const matchedLabelKey = _allFields(section.items)
        // `props` is the modern name, `templateOptions` the legacy alias — both
        // are in use across the config sections.
        .map((field) => (field.props ?? field.templateOptions)?.label)
        .find((val: unknown): val is string => typeof val === 'string' && has(val));
      const isMatch = isTabMatch || has(section.title) || has(section.help);
      if (!isMatch && !matchedLabelKey) {
        return [];
      }
      return [
        {
          labelKey: section.title,
          tabLabelKey: tab.labelKey,
          tabIndex,
          scrollSelector: `.section-${section.key}`,
          sectionKey: section.key,
          // Only worth showing when the title itself didn't match.
          ...(isMatch ? {} : { matchedLabelKey }),
        },
      ];
    });

    return [
      ...CUSTOM_TARGETS.filter(
        (target) => target.tabIndex === tabIndex && (isTabMatch || has(target.labelKey)),
      ),
      ...sectionTargets,
    ];
  });
};
