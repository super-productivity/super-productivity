import { PriorityMapping } from '../map/plan-import';
import { TodoistImportModel, TodoistTask } from '../parse/normalized-model';
import { buildLossyNotes } from './build-lossy-notes';

const task = (overrides: Partial<TodoistTask>): TodoistTask => ({
  extId: 'task',
  projectExtId: 'selected',
  parentExtId: null,
  title: 'Task',
  notes: '',
  labels: [],
  apiPriority: 1,
  dueDay: null,
  dueWithTime: null,
  timeEstimate: null,
  isRecurring: false,
  wasDemoted: false,
  isDayDurationSkipped: false,
  hasAssignee: false,
  attachmentCount: 0,
  ...overrides,
});

const model = (): TodoistImportModel => ({
  projects: [
    {
      extId: 'selected',
      title: 'Child',
      parentExtId: 'parent',
      isInbox: false,
      childOrder: 0,
      truncatedFieldCount: 1,
    },
    {
      extId: 'other',
      title: 'Other',
      parentExtId: null,
      isInbox: false,
      childOrder: 1,
    },
  ],
  sections: [
    { extId: 'section-selected', projectExtId: 'selected', title: 'Section' },
    { extId: 'section-other', projectExtId: 'other', title: 'Other section' },
  ],
  tasks: [
    task({
      extId: 'selected-root',
      isRecurring: true,
      isDayDurationSkipped: true,
      hasAssignee: true,
      attachmentCount: 2,
      truncatedFieldCount: 2,
    }),
    task({
      extId: 'selected-sub',
      parentExtId: 'selected-root',
      labels: ['label'],
      apiPriority: 4,
      wasDemoted: true,
    }),
    task({
      extId: 'other-root',
      projectExtId: 'other',
      isRecurring: true,
      attachmentCount: 4,
    }),
  ],
});

const keysFor = (priorityMapping: PriorityMapping): string[] =>
  buildLossyNotes(model(), new Set(['selected']), priorityMapping).map(
    (note) => note.key,
  );

describe('buildLossyNotes', () => {
  it('only reports losses for selected projects', () => {
    const notes = buildLossyNotes(model(), new Set(['selected']), 'none');

    expect(notes).toEqual(
      expect.arrayContaining([
        { key: 'LOSS.NESTED_PROJECTS', params: { count: 1 } },
        { key: 'LOSS.SECTIONS', params: { count: 1 } },
        { key: 'LOSS.DEMOTED_SUBTASKS', params: { count: 1 } },
        { key: 'LOSS.RECURRING', params: { count: 1 } },
        { key: 'LOSS.DAY_DURATIONS', params: { count: 1 } },
        { key: 'LOSS.SUBTASK_LABELS', params: { count: 1 } },
        { key: 'LOSS.ASSIGNEES', params: { count: 1 } },
        { key: 'LOSS.ATTACHMENTS', params: { count: 2 } },
        { key: 'LOSS.TRUNCATED_FIELDS', params: { count: 3 } },
      ]),
    );
  });

  it('reports prioritized sub-tasks only when priority mapping is enabled', () => {
    expect(keysFor('none')).not.toContain('LOSS.SUBTASK_PRIORITIES');
    expect(keysFor('priorityTags')).toContain('LOSS.SUBTASK_PRIORITIES');
    expect(keysFor('eisenhower')).toContain('LOSS.SUBTASK_PRIORITIES');
  });
});
