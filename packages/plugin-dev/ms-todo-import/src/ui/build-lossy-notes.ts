import { getTasksToImport, MsTodoImportModel } from '../parse/normalized-model';

export interface LossNote {
  key: string;
  params?: Record<string, string | number>;
}

export const buildLossyNotes = (
  model: MsTodoImportModel,
  selected: ReadonlySet<string>,
  includeCompletedTasks = false,
): LossNote[] => {
  const projects = model.projects.filter((project) => selected.has(project.extId));
  const tasks = getTasksToImport(model.tasks, includeCompletedTasks).filter((task) =>
    selected.has(task.projectExtId),
  );
  const completedTaskCount = includeCompletedTasks
    ? 0
    : model.tasks.filter(
        (task) => !task.parentExtId && task.isDone && selected.has(task.projectExtId),
      ).length;
  const notes: LossNote[] = [];
  const addCount = (key: string, count: number): void => {
    if (count) {
      notes.push({ key, params: { count } });
    }
  };

  addCount(
    'LOSS.RECURRING',
    tasks.filter((task) => task.isRecurring && !task.repeat).length,
  );
  addCount('LOSS.REMINDERS', tasks.filter((task) => task.hasReminder).length);
  addCount('LOSS.ATTACHMENTS', tasks.filter((task) => task.hasAttachments).length);
  addCount('LOSS.COMPLETED_TASKS', completedTaskCount);
  addCount(
    'LOSS.TRUNCATED_FIELDS',
    [...projects, ...tasks].reduce(
      (count, item) => count + (item.truncatedFieldCount || 0),
      0,
    ),
  );
  notes.push({ key: 'LOSS.ALWAYS' });
  return notes;
};
