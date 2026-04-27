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
  if (!section.taskIds.includes(taskId)) return null;
  return {
    id: section.id,
    changes: { taskIds: section.taskIds.filter((id) => id !== taskId) },
  };
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

    // 1. Remove the task from any other section that currently holds it.
    Object.values(state.entities).forEach((s) => {
      if (!s) return;
      if (s.id === sectionId) return;
      const removal = removeTaskIdFromSection(s, taskId);
      if (removal) updates.push(removal);
    });

    // 2. Add the task into the target section at the requested position.
    if (sectionId) {
      const target = state.entities[sectionId];
      if (target) {
        const newTaskIds = moveItemAfterAnchor(
          taskId,
          afterTaskId ?? null,
          target.taskIds.includes(taskId) ? target.taskIds : [...target.taskIds, taskId],
        );
        updates.push({ id: sectionId, changes: { taskIds: newTaskIds } });
      }
    }

    return updates.length ? adapter.updateMany(updates, state) : state;
  }),

  on(loadAllData, (state, { appDataComplete }) =>
    appDataComplete.section ? { ...(appDataComplete.section as SectionState) } : state,
  ),
);

export const { selectIds, selectEntities, selectAll, selectTotal } =
  adapter.getSelectors();
