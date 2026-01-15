/* eslint-disable @typescript-eslint/naming-convention */
import {
  isEntityStateConsistent,
  fixEntityStateConsistency,
  fixEntityStateConsistencyOrError,
} from './check-fix-entity-state-consistency';
import { Log } from '../core/log';

describe('check-fix-entity-state-consistency', () => {
  let logLogSpy: jasmine.Spy;
  let logErrSpy: jasmine.Spy;
  let alertSpy: jasmine.Spy;
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    // Spy on Log methods
    if (jasmine.isSpy(Log.log)) {
      logLogSpy = Log.log as unknown as jasmine.Spy;
      logLogSpy.calls.reset();
      logLogSpy.and.stub();
    } else {
      logLogSpy = spyOn(Log, 'log').and.stub();
    }

    if (jasmine.isSpy(Log.err)) {
      logErrSpy = Log.err as unknown as jasmine.Spy;
      logErrSpy.calls.reset();
      logErrSpy.and.stub();
    } else {
      logErrSpy = spyOn(Log, 'err').and.stub();
    }

    // Spy on globals used by devError
    if (jasmine.isSpy(window.alert)) {
      alertSpy = window.alert as unknown as jasmine.Spy;
      alertSpy.calls.reset();
      alertSpy.and.stub();
    } else {
      alertSpy = spyOn(window, 'alert').and.stub();
    }

    if (jasmine.isSpy(window.confirm)) {
      confirmSpy = window.confirm as unknown as jasmine.Spy;
      confirmSpy.calls.reset();
      confirmSpy.and.returnValue(false);
    } else {
      confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    }
  });

  describe('isEntityStateConsistent', () => {
    it('should return true for consistent state', () => {
      const state = {
        ids: ['1', '2'],
        entities: {
          1: { id: '1' },
          2: { id: '2' },
        },
      };
      expect(isEntityStateConsistent(state)).toBeTrue();
      expect(logLogSpy).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('should return false if data is missing', () => {
      expect(isEntityStateConsistent(null as any)).toBeFalse();
      expect(logLogSpy).toHaveBeenCalledWith(null);
    });

    it('should return false if entities are missing', () => {
      const state = { ids: ['1'] } as any;
      expect(isEntityStateConsistent(state)).toBeFalse();
      expect(logLogSpy).toHaveBeenCalledWith(state);
    });

    it('should return false if ids are missing', () => {
      const state = { entities: { 1: {} } } as any;
      expect(isEntityStateConsistent(state)).toBeFalse();
      expect(logLogSpy).toHaveBeenCalledWith(state);
    });

    it('should return false if lengths do not match', () => {
      const state = {
        ids: ['1'],
        entities: {
          1: { id: '1' },
          2: { id: '2' },
        },
      };
      expect(isEntityStateConsistent(state)).toBeFalse();
      expect(logLogSpy).toHaveBeenCalledWith(state);
    });

    it('should return false if ids do not match entities keys', () => {
      const state = {
        ids: ['1'],
        entities: {
          2: { id: '2' },
        },
      };
      expect(isEntityStateConsistent(state)).toBeFalse();
      expect(logLogSpy).toHaveBeenCalledWith(state);
    });
  });

  describe('fixEntityStateConsistency', () => {
    it('should return data as is if consistent', () => {
      const state = {
        ids: ['1'],
        entities: { 1: { id: '1' } },
      };
      const result = fixEntityStateConsistency(state);
      expect(result).toEqual(state);
      expect(logErrSpy).not.toHaveBeenCalled();
    });

    it('should fix inconsistency by regenerating ids from entities', () => {
      const state = {
        ids: ['1', '3'], // '3' is ghost, '2' is missing
        entities: {
          1: { id: '1' },
          2: { id: '2' },
        },
      };
      const result = fixEntityStateConsistency(state);

      expect(result.entities).toEqual(state.entities);
      // Object keys order is not guaranteed to be sorted, but usually is for simple keys.
      // We expect '1' and '2' to be present.
      expect(result.ids).toContain('1');
      expect(result.ids).toContain('2');
      expect(result.ids.length).toBe(2);
      expect(logErrSpy).toHaveBeenCalledWith('FIXING ENTITY STATE', jasmine.any(Object));
    });
  });

  describe('fixEntityStateConsistencyOrError', () => {
    it('should fix inconsistency if lengths match but content differs', () => {
      const state = {
        ids: ['1', '3'], // Length 2
        entities: {
          1: { id: '1' }, // Length 2
          2: { id: '2' },
        },
      };
      // Lengths match but content differs. The logic now detects this and fixes it.

      const result = fixEntityStateConsistencyOrError(state);
      expect(result.ids).toContain('1');
      expect(result.ids).toContain('2');
      expect(result.ids.length).toBe(2);
      expect(logLogSpy).toHaveBeenCalled();
    });

    it('should fix inconsistency if lengths differ', () => {
      const state = {
        ids: ['1'],
        entities: {
          1: { id: '1' },
          2: { id: '2' },
        },
      };
      // Lengths differ (1 vs 2)

      const result = fixEntityStateConsistencyOrError(state);
      expect(result.ids.length).toBe(2);
      expect(result.ids).toContain('1');
      expect(result.ids).toContain('2');
      expect(logLogSpy).toHaveBeenCalled();
    });
  });
});
