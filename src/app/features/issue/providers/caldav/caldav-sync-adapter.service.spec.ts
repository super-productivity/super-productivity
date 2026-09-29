import { TestBed } from '@angular/core/testing';
import { CaldavSyncAdapterService } from './caldav-sync-adapter.service';
import { CaldavClientService } from './caldav-client.service';
import { CaldavCfg } from './caldav.model';
import { DEFAULT_CALDAV_CFG } from './caldav.const';
import { computePushDecisions } from '../../two-way-sync/compute-push-decisions';

const NOON_UTC = Date.UTC(2026, 8, 25, 12, 0, 0);

describe('CaldavSyncAdapterService dates', () => {
  let adapter: CaldavSyncAdapterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CaldavSyncAdapterService,
        { provide: CaldavClientService, useValue: {} },
      ],
    });
    adapter = TestBed.inject(CaldavSyncAdapterService);
  });

  it('extracts canonical dtstart/due, null when absent', () => {
    expect(
      adapter.extractSyncValues({
        start: new Date(2026, 8, 25).getTime(),
        isAllDay: true,
        due: NOON_UTC + 500,
        isDueAllDay: false,
      }),
    ).toEqual(jasmine.objectContaining({ dtstart: '2026-09-25', due: NOON_UTC }));
    expect(adapter.extractSyncValues({})).toEqual(
      jasmine.objectContaining({ dtstart: null, due: null }),
    );
  });

  it('fans one setting out to both task fields of its date', () => {
    const cfg = {
      twoWaySync: { plannedDate: 'both', deadline: 'pushOnly' },
    } as CaldavCfg;
    expect(adapter.getSyncConfig(cfg)).toEqual(
      jasmine.objectContaining({
        dueDay: 'both',
        dueWithTime: 'both',
        deadlineDay: 'pushOnly',
        deadlineWithTime: 'pushOnly',
      }),
    );
  });

  it('defaults every date mapping to pullOnly, matching DEFAULT_CALDAV_CFG', () => {
    const dateMappings = adapter
      .getFieldMappings()
      .filter((m) => ['dtstart', 'due'].includes(m.issueField));
    expect(dateMappings.map((m) => m.taskField).sort()).toEqual([
      'deadlineDay',
      'deadlineWithTime',
      'dueDay',
      'dueWithTime',
    ]);
    expect(dateMappings.every((m) => m.defaultDirection === 'pullOnly')).toBeTrue();
    expect(DEFAULT_CALDAV_CFG.twoWaySync?.plannedDate).toBe('pullOnly');
    expect(DEFAULT_CALDAV_CFG.twoWaySync?.deadline).toBe('pullOnly');
  });

  it('pushes nothing for dates by default', () => {
    const decisions = computePushDecisions(
      { dueDay: '2026-09-25' },
      adapter.getFieldMappings(),
      adapter.getSyncConfig({ twoWaySync: DEFAULT_CALDAV_CFG.twoWaySync } as CaldavCfg),
      { dtstart: null },
      { dtstart: null },
      { issueId: 'u1' },
    );
    expect(decisions.every((d) => d.action === 'skip')).toBeTrue();
  });

  it('round trip: all-day and timed values push as canonical values and read back equal', () => {
    const cfg = { twoWaySync: { plannedDate: 'both', deadline: 'both' } } as CaldavCfg;
    const push = (changes: Record<string, unknown>): unknown[] =>
      computePushDecisions(
        changes,
        adapter.getFieldMappings(),
        adapter.getSyncConfig(cfg),
        { dtstart: null, due: null },
        { dtstart: null, due: null },
        { issueId: 'u1' },
      ).map((d) => [d.field, d.action, d.issueValue]);

    expect(push({ dueDay: '2026-09-25' })).toEqual([['dtstart', 'push', '2026-09-25']]);
    expect(push({ deadlineWithTime: NOON_UTC + 789 })).toEqual([
      ['due', 'push', NOON_UTC],
    ]);
    // The value we push is what extractSyncValues reads back after the server stores it.
    expect(adapter.extractSyncValues({ due: NOON_UTC, isDueAllDay: false })['due']).toBe(
      NOON_UTC,
    );
  });

  it('clears push as null (never undefined)', () => {
    const cfg = { twoWaySync: { plannedDate: 'both', deadline: 'both' } } as CaldavCfg;
    const decisions = computePushDecisions(
      { deadlineDay: undefined, deadlineWithTime: undefined },
      adapter.getFieldMappings(),
      adapter.getSyncConfig(cfg),
      { due: '2026-09-30' },
      { due: '2026-09-30' },
      { issueId: 'u1' },
    );
    expect(decisions.map((d) => [d.field, d.action, d.issueValue])).toEqual([
      ['due', 'push', null],
    ]);
  });

  it('links the four date fields so a held-back date is re-sent with its partner', () => {
    const dateMappings = adapter
      .getFieldMappings()
      .filter((m) => ['dtstart', 'due'].includes(m.issueField));
    for (const m of dateMappings) {
      expect([...(m.pushTogetherWith ?? [])].sort()).toEqual([
        'deadlineDay',
        'deadlineWithTime',
        'dueDay',
        'dueWithTime',
      ]);
    }
    expect(
      adapter
        .getFieldMappings()
        .filter((m) => !['dtstart', 'due'].includes(m.issueField))
        .every((m) => m.pushTogetherWith === undefined),
    ).toBeTrue();
  });
});
