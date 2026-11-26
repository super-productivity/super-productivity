import { caldavUidToTaskId, taskIdToCaldavUid } from './caldav-uid.util';

describe('caldav-uid.util', () => {
  it('round-trips a task id', () => {
    expect(caldavUidToTaskId(taskIdToCaldavUid('aB3_x-9'))).toBe('aB3_x-9');
  });

  it('returns null for VTODOs Super Productivity did not create', () => {
    expect(caldavUidToTaskId('20261020T101010Z-1234@nextcloud')).toBeNull();
    expect(caldavUidToTaskId('sp-only-prefix')).toBeNull();
    expect(caldavUidToTaskId('sp-todo-@super-productivity')).toBeNull();
  });

  // The CalDAV Events plugin's time blocks can share the calendar; reading one
  // as a created VTODO would hide or overwrite the wrong object.
  it('does not claim the CalDAV Events plugin time-block UIDs', () => {
    expect(caldavUidToTaskId('sp-task-1@super-productivity')).toBeNull();
    expect(taskIdToCaldavUid('task-1')).not.toBe('sp-task-1@super-productivity');
  });
});
