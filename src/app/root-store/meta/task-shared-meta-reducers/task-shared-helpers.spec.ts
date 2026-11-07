import { Action } from '@ngrx/store';
import { RootState } from '../../root-state';
import { ActionHandlerMap, createActionHandlerMetaReducer } from './task-shared-helpers';

describe('createActionHandlerMetaReducer', () => {
  const state = { marker: 'before' } as unknown as RootState;
  const handled: Action = { type: 'handled' };
  const unhandled: Action = { type: 'unhandled' };

  it('sends a falsy state straight to the inner reducer', () => {
    const createActionHandlers = jasmine.createSpy('createActionHandlers');
    const inner = jasmine.createSpy('inner').and.returnValue('result');

    const result = createActionHandlerMetaReducer(createActionHandlers)(inner)(
      undefined,
      handled,
    );

    expect(result).toBe('result');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.calls.mostRecent().args[0]).toBeUndefined();
    expect(inner.calls.mostRecent().args[1]).toBe(handled);
    expect(createActionHandlers).not.toHaveBeenCalled();
  });

  it('runs the handler for the action type on the state', () => {
    const next = { marker: 'after' } as unknown as RootState;
    const handler = jasmine.createSpy('handler').and.returnValue(next);
    const inner = jasmine.createSpy('inner').and.returnValue('result');

    const result = createActionHandlerMetaReducer(
      (): ActionHandlerMap => ({ [handled.type]: handler }),
    )(inner)(state, handled);

    expect(result).toBe('result');
    expect(handler).toHaveBeenCalledOnceWith(state);
    expect(inner.calls.mostRecent().args[0]).toBe(next);
  });

  it('passes the same state on when no handler matches', () => {
    const inner = jasmine.createSpy('inner');

    createActionHandlerMetaReducer((): ActionHandlerMap => ({}))(inner)(state, unhandled);

    expect(inner.calls.mostRecent().args[0]).toBe(state);
  });

  it('gives the same action to the factory and the inner reducer', () => {
    const createActionHandlers = jasmine
      .createSpy('createActionHandlers')
      .and.returnValue({});
    const inner = jasmine.createSpy('inner');

    createActionHandlerMetaReducer(createActionHandlers)(inner)(state, unhandled);

    expect(createActionHandlers).toHaveBeenCalledTimes(1);
    expect(createActionHandlers.calls.mostRecent().args[0]).toBe(state);
    expect(createActionHandlers.calls.mostRecent().args[1]).toBe(unhandled);
    expect(inner.calls.mostRecent().args[1]).toBe(unhandled);
  });

  it('runs the factory, then the handler, then the inner reducer', () => {
    const calls: string[] = [];

    createActionHandlerMetaReducer((): ActionHandlerMap => {
      calls.push('factory');
      return {
        [handled.type]: (s) => {
          calls.push('handler');
          return s;
        },
      };
    })((s) => {
      calls.push('inner');
      return s;
    })(state, handled);

    expect(calls).toEqual(['factory', 'handler', 'inner']);
  });
});
