import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import { Note, NoteState } from '../note.model';
import {
  addNote,
  deleteNote,
  moveNoteToOtherProject,
  updateNote,
  updateNoteOrder,
} from './note.actions';
import {
  Action,
  createFeatureSelector,
  createReducer,
  createSelector,
  on,
} from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { devError } from '../../../util/dev-error';
import { WorkContextType } from '../../work-context/work-context.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

export const adapter: EntityAdapter<Note> = createEntityAdapter<Note>();

export const initialNoteState: NoteState = adapter.getInitialState({
  todayOrder: [],
});

export const { selectIds, selectEntities, selectAll, selectTotal } =
  adapter.getSelectors();
export const NOTE_FEATURE_NAME = 'note';
export const selectNoteFeatureState = createFeatureSelector<NoteState>(NOTE_FEATURE_NAME);

export const selectAllNotes = createSelector(selectNoteFeatureState, selectAll);
export const selectNoteTodayOrder = createSelector(
  selectNoteFeatureState,
  (state: NoteState) => state.todayOrder,
);

export const selectNoteById = createSelector(
  selectNoteFeatureState,
  (state: NoteState, props: { id: string }): Note => {
    const n = state.entities[props.id];
    if (!n) {
      throw new Error('No note');
    }
    return n;
  },
);

export const selectNotesById = createSelector(
  selectNoteFeatureState,
  (state: NoteState, props: { ids: string[] }): Note[] =>
    props.ids.map((id: string) => {
      const note = state.entities[id];
      if (!note) {
        devError('Note data not found for ' + id);
      }
      return note as Note;
    }),
);

const _reducer = createReducer<NoteState>(
  initialNoteState,

  // META ACTIONS
  // ------------
  on(loadAllData, (state, { appDataComplete }) =>
    appDataComplete.note ? appDataComplete.note : state,
  ),

  on(TaskSharedActions.deleteProject, (state, { noteIds }) => {
    return adapter.removeMany(noteIds, {
      ...state,
      todayOrder: state.todayOrder.filter((idI) => !noteIds.includes(idI)),
    });
  }),

  on(updateNoteOrder, (state, { ids, activeContextType }) =>
    activeContextType !== WorkContextType.PROJECT
      ? {
          ...state,
          todayOrder: ids,
          // ids: unique([...ids, ...state.ids]),
        }
      : state,
  ),

  on(addNote, (state, { note }) => ({
    ...state,
    entities: {
      ...state.entities,
      [note.id]: note,
    },
    // add to top rather than bottom
    ids: [note.id, ...state.ids],
    todayOrder: note.isPinnedToToday ? [note.id, ...state.todayOrder] : state.todayOrder,
  })),

  on(updateNote, (state, { note }) => {
    if ('isPinnedToToday' in note.changes) {
      return {
        ...state,
        ...adapter.updateOne(note, state),
        todayOrder: note.changes.isPinnedToToday
          ? [note.id as string, ...state.todayOrder]
          : state.todayOrder.filter((id) => id !== note.id),
      };
    }
    return adapter.updateOne(note, state);
  }),

  on(deleteNote, (state, { id }) => {
    return {
      ...adapter.removeOne(id, state),
      todayOrder: state.todayOrder.filter((i) => i !== id),
    };
  }),

  on(moveNoteToOtherProject, (state, { targetProjectId, note }) =>
    adapter.updateOne(
      {
        id: note.id,
        changes: {
          projectId: targetProjectId,
        },
      },
      state,
    ),
  ),
);

export const noteReducer = (
  state: NoteState = initialNoteState,
  action: Action,
): NoteState => _reducer(state, action);
