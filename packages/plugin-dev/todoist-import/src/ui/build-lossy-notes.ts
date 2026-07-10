import { PriorityMapping } from '../map/plan-import';
import { TodoistImportModel } from '../parse/normalized-model';

export interface LossNote {
  key: string;
  params?: Record<string, string | number>;
}

export const buildLossyNotes = (
  model: TodoistImportModel,
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
    'LOSS.NESTED_PROJECTS',
    projects.filter((project) => !!project.parentExtId).length,
  );
  addCount(
    'LOSS.SECTIONS',
    model.sections.filter((section) => selected.has(section.projectExtId)).length,
  );
  addCount('LOSS.DEMOTED_SUBTASKS', tasks.filter((task) => task.wasDemoted).length);
  addCount('LOSS.RECURRING', tasks.filter((task) => task.isRecurring).length);
  addCount(
    'LOSS.DAY_DURATIONS',
    tasks.filter((task) => task.isDayDurationSkipped).length,
  );
  addCount(
    'LOSS.SUBTASK_LABELS',
    tasks.filter((task) => task.parentExtId && task.labels.length).length,
  );
  if (priorityMapping !== 'none') {
    addCount(
      'LOSS.SUBTASK_PRIORITIES',
      tasks.filter((task) => task.parentExtId && task.apiPriority > 1).length,
    );
  }
  addCount('LOSS.ASSIGNEES', tasks.filter((task) => task.hasAssignee).length);
  addCount(
    'LOSS.ATTACHMENTS',
    tasks.reduce((count, task) => count + task.attachmentCount, 0),
  );
  addCount(
    'LOSS.TRUNCATED_FIELDS',
    [...projects, ...tasks].reduce(
      (count, item) => count + (item.truncatedFieldCount || 0),
      0,
    ),
  );
  notes.push({ key: 'LOSS.COMPLETED_AND_REMINDERS' });
  return notes;
};
