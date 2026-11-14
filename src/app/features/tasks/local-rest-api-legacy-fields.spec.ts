import { mapLegacyPlannedAt } from './local-rest-api-legacy-fields';

describe('mapLegacyPlannedAt', () => {
  it('maps plannedAt to dueWithTime when dueWithTime is absent', () => {
    const result = mapLegacyPlannedAt({ plannedAt: 1000, title: 't' });
    expect(result).toEqual(
      jasmine.objectContaining({
        dueWithTime: 1000,
        title: 't',
      }),
    );
    expect('plannedAt' in result).toBe(false);
  });

  it('prefers dueWithTime over plannedAt', () => {
    const result = mapLegacyPlannedAt({ plannedAt: 1000, dueWithTime: 2000 });
    expect(result.dueWithTime).toBe(2000);
    expect('plannedAt' in result).toBe(false);
  });

  // #11263: dual due fields from calendar-style POSTs must not both survive.
  it('drops dueDay when dueWithTime is set', () => {
    const result = mapLegacyPlannedAt({
      dueDay: '2026-11-02',
      dueWithTime: 1793607300000,
      title: '组会',
    });
    expect(result.dueWithTime).toBe(1793607300000);
    expect(result.title).toBe('组会');
    expect('dueDay' in result).toBe(false);
  });

  it('keeps dueDay when there is no dueWithTime', () => {
    expect(mapLegacyPlannedAt({ dueDay: '2026-11-02' }).dueDay).toBe('2026-11-02');
  });
});
