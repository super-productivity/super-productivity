import { T } from '../../../t.const';
import { PLAINSPACE_TYPE } from '../../issue/issue.const';
import { Task } from '../task.model';

type DeleteConfirmTask = Pick<Task, 'title' | 'issueType'>;

/**
 * Deleting a Plainspace task deletes it for everyone in its Space, so it
 * always confirms, even with `isConfirmBeforeDelete` off (the same as a bulk
 * delete). A task Plainspace no longer lists for me (`isNoLongerListed`, from
 * the last successful poll) is not mine to delete there: the server refuses,
 * so it is deleted locally like any other task.
 */
export const isTaskDeleteConfirmRequired = (
  task: DeleteConfirmTask,
  isConfirmBeforeDelete: boolean,
  isNoLongerListed = false,
): boolean =>
  isConfirmBeforeDelete || (task.issueType === PLAINSPACE_TYPE && !isNoLongerListed);

/** Confirm-dialog data for deleting a single task. */
export const getTaskDeleteConfirmData = (
  task: DeleteConfirmTask,
  title: string = task.title,
  isNoLongerListed = false,
): {
  okTxt: string;
  message: string;
  isFocusConfirm: boolean;
  translateParams: { title: string };
} => ({
  okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
  message:
    task.issueType === PLAINSPACE_TYPE && !isNoLongerListed
      ? T.F.TASK.D_CONFIRM_DELETE.MSG_PLAINSPACE
      : T.F.TASK.D_CONFIRM_DELETE.MSG,
  isFocusConfirm: true,
  translateParams: { title },
});
