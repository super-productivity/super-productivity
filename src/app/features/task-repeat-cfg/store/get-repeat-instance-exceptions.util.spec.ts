import {
  findRepeatInstanceOverride,
  getRepeatInstanceExceptions,
} from './get-repeat-instance-exceptions.util';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';

const cfg = (partial: Partial<TaskRepeatCfg>): TaskRepeatCfg => partial as TaskRepeatCfg;

describe('getRepeatInstanceExceptions', () => {
  it('maps skips to exdates', () => {
    expect(
      getRepeatInstanceExceptions(cfg({ deletedInstanceDates: ['2026-08-01'] })),
    ).toEqual({ exdates: ['2026-08-01'], rdates: [] });
  });

  it('maps a move to exdate(original) + rdate(movedToDay)', () => {
    expect(
      getRepeatInstanceExceptions(
        cfg({ instanceOverrides: { '2026-08-05': { movedToDay: '2026-08-08' } } }),
      ),
    ).toEqual({ exdates: ['2026-08-05'], rdates: ['2026-08-08'] });
  });

  it('combines skips and moves', () => {
    const r = getRepeatInstanceExceptions(
      cfg({
        deletedInstanceDates: ['2026-08-01'],
        instanceOverrides: { '2026-08-05': { movedToDay: '2026-08-08' } },
      }),
    );
    expect(r.exdates.sort()).toEqual(['2026-08-01', '2026-08-05']);
    expect(r.rdates).toEqual(['2026-08-08']);
  });

  it('ignores a field-only override (no movedToDay) for the occurrence set', () => {
    expect(
      getRepeatInstanceExceptions(
        cfg({ instanceOverrides: { '2026-08-05': { title: 'X' } } }),
      ),
    ).toEqual({ exdates: [], rdates: [] });
  });

  it('ignores a self-move (movedToDay === original)', () => {
    expect(
      getRepeatInstanceExceptions(
        cfg({
          instanceOverrides: { '2026-08-05': { movedToDay: '2026-08-05', title: 'X' } },
        }),
      ),
    ).toEqual({ exdates: [], rdates: [] });
  });
});

describe('findRepeatInstanceOverride', () => {
  it('finds a field-only override at that day', () => {
    expect(
      findRepeatInstanceOverride(
        cfg({ instanceOverrides: { '2026-08-05': { title: 'X' } } }),
        '2026-08-05',
      ),
    ).toEqual({ title: 'X' });
  });

  it('finds a move by its target (moved-to) day', () => {
    expect(
      findRepeatInstanceOverride(
        cfg({
          instanceOverrides: { '2026-08-05': { movedToDay: '2026-08-08', title: 'X' } },
        }),
        '2026-08-08',
      ),
    ).toEqual({ movedToDay: '2026-08-08', title: 'X' });
  });

  it('does not match the moved-from (original) day', () => {
    expect(
      findRepeatInstanceOverride(
        cfg({ instanceOverrides: { '2026-08-05': { movedToDay: '2026-08-08' } } }),
        '2026-08-05',
      ),
    ).toBeUndefined();
  });

  it('returns undefined when there is no override', () => {
    expect(findRepeatInstanceOverride(cfg({}), '2026-08-05')).toBeUndefined();
  });
});
