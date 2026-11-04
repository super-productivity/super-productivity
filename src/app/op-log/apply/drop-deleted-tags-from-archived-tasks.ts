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
 * Matches that cleanup's orphan rule too: a root task left with no project,
 * no tag and no parent by the removal is dropped with its subtasks, as
 * `removeTagsFromAllTasks` drops it from an existing archive. A task that was
 * already orphaned without losing a tag is kept.
 */
export const dropDeletedTagsFromArchivedTasks = (
  tasks: TaskWithSubTasks[],
  existingTagIds: Set<string>,
): TaskWithSubTasks[] =>
  tasks.flatMap((task) => {
    const subTasks = task?.subTasks ?? [];
    if (
      !hasMissingTag(task, existingTagIds) &&
      !subTasks.some((st) => hasMissingTag(st, existingTagIds))
    ) {
      // Nothing deleted here; malformed entries are left to sanitizeTasksForArchiving.
      return [task];
    }
    const scrubbed = keepExistingTags(task, existingTagIds);
    if (
      scrubbed !== task &&
      !scrubbed.projectId &&
      !scrubbed.tagIds.length &&
      !scrubbed.parentId
    ) {
      return [];
    }
    return [
      {
        ...scrubbed,
        subTasks: subTasks.map((st) => (st ? keepExistingTags(st, existingTagIds) : st)),
      },
    ];
  });
