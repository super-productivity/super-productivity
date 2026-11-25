import { MsTodoImportModel } from '../parse/normalized-model';

export interface LossNote {
  key: string;
  params?: Record<string, string | number>;
}

export const buildLossyNotes = (
  model: MsTodoImportModel,
  selected: ReadonlySet<string>,
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
    'LOSS.RECURRING',
    tasks.filter((task) => task.isRecurring && !task.repeat).length,
  );
  addCount('LOSS.REMINDERS', tasks.filter((task) => task.hasReminder).length);
  addCount('LOSS.ATTACHMENTS', tasks.filter((task) => task.hasAttachments).length);
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
