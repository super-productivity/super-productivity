import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';

const hasMissingTag = (task: Task | undefined, existing: Set<string>): boolean =>
  !!task && (task.tagIds ?? []).some((id) => !existing.has(id));

const keepExistingTags = <T extends Task>(task: T, existing: Set<string>): T =>
  hasMissingTag(task, existing)
    ? { ...task, tagIds: task.tagIds.filter((id) => existing.has(id)) }
    : task;

/**
 * Removes tag ids that do not exist locally from the tasks of a remote
 * moveToArchive, before they are written to the archive (#11466).
 *
 * Guarantee: an archived copy written here never references a tag this client
 * does not have when the op is applied. That closes #11466: a tag deleted here
 * concurrently with an archive elsewhere has already run its archive cleanup
 * (`removeTagsFromAllTasks`), so the incoming copy used to keep the deleted id
 * for good, while the archiving client scrubbed its copy when the delete
 * reached it. Both clients now end with the tag stripped, as long as the
 * delete stays applied everywhere.
 *
 * A marked single-tag delete wins over a concurrent edit of the tag
 * (`tagDeleteWins`, #11489), so the archiving client applies the delete and
 * scrubs its copy too: e2e/tests/sync/supersync-tag-delete-rename-race-11489.spec.ts.
 * Not guaranteed: an unmarked delete (`deleteTags`, a released client, or one
 * stored before #11489) is still last-write-wins. If the archiving client edits
 * the tag before it downloads such a delete, its update wins and recreates the
 * tag here, but this client's archived copy already lost the id while the
 * archiving client's copy keeps it.
 * Tag ids can also come back through the board's "create missing tags" action,
 * which recreates fixed ids (EM_URGENT, EM_IMPORTANT); archived copies scrubbed
 * here stay without them.
 *
 * Tasks are never dropped here: `removeTagsFromAllTasks` checks orphans on the
 * archive as loaded before the removal, so on the archiving client a task left
 * without project, tag and parent by the delete stays archived with no tags.
 * One leftover: when the delete follows the archive in the same remote batch,
 * the delete's cleanup sees the task written here as already orphaned and
 * drops it, so a legacy task without a project is kept or dropped depending on
 * batching.
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
