import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';

const hasMissingTag = (task: Task | undefined, existing: Set<string>): boolean =>
  !!task && (task.tagIds ?? []).some((id) => !existing.has(id));

const keepExistingTags = <T extends Task>(task: T, existing: Set<string>): T =>
  hasMissingTag(task, existing)
    ? { ...task, tagIds: task.tagIds.filter((id) => existing.has(id)) }
    : task;

/**
 * Removes tag ids that no longer exist locally from the tasks of a remote
 * moveToArchive, before they are written to the archive (#11466).
 *
 * A tag deleted here, concurrently with the archive on another client, has
 * already run its archive cleanup (`removeTagsFromAllTasks`) before the
 * archived task arrives, so the incoming copy would keep the deleted id for
 * good. The archiving client scrubs its copy when the delete reaches it; this
 * gives the same result on the deleting client, whichever op arrives first.
 *
 * Tasks are never dropped here: `removeTagsFromAllTasks` checks orphans on the
 * archive as loaded before the removal, so on the archiving client a task left
 * without project, tag and parent by the delete stays archived with no tags.
 * Keeping it here converges with that and loses no content.
 */
export const dropDeletedTagsFromArchivedTasks = (
  tasks: TaskWithSubTasks[],
  existingTagIds: Set<string>,
): TaskWithSubTasks[] =>
  tasks.map((task) => {
    const subTasks = task?.subTasks ?? [];
    if (
      !hasMissingTag(task, existingTagIds) &&
      !subTasks.some((st) => hasMissingTag(st, existingTagIds))
    ) {
      // Nothing deleted here; malformed entries are left to sanitizeTasksForArchiving.
      return task;
    }
    return {
      ...keepExistingTags(task, existingTagIds),
      subTasks: subTasks.map((st) => (st ? keepExistingTags(st, existingTagIds) : st)),
    };
  });
