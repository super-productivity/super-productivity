import { createReducer, on } from '@ngrx/store';
import { createEntityAdapter, EntityAdapter, Update } from '@ngrx/entity';
import * as SectionActions from './section.actions';
import { Section, SectionState } from '../section.model';
import { sanitizeSectionTitle } from '../section.util';
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
    adapter.addOne(
      {
        ...section,
        title: sanitizeSectionTitle(section.title),
        taskIds: section.taskIds ?? [],
      },
      state,
    ),
  ),

  on(SectionActions.deleteSection, (state, { id }) => adapter.removeOne(id, state)),

  on(SectionActions.updateSection, (state, { section }) => {
    // Sanitize when title key is present (regardless of value type) so
    // a malformed peer's `{ title: null }` cannot bypass the cap.
    if (!Object.hasOwn(section.changes, 'title')) {
      return adapter.updateOne(section, state);
    }
    return adapter.updateOne(
      {
        ...section,
        changes: {
          ...section.changes,
          title: sanitizeSectionTitle(section.changes.title),
        },
      },
      state,
    );
  }),

  on(SectionActions.updateSectionOrder, (state, { contextId, ids }) => {
    // Build the new context-section order, then splice into state.ids in
    // place of context-matching slots. Other-context sections keep their
    // absolute slot, so the global ids array stays stable across
    // cross-context edits.
    //
    // Defensive: payload may be partial / out-of-date relative to local
    // state (e.g. a remote client deleted a section while another
    // reordered). We accept payload entries that still resolve to a
    // section in this context, dedupe them, then append any context
    // sections the payload missed (in their original relative order) so
    // no section disappears or is duplicated.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const s = state.entities[id];
      if (s && s.contextId === contextId) {
        seen.add(id);
        ordered.push(id);
      }
    }
    for (const id of state.ids as string[]) {
      const s = state.entities[id];
      if (s && s.contextId === contextId && !seen.has(id)) {
        ordered.push(id);
      }
    }

    let cursor = 0;
    let changed = false;
    const next = (state.ids as string[]).map((id) => {
      const s = state.entities[id];
      if (!s || s.contextId !== contextId) return id;
      const replacement = ordered[cursor++] ?? id;
      if (replacement !== id) changed = true;
      return replacement;
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

  on(loadAllData, (_state, { appDataComplete }) =>
    // SYNC_IMPORT / BACKUP_IMPORT semantics: full state replacement.
    // Fall back to the empty initial state when the payload omits
    // `section` (legacy backups predate the feature) so we don't keep
    // stale local sections after an explicit import.
    appDataComplete.section
      ? (appDataComplete.section as SectionState)
      : initialSectionState,
  ),
);

export const { selectAll } = adapter.getSelectors();
