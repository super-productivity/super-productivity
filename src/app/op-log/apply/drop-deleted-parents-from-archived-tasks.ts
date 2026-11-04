import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';

/** Ids of the parents that exist on this client after the batch's reducers. */
export interface ExistingArchiveParents {
  tagIds: Set<string>;
  projectIds: Set<string>;
}

const hasMissingTag = (
  task: Task | undefined,
  existing: ExistingArchiveParents,
): boolean => !!task && (task.tagIds ?? []).some((id) => !existing.tagIds.has(id));

const hasMissingProject = (
  task: Task | undefined,
  existing: ExistingArchiveParents,
): boolean => !!task?.projectId && !existing.projectIds.has(task.projectId);

const keepExistingTags = <T extends Task>(
  task: T,
  existing: ExistingArchiveParents,
): T =>
  hasMissingTag(task, existing)
    ? { ...task, tagIds: task.tagIds.filter((id) => existing.tagIds.has(id)) }
    : task;

/**
 * Removes references to parents deleted locally from the tasks of a remote
 * moveToArchive, before they are written to the archive.
 *
 * A tag or project deleted here, concurrently with the archive on another
 * client, has already run its archive cleanup before the archived task
 * arrives, so the incoming copy would keep the deleted reference for good. The
 * archiving client runs that cleanup when the delete reaches it; this gives the
 * same result on the deleting client, whichever op arrives first:
 *
 * - **Tags (#11466)** mirror `removeTagsFromAllTasks`: deleted tag ids are
 *   removed, the task is kept. That cleanup checks orphans on the archive as
 *   loaded before the removal, so a task left without project, tag and parent
 *   stays archived with no tags there too; keeping it loses no content.
 * - **Projects (#11486)** mirror `removeAllArchiveTasksForProject`: a task
 *   whose project is gone is dropped, with its subtasks. Project deletes win
 *   (`isProjectDeleteWinsOperation`), so the project cannot come back. A live
 *   task never points at a missing project (data repair moves it to INBOX,
 *   which always exists), and a project created in the same batch already
 *   exists here, so a missing project means it was deleted.
 *
 * Malformed entries are passed through for sanitizeTasksForArchiving.
 */
export const dropDeletedParentsFromArchivedTasks = (
  tasks: TaskWithSubTasks[],
  existing: ExistingArchiveParents,
): TaskWithSubTasks[] =>
  tasks
    .filter((task) => !hasMissingProject(task, existing))
    .map((task) => {
      const subTasks = task?.subTasks ?? [];
      if (
        !hasMissingTag(task, existing) &&
        !subTasks.some(
          (st) => hasMissingTag(st, existing) || hasMissingProject(st, existing),
        )
      ) {
        // Nothing deleted here.
        return task;
      }
      const keptSubTasks = subTasks
        .filter((st) => !hasMissingProject(st, existing))
        .map((st) => (st ? keepExistingTags(st, existing) : st));
      const droppedSubTaskIds = new Set(
        subTasks.filter((st) => hasMissingProject(st, existing)).map((st) => st.id),
      );
      return {
        ...keepExistingTags(task, existing),
        subTasks: keptSubTasks,
        ...(droppedSubTaskIds.size
          ? {
              subTaskIds: (task.subTaskIds ?? []).filter(
                (id) => !droppedSubTaskIds.has(id),
              ),
            }
          : {}),
      };
    });
