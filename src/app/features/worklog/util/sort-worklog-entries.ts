import { WorklogDataForDay } from '../worklog.model';

/**
 * Sorts worklog entries alphabetically by task title while keeping subtasks
 * grouped with their parent tasks.
 *
 * Sorting rules:
 * 1. Parent tasks are sorted alphabetically by title (case-insensitive)
 * 2. Subtasks are grouped immediately after their parent
 * 3. Subtasks within a group are sorted alphabetically by title (case-insensitive)
 * 4. Orphan entries (no parent, not a parent themselves) are sorted with other parents
 *
 * @param entries - Array of WorklogDataForDay entries to sort
 * @returns New sorted array (does not mutate input)
 */
export const sortWorklogEntriesAlphabetically = (
  entries: WorklogDataForDay[],
): WorklogDataForDay[] => {
  if (entries.length <= 1) {
    return entries;
  }

  // Separate parent tasks/standalone tasks from subtasks
  const parentEntries: WorklogDataForDay[] = [];
  const subtasksByParentId = new Map<string, WorklogDataForDay[]>();

  for (const entry of entries) {
    if (entry.parentId) {
      // This is a subtask
      const existing = subtasksByParentId.get(entry.parentId) || [];
      existing.push(entry);
      subtasksByParentId.set(entry.parentId, existing);
    } else {
      // This is a parent task or standalone task
      parentEntries.push(entry);
    }
  }

  // Sort parent tasks alphabetically (case-insensitive)
  parentEntries.sort((a, b) =>
    a.task.title.localeCompare(b.task.title, undefined, { sensitivity: 'base' }),
  );

  // Sort subtasks within each group alphabetically (case-insensitive)
  for (const subtasks of subtasksByParentId.values()) {
    subtasks.sort((a, b) =>
      a.task.title.localeCompare(b.task.title, undefined, { sensitivity: 'base' }),
    );
  }

  // Build result: parent followed by its subtasks
  const result: WorklogDataForDay[] = [];
  for (const parent of parentEntries) {
    result.push(parent);
    const subtasks = subtasksByParentId.get(parent.task.id);
    if (subtasks) {
      result.push(...subtasks);
    }
  }

  // Handle orphan subtasks (subtasks whose parent is not in this day's entries)
  // These are added at the end, sorted alphabetically
  const parentIds = new Set(parentEntries.map((p) => p.task.id));
  const orphanSubtasks: WorklogDataForDay[] = [];
  for (const [parentId, subtasks] of subtasksByParentId) {
    if (!parentIds.has(parentId)) {
      orphanSubtasks.push(...subtasks);
    }
  }
  if (orphanSubtasks.length > 0) {
    orphanSubtasks.sort((a, b) =>
      a.task.title.localeCompare(b.task.title, undefined, { sensitivity: 'base' }),
    );
    result.push(...orphanSubtasks);
  }

  return result;
};
