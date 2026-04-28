import { createReducer, on } from '@ngrx/store';
import { createEntityAdapter, EntityAdapter, Update } from '@ngrx/entity';
import * as SectionActions from './section.actions';
import { Section, SectionState } from '../section.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { moveItemAfterAnchor } from '../../work-context/store/work-context-meta.helper';

export const SECTION_FEATURE_NAME = 'section';

export const adapter: EntityAdapter<Section> = createEntityAdapter<Section>();

export const initialSectionState: SectionState = adapter.getInitialState({
  ids: [] as string[],
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

  on(SectionActions.updateSectionOrder, (state, { contextId, ids }) => {
    // Walk state.ids and swap each context-matching slot for the next
    // id from the new order. Other-context sections keep their slot,
    // so the global ids array stays stable across cross-context edits.
    let cursor = 0;
    let changed = false;
    const next = (state.ids as string[]).map((id) => {
      const s = state.entities[id];
      if (s && s.contextId === contextId) {
        const replacement = ids[cursor++];
        if (replacement && replacement !== id) changed = true;
        return replacement ?? id;
      }
      return id;
    });
    return changed ? { ...state, ids: next } : state;
  }),

  on(
    SectionActions.addTaskToSection,
    (state, { sectionId, taskId, afterTaskId, sourceSectionId }) => {
      const updates: Update<Section>[] = [];

      // Strip from the explicit source (if any). Replay produces the
      // same result regardless of current state — `null` means "task
      // wasn't in any section" and explicitly NOT a sweep request.
      if (sourceSectionId && sourceSectionId !== sectionId) {
        const src = state.entities[sourceSectionId];
        if (src) {
          const removal = removeTaskIdFromSection(src, taskId);
          if (removal) updates.push(removal);
        }
      }

      const target = state.entities[sectionId];
      if (target) {
        const newTaskIds = moveItemAfterAnchor(
          taskId,
          afterTaskId ?? null,
          target.taskIds.includes(taskId) ? target.taskIds : [...target.taskIds, taskId],
        );
        updates.push({ id: sectionId, changes: { taskIds: newTaskIds } });
      }

      return updates.length ? adapter.updateMany(updates, state) : state;
    },
  ),

  on(SectionActions.removeTaskFromSection, (state, { sectionId, taskId }) => {
    const section = state.entities[sectionId];
    if (!section) return state;
    const removal = removeTaskIdFromSection(section, taskId);
    return removal ? adapter.updateOne(removal, state) : state;
  }),

  on(loadAllData, (state, { appDataComplete }) =>
    appDataComplete.section ? (appDataComplete.section as SectionState) : state,
  ),
);

export const { selectAll } = adapter.getSelectors();
