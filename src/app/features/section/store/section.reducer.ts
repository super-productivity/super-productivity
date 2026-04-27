import { createReducer, on } from '@ngrx/store';
import { createEntityAdapter, EntityAdapter, Update } from '@ngrx/entity';
import * as SectionActions from './section.actions';
import { Section, SectionState } from '../section.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { moveItemAfterAnchor } from '../../work-context/store/work-context-meta.helper';

export const SECTION_FEATURE_NAME = 'section';

export const adapter: EntityAdapter<Section> = createEntityAdapter<Section>();

export const initialSectionState: SectionState = adapter.getInitialState({
  ids: [],
});

const removeTaskIdFromSection = (
  section: Section,
  taskId: string,
): Update<Section> | null => {
  // Older persisted sections may lack taskIds entirely.
  const taskIds = section.taskIds ?? [];
  if (!taskIds.includes(taskId)) return null;
  return {
    id: section.id,
    changes: { taskIds: taskIds.filter((id) => id !== taskId) },
  };
};

const normalizeLoadedSections = (state: SectionState): SectionState => {
  let dirty = false;
  const entities: SectionState['entities'] = {};
  for (const id of state.ids as string[]) {
    const s = state.entities[id];
    if (!s) continue;
    if (!Array.isArray(s.taskIds)) {
      entities[id] = { ...s, taskIds: [] };
      dirty = true;
    } else {
      entities[id] = s;
    }
  }
  return dirty ? { ...state, entities } : state;
};

export const sectionReducer = createReducer(
  initialSectionState,

  on(SectionActions.addSection, (state, { section }) =>
    adapter.addOne({ ...section, taskIds: section.taskIds ?? [] }, state),
  ),

  on(SectionActions.deleteSection, (state, { id }) => adapter.removeOne(id, state)),

  on(SectionActions.updateSection, (state, { section }) =>
    adapter.updateOne(section, state),
  ),

  on(SectionActions.loadSections, (state, { sections }) =>
    adapter.setAll(sections, state),
  ),

  on(SectionActions.updateSectionOrder, (state, { contextId, ids }) => {
    const idsSet = new Set(ids);
    const otherIds = (state.ids as string[]).filter((id) => {
      if (idsSet.has(id)) return false;
      const s = state.entities[id];
      // Keep sections from other contexts in their existing positions.
      return s ? s.contextId !== contextId : true;
    });
    return {
      ...state,
      ids: [...otherIds, ...ids],
    };
  }),

  on(SectionActions.addTaskToSection, (state, { sectionId, taskId, afterTaskId }) => {
    const updates: Update<Section>[] = [];

    Object.values(state.entities).forEach((s) => {
      if (!s) return;
      if (s.id === sectionId) return;
      const removal = removeTaskIdFromSection(s, taskId);
      if (removal) updates.push(removal);
    });

    if (sectionId) {
      const target = state.entities[sectionId];
      if (target) {
        const targetTaskIds = target.taskIds ?? [];
        const newTaskIds = moveItemAfterAnchor(
          taskId,
          afterTaskId ?? null,
          targetTaskIds.includes(taskId) ? targetTaskIds : [...targetTaskIds, taskId],
        );
        updates.push({ id: sectionId, changes: { taskIds: newTaskIds } });
      }
    }

    return updates.length ? adapter.updateMany(updates, state) : state;
  }),

  on(loadAllData, (state, { appDataComplete }) =>
    appDataComplete.section
      ? normalizeLoadedSections({ ...(appDataComplete.section as SectionState) })
      : state,
  ),
);

export const { selectIds, selectEntities, selectAll, selectTotal } =
  adapter.getSelectors();
