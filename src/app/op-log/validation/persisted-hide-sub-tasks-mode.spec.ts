import {
  addTaskToAppData,
  createValidAppData,
  createValidTask,
  validateAppData,
} from './state-validity-test-utils';
import { HideSubTasksMode } from '../../features/tasks/task.model';

/**
 * Guards the backward-compat invariant documented on PersistedHideSubTasksMode
 * (task.model.ts): persisted Task state must stay within
 * {undefined, HideDone, HideAll}. Old clients' typia validators reject an
 * explicit Show (0) in state as corruption, so OUR validators must keep
 * rejecting it too — otherwise a stray 0 (e.g. via a plugin update or a
 * future reducer) would pass locally, sync, and break old clients.
 *
 * If this spec fails because the model type was widened: do NOT widen the
 * validator. Route the new value through an action payload instead (see
 * setHideSubTasksMode) and normalize before state.
 */
describe('typia state validation of _hideSubTasksMode (backward-compat invariant)', () => {
  const mkData = (hideMode: unknown): ReturnType<typeof createValidAppData> => {
    const task = createValidTask('t1');
    (task as Record<string, unknown>)._hideSubTasksMode = hideMode;
    return addTaskToAppData(createValidAppData(), task);
  };

  it('accepts undefined, HideDone and HideAll in state', () => {
    expect(validateAppData(mkData(undefined)).isValid).toBe(true);
    expect(validateAppData(mkData(HideSubTasksMode.HideDone)).isValid).toBe(true);
    expect(validateAppData(mkData(HideSubTasksMode.HideAll)).isValid).toBe(true);
  });

  it('rejects an explicit Show (0) in state', () => {
    expect(validateAppData(mkData(0)).isValid).toBe(false);
  });

  it('rejects out-of-range and wrong-type values in state', () => {
    expect(validateAppData(mkData(3)).isValid).toBe(false);
    expect(validateAppData(mkData('1')).isValid).toBe(false);
  });
});
