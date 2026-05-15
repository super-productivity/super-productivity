import { actionLoggerReducer } from './action-logger.reducer';
import { Log } from '../../core/log';
import { ActionReducer, Action } from '@ngrx/store';

describe('actionLoggerReducer', () => {
  const passThrough: ActionReducer<unknown, Action> = (state) => state;

  beforeEach(() => {
    Log.clearLogHistory();
  });

  afterEach(() => {
    Log.clearLogHistory();
  });

  it('does not record action payloads (user content) into the exportable log history', () => {
    const wrapped = actionLoggerReducer(passThrough);
    const SECRET_TITLE = 'My very secret task title 12345';

    // NgRx prop actions spread payload onto the action object (no `.payload`),
    // so the reducer previously serialized the whole action — including titles.
    wrapped({}, {
      type: '[Task] Update Task',
      task: { id: 'abc', changes: { title: SECRET_TITLE } },
    } as unknown as Action);

    expect(Log.exportLogHistory()).not.toContain(SECRET_TITLE);
  });

  it('does not record legacy `.payload`-style action payloads either', () => {
    const wrapped = actionLoggerReducer(passThrough);
    const SECRET_NOTE = 'Confidential note body 67890';

    // The pre-fix reducer logged `action.payload` when present.
    wrapped({}, {
      type: '[Task] Update Task',
      payload: { task: { id: 'abc', notes: SECRET_NOTE } },
    } as unknown as Action);

    expect(Log.exportLogHistory()).not.toContain(SECRET_NOTE);
  });

  it('still records the action type for diagnostics', () => {
    const wrapped = actionLoggerReducer(passThrough);

    wrapped({}, { type: '[Task] Update Task' } as Action);

    expect(Log.exportLogHistory()).toContain('[Task] Update Task');
  });

  it('passes state through to the wrapped reducer unchanged', () => {
    const reducer: ActionReducer<{ n: number }, Action> = (state, action) =>
      action.type === 'inc' ? { n: (state?.n ?? 0) + 1 } : (state ?? { n: 0 });
    const wrapped = actionLoggerReducer(reducer);

    expect(wrapped({ n: 1 }, { type: 'inc' } as Action)).toEqual({ n: 2 });
  });
});
