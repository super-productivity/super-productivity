/* eslint-disable @typescript-eslint/naming-convention */
// Verifies: when post-sync validation finds a null timeSpentOnDay day-bucket,
// the auto-fix sets it to 0 (data loss).
import { autoFixTypiaErrors } from './auto-fix-typia-errors';
import type { IValidation } from 'typia';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';
import { _resetDevErrorState } from '../../util/dev-error';

const createTypiaError = (
  path: string,
  expected: string,
  value?: unknown,
): IValidation.IError => ({ path, expected, value }) as IValidation.IError;

describe('auto-fix data-loss for timeSpentOnDay nulls', () => {
  beforeEach(() => {
    _resetDevErrorState();
    spyOn(OP_LOG_SYNC_LOGGER, 'err').and.stub();
    spyOn(OP_LOG_SYNC_LOGGER, 'warn').and.stub();
    // devError raises an alert+confirm in non-prod; stub defensively because
    // a global test setup may already have spied on these.
    if (jasmine.isSpy(window.alert)) {
      (window.alert as jasmine.Spy).and.stub();
    } else {
      spyOn(window, 'alert').and.stub();
    }
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(false);
    } else {
      spyOn(window, 'confirm').and.returnValue(false);
    }
  });

  it('PROBE: null in task.timeSpentOnDay[date] is set to 0 (DATA LOSS)', () => {
    const data = {
      task: {
        ids: ['t1'],
        entities: {
          t1: {
            id: 't1',
            timeSpentOnDay: {
              '2026-05-20': 5000,
              '2026-05-21': null, // pre-corruption (originated as NaN, serialized to null)
            },
          },
        },
      },
    } as any;

    const result: any = autoFixTypiaErrors(data, [
      createTypiaError(
        '$input.task.entities.t1.timeSpentOnDay.2026-05-21',
        'number',
        null,
      ),
    ]);

    const v = result.task.entities.t1.timeSpentOnDay['2026-05-21'];
    console.log('auto-fix result:', v);
    expect(v).toBe(0);
    // the good day survives
    expect(result.task.entities.t1.timeSpentOnDay['2026-05-20']).toBe(5000);
  });

  it('PROBE: null in task.timeSpent (total) is set to 0', () => {
    const data = {
      task: {
        ids: ['t1'],
        entities: {
          t1: { id: 't1', timeSpent: null },
        },
      },
    } as any;
    const result: any = autoFixTypiaErrors(data, [
      createTypiaError('$input.task.entities.t1.timeSpent', 'number', null),
    ]);
    expect(result.task.entities.t1.timeSpent).toBe(0);
  });

  it('PROBE: null in task.timeEstimate is set to 0', () => {
    const data = {
      task: {
        ids: ['t1'],
        entities: { t1: { id: 't1', timeEstimate: null } },
      },
    } as any;
    const result: any = autoFixTypiaErrors(data, [
      createTypiaError('$input.task.entities.t1.timeEstimate', 'number', null),
    ]);
    expect(result.task.entities.t1.timeEstimate).toBe(0);
  });

  it('CONFIRM: this is exactly the path that fires for 4-errors-typeErrorsFixed', () => {
    // Simulates the user's report: 4 typia errors all on task number fields.
    const data = {
      task: {
        ids: ['t1', 't2'],
        entities: {
          t1: {
            id: 't1',
            timeSpentOnDay: {
              '2026-05-19': 3600000,
              '2026-05-20': null,
              '2026-05-21': null,
            },
            timeSpent: null,
          },
          t2: {
            id: 't2',
            timeSpentOnDay: { '2026-05-21': null },
          },
        },
      },
    } as any;
    const errors = [
      createTypiaError(
        '$input.task.entities.t1.timeSpentOnDay.2026-05-20',
        'number',
        null,
      ),
      createTypiaError(
        '$input.task.entities.t1.timeSpentOnDay.2026-05-21',
        'number',
        null,
      ),
      createTypiaError('$input.task.entities.t1.timeSpent', 'number', null),
      createTypiaError(
        '$input.task.entities.t2.timeSpentOnDay.2026-05-21',
        'number',
        null,
      ),
    ];
    const result: any = autoFixTypiaErrors(data, errors);
    console.log('4-error result:', JSON.stringify(result, null, 2));
    expect(result.task.entities.t1.timeSpentOnDay['2026-05-20']).toBe(0);
    expect(result.task.entities.t1.timeSpentOnDay['2026-05-21']).toBe(0);
    expect(result.task.entities.t1.timeSpent).toBe(0);
    expect(result.task.entities.t2.timeSpentOnDay['2026-05-21']).toBe(0);
    // The "good" day from t1 survives
    expect(result.task.entities.t1.timeSpentOnDay['2026-05-19']).toBe(3600000);
  });
});
