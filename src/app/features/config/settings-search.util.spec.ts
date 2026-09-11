import { searchSettings, SettingsSearchTab } from './settings-search.util';

// Translation keys are namespaced paths; the fake strips the namespace so the
// assertions read like the English strings users actually type.
const translate = (key: string): string => key.split('.').pop() as string;

const TABS: SettingsSearchTab[] = [
  {
    labelKey: 'PS.TABS.General',
    sections: [
      {
        title: 'GCF.IDLE.Idle handling',
        key: 'idle',
        help: 'GCF.IDLE.Pauses tracking when you step away',
        items: [
          { key: 'minIdleTime', templateOptions: { label: 'GCF.IDLE.Min idle time' } },
          {
            key: 'isOnlyOpenIdleWhenCurrentTask',
            props: { label: 'GCF.IDLE.Only when tracking' },
          },
        ],
      },
    ],
  },
  {
    labelKey: 'PS.TABS.Sync & Backup',
    sections: [
      {
        title: 'GCF.SYNC.Synchronisation',
        key: 'sync',
        items: [
          {
            key: 'webdav',
            fieldGroup: [
              { key: 'baseUrl', templateOptions: { label: 'GCF.SYNC.Server URL' } },
            ],
          },
        ],
      },
    ],
  },
];

describe('searchSettings', () => {
  it('should return nothing for an empty query', () => {
    expect(searchSettings(TABS, '   ', translate)).toEqual([]);
  });

  it('should match a section title, case-insensitively, and point at its tab', () => {
    expect(searchSettings(TABS, 'IDLE HAND', translate)).toEqual([
      {
        labelKey: 'GCF.IDLE.Idle handling',
        tabLabelKey: 'PS.TABS.General',
        tabIndex: 0,
        scrollSelector: '.section-idle',
        sectionKey: 'idle',
      },
    ]);
  });

  it('should match the section help text', () => {
    expect(searchSettings(TABS, 'step away', translate).length).toBe(1);
  });

  it('should report which field label matched', () => {
    const [hit] = searchSettings(TABS, 'min idle', translate);
    expect(hit.matchedLabelKey).toBe('GCF.IDLE.Min idle time');
  });

  it('should match a label declared via the modern `props` API', () => {
    const [hit] = searchSettings(TABS, 'only when tracking', translate);
    expect(hit.matchedLabelKey).toBe('GCF.IDLE.Only when tracking');
  });

  it('should match a label nested inside a fieldGroup', () => {
    const [hit] = searchSettings(TABS, 'server url', translate);
    expect(hit.sectionKey).toBe('sync');
    expect(hit.tabIndex).toBe(1);
  });

  it('should return every section of a tab when the tab name matches', () => {
    const hits = searchSettings(TABS, 'sync & backup', translate);
    const sectionHits = hits.filter((h) => h.sectionKey);
    expect(sectionHits.map((h) => h.sectionKey)).toEqual(['sync']);
    // ...and without a field-level hint, since the tab itself is the match
    expect(sectionHits[0].matchedLabelKey).toBeUndefined();
  });

  it('should find non-formly settings via the hand-written targets', () => {
    const [hit] = searchSettings(TABS, 'wallpaper', translate);
    expect(hit.scrollSelector).toBe('.wallpaper-select');
    expect(hit.tabIndex).toBe(0);
  });

  it('should return an empty array when nothing matches', () => {
    expect(searchSettings(TABS, 'zzz', translate)).toEqual([]);
  });
});
