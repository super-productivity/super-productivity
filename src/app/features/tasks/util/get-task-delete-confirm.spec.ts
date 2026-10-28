import { T } from '../../../t.const';
import { PLAINSPACE_TYPE } from '../../issue/issue.const';
import {
  getTaskDeleteConfirmData,
  isTaskDeleteConfirmRequired,
} from './get-task-delete-confirm';

describe('get-task-delete-confirm', () => {
  const localTask = { title: 'Local', issueType: undefined };
  const plainspaceTask = { title: 'Shared', issueType: PLAINSPACE_TYPE };

  it('follows the setting for a local task', () => {
    expect(isTaskDeleteConfirmRequired(localTask, true)).toBe(true);
    expect(isTaskDeleteConfirmRequired(localTask, false)).toBe(false);
  });

  it('always confirms a Plainspace task, since it is deleted for the whole Space', () => {
    expect(isTaskDeleteConfirmRequired(plainspaceTask, true)).toBe(true);
    expect(isTaskDeleteConfirmRequired(plainspaceTask, false)).toBe(true);
  });

  it('uses the plain message for a local task', () => {
    expect(getTaskDeleteConfirmData(localTask)).toEqual({
      okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
      message: T.F.TASK.D_CONFIRM_DELETE.MSG,
      isFocusConfirm: true,
      translateParams: { title: 'Local' },
    });
  });

  it('warns that a Plainspace task is deleted for everyone', () => {
    expect(getTaskDeleteConfirmData(plainspaceTask).message).toBe(
      T.F.TASK.D_CONFIRM_DELETE.MSG_PLAINSPACE,
    );
  });

  it('accepts a display title override (e.g. truncated)', () => {
    expect(getTaskDeleteConfirmData(plainspaceTask, 'Sh…').translateParams).toEqual({
      title: 'Sh…',
    });
  });

  it('treats a task Plainspace no longer lists for me like a local one', () => {
    expect(isTaskDeleteConfirmRequired(plainspaceTask, false, true)).toBe(false);
    expect(isTaskDeleteConfirmRequired(plainspaceTask, true, true)).toBe(true);
    expect(getTaskDeleteConfirmData(plainspaceTask, 'Shared', true).message).toBe(
      T.F.TASK.D_CONFIRM_DELETE.MSG,
    );
  });
});
