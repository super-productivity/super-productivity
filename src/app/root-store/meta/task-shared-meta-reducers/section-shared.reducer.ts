import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import {
  adapter as sectionAdapter,
  SECTION_FEATURE_NAME,
} from '../../../features/section/store/section.reducer';
import { Section, SectionState } from '../../../features/section/section.model';
import * as SectionActions from '../../../features/section/store/section.actions';
import { TaskSharedActions } from '../task-shared.actions';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME, tagAdapter } from '../../../features/tag/store/tag.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectAdapter,
} from '../../../features/project/store/project.reducer';
import { Task } from '../../../features/tasks/task.model';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { moveItemAfterAnchor } from '../../../features/work-context/store/work-context-meta.helper';

// Must run before taskSharedCrudMetaReducer — handlers read pre-update
// task state to compute cleanups. Position pinned by
// `validateMetaReducerOrdering()` in meta-reducer-registry.ts.
interface ExtendedState extends RootState {
  [SECTION_FEATURE_NAME]: SectionState;
}

type Handler = (state: ExtendedState, action: Action) => ExtendedState;

const collectAffectedTaskIds = (
  state: ExtendedState,
  primaryTaskIds: string[],
): string[] => {
  const taskState = state[TASK_FEATURE_NAME];
  const all = new Set<string>(primaryTaskIds);
  for (const id of primaryTaskIds) {
    const t = taskState.entities[id];
    if (t?.subTaskIds?.length) {
      for (const sub of t.subTaskIds) all.add(sub);
    }
  }
  return Array.from(all);
};

/**
 * Walk `taskIds` once removing entries in `removedSet`. Returns `null`
 * when nothing was removed so callers can keep the original array
 * reference, avoiding the `.some` + `.filter` double-walk.
 */
const filterRemovingTaskIds = (
  taskIds: string[],
  removedSet: Set<string>,
): string[] | null => {
  let next: string[] | null = null;
  for (let i = 0; i < taskIds.length; i++) {
    const id = taskIds[i];
    if (removedSet.has(id)) {
      if (next === null) next = taskIds.slice(0, i);
    } else if (next !== null) {
      next.push(id);
    }
  }
  return next;
};

const cleanupSectionTaskIds = (
  sectionState: SectionState,
  removedTaskIds: string[],
): SectionState => {
  if (removedTaskIds.length === 0) return sectionState;

  const removedSet = new Set(removedTaskIds);
  const updates: Update<Section>[] = [];

  // Iterate `state.ids` directly — `Object.values(entities)` allocates
  // a fresh array on every dispatch, which adds up under op-log replay.
  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s) continue;
    const filtered = filterRemovingTaskIds(s.taskIds, removedSet);
    if (filtered !== null) {
      updates.push({ id: s.id, changes: { taskIds: filtered } });
    }
  }

  if (!updates.length) return sectionState;
  return sectionAdapter.updateMany(updates, sectionState);
};

/**
 * Drop project-scoped sections owned by the deleted project, and strip
 * `taskIds` from TODAY-tag sections whose tasks are leaving the project.
 */
const removeProjectSections = (
  sectionState: SectionState,
  projectId: string,
): SectionState => {
  const idsToRemove: string[] = [];
  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s) continue;
    if (s.contextType === WorkContextType.PROJECT && s.contextId === projectId) {
      idsToRemove.push(s.id);
    }
  }
  if (!idsToRemove.length) return sectionState;
  return sectionAdapter.removeMany(idsToRemove, sectionState);
};

/**
 * Strip `taskIds` from sections owned by `projectId` (PROJECT context).
 * Used when a task leaves a project (moveToOtherProject) — its section
 * membership in the old project becomes stale.
 */
const removeTaskIdsFromProjectSections = (
  sectionState: SectionState,
  taskIds: string[],
  projectId: string,
): SectionState => {
  if (taskIds.length === 0) return sectionState;

  const taskIdSet = new Set(taskIds);
  const updates: Update<Section>[] = [];

  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s) continue;
    if (s.contextType !== WorkContextType.PROJECT) continue;
    if (s.contextId !== projectId) continue;
    const filtered = filterRemovingTaskIds(s.taskIds, taskIdSet);
    if (filtered !== null) {
      updates.push({ id: s.id, changes: { taskIds: filtered } });
    }
  }

  if (!updates.length) return sectionState;
  return sectionAdapter.updateMany(updates, sectionState);
};

/**
 * Strip `taskIds` from the singleton TODAY-tag section bucket.
 */
const removeTaskIdsFromTodaySections = (
  sectionState: SectionState,
  taskIds: string[],
): SectionState => {
  if (taskIds.length === 0) return sectionState;

  const taskIdSet = new Set(taskIds);
  const updates: Update<Section>[] = [];

  for (const id of sectionState.ids) {
    const s = sectionState.entities[id];
    if (!s) continue;
    if (s.contextType !== WorkContextType.TAG) continue;
    if (s.contextId !== TODAY_TAG.id) continue;
    const filtered = filterRemovingTaskIds(s.taskIds, taskIdSet);
    if (filtered !== null) {
      updates.push({ id: s.id, changes: { taskIds: filtered } });
    }
  }

  if (!updates.length) return sectionState;
  return sectionAdapter.updateMany(updates, sectionState);
};

const withSectionStateUpdate = (
  state: ExtendedState,
  next: SectionState,
): ExtendedState =>
  next === state[SECTION_FEATURE_NAME]
    ? state
    : ({ ...state, [SECTION_FEATURE_NAME]: next } as ExtendedState);

const handleTaskRemoval = (
  state: ExtendedState,
  primaryTaskIds: string[],
): ExtendedState => {
  const affectedIds = collectAffectedTaskIds(state, primaryTaskIds);
  return withSectionStateUpdate(
    state,
    cleanupSectionTaskIds(state[SECTION_FEATURE_NAME], affectedIds),
  );
};

/**
 * Task is moving from its current project to `targetProjectId`. Strip
 * the task (and its subtasks) from the old project's sections.
 */
const handleMoveToOtherProject = (
  state: ExtendedState,
  taskId: string,
  targetProjectId: string,
): ExtendedState => {
  const t = state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
  const oldProjectId = t?.projectId;
  if (!oldProjectId || oldProjectId === targetProjectId) return state;

  const affectedTaskIds = collectAffectedTaskIds(state, [taskId]);
  return withSectionStateUpdate(
    state,
    removeTaskIdsFromProjectSections(
      state[SECTION_FEATURE_NAME],
      affectedTaskIds,
      oldProjectId,
    ),
  );
};

/**
 * Diff-based TODAY_TAG.taskIds cleanup. TODAY is virtual — `task.tagIds`
 * never contains `'TODAY'`, so the set of reducers that mutate
 * `TODAY_TAG.taskIds` is too broad to enumerate by action type
 * (scheduleTaskWithTime, planTaskForDay, unscheduleTask, short-syntax
 * day moves, undo paths, lww conflict resolution, …).
 *
 * Compares pre/post `TODAY_TAG.taskIds` after the inner reducer ran;
 * any id that left TODAY is stripped from TODAY-tag sections.
 *
 * Cheap path: short-circuits on tag-state reference equality, then on
 * TODAY entity reference equality, then on taskIds reference equality.
 * Only when all three changed do we walk the arrays.
 */
const diffRemovedTodayTaskIds = (prev: RootState, next: RootState): string[] | null => {
  const prevTagState = prev[TAG_FEATURE_NAME];
  const nextTagState = next[TAG_FEATURE_NAME];
  if (prevTagState === nextTagState) return null;
  const prevToday = prevTagState.entities[TODAY_TAG.id];
  const nextToday = nextTagState.entities[TODAY_TAG.id];
  if (prevToday === nextToday) return null;
  const prevIds = prevToday?.taskIds;
  const nextIds = nextToday?.taskIds;
  if (prevIds === nextIds || !prevIds?.length) return null;
  const nextSet = nextIds ? new Set(nextIds) : new Set<string>();
  const removed: string[] = [];
  for (const id of prevIds) {
    if (!nextSet.has(id)) removed.push(id);
  }
  return removed.length ? removed : null;
};

const applyTodayTagSectionCleanup = (
  state: RootState,
  removedTaskIds: string[],
): RootState => {
  const extState = state as ExtendedState;
  const sectionState = extState[SECTION_FEATURE_NAME];
  const cleaned = removeTaskIdsFromTodaySections(sectionState, removedTaskIds);
  if (cleaned === sectionState) return state;
  return { ...extState, [SECTION_FEATURE_NAME]: cleaned } as RootState;
};

/**
 * Atomic side-effect of `removeTaskFromSection`: reposition the task in
 * the work-context's `taskIds` so it lands at the dropped slot in the
 * no-section bucket. Same reducer pass as the section.taskIds removal —
 * one op, one replay, both stores updated together.
 *
 * `afterTaskId === null` places the task at the start of the bucket.
 * If the work-context entity is missing (concurrently deleted) the
 * mutation is a no-op rather than an error.
 */
const handleRemoveTaskFromSection = (
  state: ExtendedState,
  workContextType: WorkContextType,
  workContextId: string,
  taskId: string,
  afterTaskId: string | null,
): ExtendedState => {
  // TAG and PROJECT slices share the same `taskIds: string[]` shape, so
  // pick the slice / adapter once and run the single mutation path.
  const isTag = workContextType === WorkContextType.TAG;
  const featureName = isTag ? TAG_FEATURE_NAME : PROJECT_FEATURE_NAME;
  const adapter = isTag ? tagAdapter : projectAdapter;
  const slice = state[featureName];
  const entity = slice.entities[workContextId];
  if (!entity) return state;
  const next = moveItemAfterAnchor(taskId, afterTaskId, entity.taskIds);
  if (next === entity.taskIds) return state;
  return {
    ...state,
    [featureName]: (adapter as typeof projectAdapter).updateOne(
      { id: workContextId, changes: { taskIds: next } },
      slice as never,
    ),
  };
};

/**
 * Action-specific handlers.
 *
 * KNOWN FOLLOW-UPs:
 *
 * - `batchUpdateForProject` (plugin API) can update tagIds and delete
 *   tasks within its single-action transform. Sections it would
 *   otherwise affect aren't pruned. Handling it here requires walking
 *   the operations array, which is non-trivial.
 *
 * - LWW conflict-resolution can reassign a task's projectId; project-
 *   context section.taskIds can leak phantom references until the next
 *   `dataRepair` pass clears them. Visible impact bounded by render-time
 *   intersection in `undoneTasksBySection`.
 */
const ACTION_HANDLERS: Record<string, Handler> = {
  [TaskSharedActions.deleteTask.type]: (state, action) => {
    const { task } = action as ReturnType<typeof TaskSharedActions.deleteTask>;
    return handleTaskRemoval(state, [task.id]);
  },
  [TaskSharedActions.deleteTasks.type]: (state, action) => {
    const { taskIds } = action as ReturnType<typeof TaskSharedActions.deleteTasks>;
    return handleTaskRemoval(state, taskIds);
  },
  [TaskSharedActions.moveToArchive.type]: (state, action) => {
    // Strip archived task ids from sections. Restore is intentionally
    // NOT a counterpart — the task comes back without a section, mirror
    // of how restore drops missing tagIds.
    //
    // Union payload-subTasks with state-derived subtasks: payload covers
    // the replay-with-missing-state case; state covers callers who pass
    // an empty `subTasks` array.
    const { tasks } = action as ReturnType<typeof TaskSharedActions.moveToArchive>;
    const idSet = new Set<string>();
    for (const t of tasks) {
      idSet.add(t.id);
      if (t.subTasks?.length) for (const st of t.subTasks) idSet.add(st.id);
    }
    const stateExpanded = collectAffectedTaskIds(
      state,
      tasks.map((t) => t.id),
    );
    for (const id of stateExpanded) idSet.add(id);
    return withSectionStateUpdate(
      state,
      cleanupSectionTaskIds(state[SECTION_FEATURE_NAME], Array.from(idSet)),
    );
  },
  [TaskSharedActions.deleteProject.type]: (state, action) => {
    const { projectId, allTaskIds } = action as ReturnType<
      typeof TaskSharedActions.deleteProject
    >;
    // Two-step in a single reducer pass:
    //   1. drop sections owned by the deleted project
    //   2. strip the deleted task ids from any remaining (TODAY-tag)
    //      sections — task.reducer cascades removeMany(allTaskIds), so
    //      TODAY sections that held shared tasks would otherwise keep
    //      stale ids forever.
    const next = withSectionStateUpdate(
      state,
      removeProjectSections(state[SECTION_FEATURE_NAME], projectId),
    );
    if (!allTaskIds.length) return next;
    return withSectionStateUpdate(
      next,
      cleanupSectionTaskIds(next[SECTION_FEATURE_NAME], allTaskIds),
    );
  },
  [TaskSharedActions.moveToOtherProject.type]: (state, action) => {
    const { task, targetProjectId } = action as ReturnType<
      typeof TaskSharedActions.moveToOtherProject
    >;
    return handleMoveToOtherProject(state, task.id, targetProjectId);
  },
  [TaskSharedActions.convertToSubTask.type]: (state, action) => {
    const { taskId } = action as ReturnType<typeof TaskSharedActions.convertToSubTask>;
    return handleTaskRemoval(state, [taskId]);
  },
  [SectionActions.removeTaskFromSection.type]: (state, action) => {
    const { workContextType, workContextId, taskId, workContextAfterTaskId } =
      action as ReturnType<typeof SectionActions.removeTaskFromSection>;
    return handleRemoveTaskFromSection(
      state,
      workContextType,
      workContextId,
      taskId,
      workContextAfterTaskId,
    );
  },
};

export const sectionSharedMetaReducer: MetaReducer<RootState> = (
  reducer: ActionReducer<RootState, Action>,
) => {
  return (state: RootState | undefined, action: Action): RootState => {
    if (!state) return reducer(state, action);
    // Boot/hydration guard: skip section-side cleanup until every slice
    // it touches is hydrated.
    const ext = state as ExtendedState;
    if (
      !ext[TASK_FEATURE_NAME] ||
      !ext[TAG_FEATURE_NAME] ||
      !ext[PROJECT_FEATURE_NAME] ||
      !ext[SECTION_FEATURE_NAME]
    ) {
      return reducer(state, action);
    }
    const handler = ACTION_HANDLERS[action.type];
    const preState = handler ? handler(ext, action) : state;
    const next = reducer(preState, action);
    // Post-reducer TODAY_TAG.taskIds diff catches every flow that
    // removes ids from TODAY without going through a known action.
    const removedFromToday = diffRemovedTodayTaskIds(state, next);
    if (!removedFromToday) return next;
    const affected = collectAffectedTaskIds(next as ExtendedState, removedFromToday);
    return applyTodayTagSectionCleanup(next, affected);
  };
};
