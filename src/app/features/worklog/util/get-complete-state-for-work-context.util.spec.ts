import { getCompleteStateForWorkContext } from './get-complete-state-for-work-context.util';
import { DEFAULT_TAG } from '../../tag/tag.const';
import { WorkContext, WorkContextType } from '../../work-context/work-context.model';
import { WORK_CONTEXT_DEFAULT_THEME } from '../../work-context/work-context.const';
import { DEFAULT_TASK, Task, TaskCopy } from '../../tasks/task.model';
import { EntityState } from '@ngrx/entity';
import { fakeEntityStateFromArray } from '../../../util/fake-entity-state-from-array';

const TAG_ID = 'TAG_ID';

const TAG_CTX = {
  ...DEFAULT_TAG,
  id: TAG_ID,
  title: 'TAG',
  icon: 'string',
  routerLink: 'string',
  taskIds: ['A'],
  noteIds: [],
  type: WorkContextType.TAG,
  theme: WORK_CONTEXT_DEFAULT_THEME,
} as WorkContext;

const fakeTaskStateFromArray = (tasks: TaskCopy[]): EntityState<Task> => {
  return fakeEntityStateFromArray(tasks) as EntityState<Task>;
};

describe('getCompleteStateForWorkContext', () => {
  it('should include sub tasks for tags', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'PT',
        id: 'PT',
        tagIds: [TAG_ID],
        subTaskIds: ['SUB_B', 'SUB_C'],
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_B',
        id: 'SUB_B',
        parentId: 'PT',
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_C',
        id: 'SUB_C',
        parentId: 'PT',
      },
    ]);
    const archiveS = fakeTaskStateFromArray([]);

    const r = getCompleteStateForWorkContext(TAG_CTX, ts, archiveS);
    expect(r.completeStateForWorkContext.ids).toEqual(['PT', 'SUB_B', 'SUB_C']);
  });

  it('should include a sub-task tagged independently of its parent (#7756)', () => {
    // Sub-task is tagged TAG_ID, parent is not. Pre-#7756 the sub-task would
    // be filtered out because membership was inherited from the parent only.
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'PT',
        id: 'PT',
        tagIds: ['OTHER_TAG'],
        subTaskIds: ['SUB_TAGGED'],
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_TAGGED',
        id: 'SUB_TAGGED',
        parentId: 'PT',
        tagIds: [TAG_ID],
      },
    ]);
    const archiveS = fakeTaskStateFromArray([]);

    const r = getCompleteStateForWorkContext(TAG_CTX, ts, archiveS);
    expect(r.completeStateForWorkContext.ids).toContain('SUB_TAGGED');
  });

  it('should include sub tasks for tags for the archive', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'PT_TODAY',
        id: 'PT_TODAY',
        tagIds: [TAG_ID],
      },
    ]);
    const archiveS = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'PT',
        id: 'PT',
        tagIds: [TAG_ID],
        subTaskIds: ['SUB_B', 'SUB_C'],
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_B',
        id: 'SUB_B',
        parentId: 'PT',
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_C',
        id: 'SUB_C',
        parentId: 'PT',
      },
    ]);
    const r = getCompleteStateForWorkContext(TAG_CTX, ts, archiveS);
    expect(r.completeStateForWorkContext.ids).toEqual([
      'PT_TODAY',
      'PT',
      'SUB_B',
      'SUB_C',
    ]);
  });
});
