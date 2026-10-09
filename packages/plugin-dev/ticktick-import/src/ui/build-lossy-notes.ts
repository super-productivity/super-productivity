import { PriorityMapping } from '../map/plan-import';
import { TickTickImportModel } from '../parse/normalized-model';

export interface LossNote {
  key: string;
  params?: Record<string, string | number>;
}

export const buildLossyNotes = (
  model: TickTickImportModel,
  selected: ReadonlySet<string>,
  priorityMapping: PriorityMapping,
): LossNote[] => {
  const projects = model.projects.filter((project) => selected.has(project.extId));
  const tasks = model.tasks.filter((task) => selected.has(task.projectExtId));
  const notes: LossNote[] = [];
  const addCount = (key: string, count: number): void => {
    if (count) {
      notes.push({ key, params: { count } });
    }
  };

  addCount(
    'LOSS.FOLDERS',
    new Set(projects.map((project) => project.folderTitle).filter(Boolean)).size,
  );
  addCount(
    'LOSS.COLUMNS',
    projects.reduce((count, project) => count + project.columnCount, 0),
  );
  addCount('LOSS.DEMOTED_SUBTASKS', tasks.filter((task) => task.wasDemoted).length);
  addCount('LOSS.RECURRING', tasks.filter((task) => task.isRecurring).length);
  addCount('LOSS.REMINDERS', tasks.filter((task) => task.hasReminder).length);
  addCount(
    'LOSS.SUBTASK_TAGS',
    tasks.filter((task) => task.parentExtId && task.tags.length).length,
  );
  if (priorityMapping !== 'none') {
    addCount(
      'LOSS.SUBTASK_PRIORITIES',
      tasks.filter((task) => task.parentExtId && task.priority > 0).length,
    );
  }
  addCount(
    'LOSS.TRUNCATED_FIELDS',
    [...projects, ...tasks].reduce(
      (count, item) => count + (item.truncatedFieldCount || 0),
      0,
    ),
  );
  addCount('LOSS.CLOSED_TASKS', model.skippedClosedCount);
  notes.push({ key: 'LOSS.NOT_IN_BACKUP' });
  return notes;
};
