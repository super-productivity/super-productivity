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
 * Removes references to parents that do not exist locally from the tasks of a
 * remote moveToArchive, before they are written to the archive.
 *
 * Guarantee: an archived copy written here never references a tag or project
 * this client does not have when the op is applied. A tag or project deleted
 * here concurrently with an archive elsewhere has already run its archive
 * cleanup, so the incoming copy used to keep the deleted reference for good,
 * while the archiving client ran that cleanup when the delete reached it. Both
 * clients now end the same way, whichever op arrives first:
 *
 * - **Tags (#11466)** mirror `removeTagsFromAllTasks`: deleted tag ids are
 *   removed, the task is kept. `removeTagsFromAllTasks` checks orphans on the
 *   archive as loaded before the removal, so on the archiving client a task
 *   left without project, tag and parent stays archived with no tags. One
 *   leftover: when the delete follows the archive in the same remote batch, the
 *   delete's cleanup sees the task written here as already orphaned and drops
 *   it, so a legacy task without a project is kept or dropped depending on
 *   batching.
 * - **Projects (#11486)** mirror `removeAllArchiveTasksForProject`: a task
 *   whose project is gone is dropped, with its subtasks. Project deletes win
 *   (`isProjectDeleteWinsOperation`), so the project cannot come back. A live
 *   task never points at a missing project (data repair moves it to INBOX,
 *   which always exists), and a project created in the same batch already
 *   exists here, so a missing project means it was deleted.
 *
 * Not guaranteed for tags: a tag delete is last-write-wins, not delete-wins.
 * If the archiving client renames the tag before it downloads the delete, its
 * update wins and recreates the tag here, but this client's archived copy
 * already lost the id while the archiving client's copy keeps it. Live tasks
 * diverge the same way on master: #11489, pinned in
 * e2e/tests/sync/supersync-tag-delete-rename-race-11489.spec.ts.
 * Tag ids can also come back through the board's "create missing tags" action,
 * which recreates fixed ids (EM_URGENT, EM_IMPORTANT); archived copies scrubbed
 * here stay without them.
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
