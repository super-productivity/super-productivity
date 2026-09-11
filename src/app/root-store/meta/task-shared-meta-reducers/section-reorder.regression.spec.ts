import { Action, ActionReducer } from '@ngrx/store';
import { RootState } from '../../root-state';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import {
  moveTaskDownInTodayList,
  moveTaskToBottomInTodayList,
  moveTaskToTopInTodayList,
  moveTaskUpInTodayList,
} from '../../../features/work-context/store/work-context-meta.actions';
import {
  SECTION_FEATURE_NAME,
  sectionReducer,
} from '../../../features/section/store/section.reducer';
import { SectionState } from '../../../features/section/section.model';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectReducer,
} from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME, tagReducer } from '../../../features/tag/store/tag.reducer';
import { sectionSharedMetaReducer } from './section-shared.reducer';
import { createBaseState, createMockTask } from './test-utils';

const TASK_IDS = ['t1', 't2', 't3'];

type StateWithSections = RootState & {
  [SECTION_FEATURE_NAME]: SectionState;
};

const createState = (
  contextType: WorkContextType = WorkContextType.PROJECT,
  contextId: string = 'project1',
): StateWithSections => {
  const base = createBaseState();
  const tasks = Object.fromEntries(
    TASK_IDS.map((id) => [
      id,
      createMockTask({
        id,
        projectId: contextType === WorkContextType.PROJECT ? contextId : undefined,
        tagIds: contextType === WorkContextType.TAG ? [contextId] : [],
      }),
    ]),
  );

  const state = {
    ...base,
    [TASK_FEATURE_NAME]: {
      ...base[TASK_FEATURE_NAME],
      ids: [...TASK_IDS],
      entities: tasks,
    },
    [SECTION_FEATURE_NAME]: {
      ids: ['section1', 'section2'],
      entities: {
        section1: {
          id: 'section1',
          contextId,
          contextType,
          title: 'Section 1',
          taskIds: [...TASK_IDS],
        },
        section2: {
          id: 'section2',
          contextId,
          contextType,
          title: 'Section 2',
          taskIds: ['other'],
        },
      },
    },
  } as StateWithSections;

  if (contextType === WorkContextType.PROJECT) {
    const project = state[PROJECT_FEATURE_NAME].entities[contextId];
    if (!project) throw new Error(`Missing project fixture: ${contextId}`);
    state[PROJECT_FEATURE_NAME] = {
      ...state[PROJECT_FEATURE_NAME],
      entities: {
        ...state[PROJECT_FEATURE_NAME].entities,
        [contextId]: { ...project, taskIds: [...TASK_IDS] },
      },
    };
  } else {
    const tag = state[TAG_FEATURE_NAME].entities[contextId];
    if (!tag) throw new Error(`Missing tag fixture: ${contextId}`);
    state[TAG_FEATURE_NAME] = {
      ...state[TAG_FEATURE_NAME],
      entities: {
        ...state[TAG_FEATURE_NAME].entities,
        [contextId]: { ...tag, taskIds: [...TASK_IDS] },
      },
    };
  }

  return state;
};

const rootReducer: ActionReducer<RootState, Action> = (state, action) => {
  if (!state) throw new Error('Expected initialized root state');
  const stateWithSections = state as StateWithSections;

  return {
    ...stateWithSections,
    [SECTION_FEATURE_NAME]: sectionReducer(
      stateWithSections[SECTION_FEATURE_NAME],
      action,
    ),
    [PROJECT_FEATURE_NAME]: projectReducer(
      stateWithSections[PROJECT_FEATURE_NAME],
      action,
    ),
    [TAG_FEATURE_NAME]: tagReducer(stateWithSections[TAG_FEATURE_NAME], action),
  } as RootState;
};

const metaReducer = sectionSharedMetaReducer(rootReducer);

const sectionTaskIds = (state: StateWithSections, sectionId = 'section1'): string[] =>
  state[SECTION_FEATURE_NAME].entities[sectionId]?.taskIds ?? [];

const projectTaskIds = (state: StateWithSections): string[] =>
  state[PROJECT_FEATURE_NAME].entities.project1?.taskIds ?? [];

const tagTaskIds = (state: StateWithSections): string[] =>
  state[TAG_FEATURE_NAME].entities.tag1?.taskIds ?? [];

describe('sectionSharedMetaReducer section reorder regression #9574', () => {
  it('moves a task to the bottom in both section and project order', () => {
    const state = createState();
    const result = metaReducer(
      state,
      moveTaskToBottomInTodayList({
        taskId: 't1',
        workContextType: WorkContextType.PROJECT,
        workContextId: 'project1',
        doneTaskIds: [],
      }),
    ) as StateWithSections;

    expect(sectionTaskIds(result)).toEqual(['t2', 't3', 't1']);
    expect(projectTaskIds(result)).toEqual(['t2', 't3', 't1']);
  });

  it('moves a task to the top in both section and project order', () => {
    const state = createState();
    const result = metaReducer(
      state,
      moveTaskToTopInTodayList({
        taskId: 't3',
        workContextType: WorkContextType.PROJECT,
        workContextId: 'project1',
        doneTaskIds: [],
      }),
    ) as StateWithSections;

    expect(sectionTaskIds(result)).toEqual(['t3', 't1', 't2']);
    expect(projectTaskIds(result)).toEqual(['t3', 't1', 't2']);
  });

  it('moves a task up in both section and project order', () => {
    const state = createState();
    const result = metaReducer(
      state,
      moveTaskUpInTodayList({
        taskId: 't2',
        workContextType: WorkContextType.PROJECT,
        workContextId: 'project1',
        doneTaskIds: [...TASK_IDS],
      }),
    ) as StateWithSections;

    expect(sectionTaskIds(result)).toEqual(['t2', 't1', 't3']);
    expect(projectTaskIds(result)).toEqual(['t2', 't1', 't3']);
  });

  it('moves a task down in both section and project order', () => {
    const state = createState();
    const result = metaReducer(
      state,
      moveTaskDownInTodayList({
        taskId: 't2',
        workContextType: WorkContextType.PROJECT,
        workContextId: 'project1',
        doneTaskIds: [...TASK_IDS],
      }),
    ) as StateWithSections;

    expect(sectionTaskIds(result)).toEqual(['t1', 't3', 't2']);
    expect(projectTaskIds(result)).toEqual(['t1', 't3', 't2']);
  });

  it('applies the same atomic ordering behavior in tag contexts', () => {
    const state = createState(WorkContextType.TAG, 'tag1');
    const result = metaReducer(
      state,
      moveTaskToBottomInTodayList({
        taskId: 't1',
        workContextType: WorkContextType.TAG,
        workContextId: 'tag1',
        doneTaskIds: [],
      }),
    ) as StateWithSections;

    expect(sectionTaskIds(result)).toEqual(['t2', 't3', 't1']);
    expect(tagTaskIds(result)).toEqual(['t2', 't3', 't1']);
  });

  it('leaves unrelated sections untouched', () => {
    const state = createState();
    const result = metaReducer(
      state,
      moveTaskToBottomInTodayList({
        taskId: 't1',
        workContextType: WorkContextType.PROJECT,
        workContextId: 'project1',
        doneTaskIds: [],
      }),
    ) as StateWithSections;

    expect(sectionTaskIds(result, 'section2')).toEqual(['other']);
  });
});
