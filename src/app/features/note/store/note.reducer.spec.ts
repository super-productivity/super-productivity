import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { Note, NoteState } from '../note.model';
import {
  initialNoteState,
  noteReducer,
  selectNoteById,
  selectNotesById,
} from './note.reducer';
import {
  addNote,
  deleteNote,
  moveNoteToOtherProject,
  updateNote,
  updateNoteOrder,
} from './note.actions';

const createNote = (id: string, partial: Partial<Note> = {}): Note => ({
  id,
  projectId: 'projectA',
  isPinnedToToday: false,
  content: `note-${id}`,
  created: 1,
  modified: 1,
  ...partial,
});

const createState = (notes: Note[], todayOrder: string[] = []): NoteState => ({
  ids: notes.map((note) => note.id),
  entities: notes.reduce(
    (acc, note) => {
      acc[note.id] = note;
      return acc;
    },
    {} as Record<string, Note>,
  ),
  todayOrder,
});

describe('note.reducer', () => {
  it('should add a note to the top and pin it to today order when applicable', () => {
    const existing = createNote('n1');
    const state = createState([existing], []);
    const newPinned = createNote('n2', { isPinnedToToday: true });

    const result = noteReducer(state, addNote({ note: newPinned }));

    expect(result.ids).toEqual(['n2', 'n1']);
    expect(result.entities['n2']).toEqual(newPinned);
    expect(result.todayOrder).toEqual(['n2']);
  });

  it('should update pinning and keep today order in sync', () => {
    const note = createNote('n1', { isPinnedToToday: false });
    const state = createState([note], []);

    const pinned = noteReducer(
      state,
      updateNote({ note: { id: 'n1', changes: { isPinnedToToday: true } } }),
    );
    expect(pinned.todayOrder).toEqual(['n1']);

    const unpinned = noteReducer(
      pinned,
      updateNote({ note: { id: 'n1', changes: { isPinnedToToday: false } } }),
    );
    expect(unpinned.todayOrder).toEqual([]);
  });

  it('should update note order only for non-project contexts', () => {
    const n1 = createNote('n1');
    const n2 = createNote('n2');
    const state = createState([n1, n2], ['n1', 'n2']);

    const forTag = noteReducer(
      state,
      updateNoteOrder({
        ids: ['n2', 'n1'],
        activeContextType: WorkContextType.TAG,
        activeContextId: 'TODAY',
      }),
    );
    expect(forTag.todayOrder).toEqual(['n2', 'n1']);

    const forProject = noteReducer(
      forTag,
      updateNoteOrder({
        ids: ['n1', 'n2'],
        activeContextType: WorkContextType.PROJECT,
        activeContextId: 'projectA',
      }),
    );
    expect(forProject.todayOrder).toEqual(['n2', 'n1']);
  });

  it('should remove note and today order entry when deleting', () => {
    const n1 = createNote('n1', { isPinnedToToday: true });
    const n2 = createNote('n2');
    const state = createState([n1, n2], ['n1']);

    const result = noteReducer(
      state,
      deleteNote({ id: 'n1', projectId: 'projectA', isPinnedToToday: true }),
    );

    expect(result.entities['n1']).toBeUndefined();
    expect(result.ids).toEqual(['n2']);
    expect(result.todayOrder).toEqual([]);
  });

  it('should move note to another project', () => {
    const note = createNote('n1', { projectId: 'p1' });
    const state = createState([note]);

    const result = noteReducer(
      state,
      moveNoteToOtherProject({ note, targetProjectId: 'p2' }),
    );

    expect(result.entities['n1']?.projectId).toBe('p2');
  });

  it('should remove project notes via shared deleteProject action', () => {
    const keep = createNote('n1');
    const remove = createNote('n2', { isPinnedToToday: true });
    const state = createState([keep, remove], ['n2']);

    const result = noteReducer(
      state,
      TaskSharedActions.deleteProject({
        projectId: 'projectA',
        noteIds: ['n2'],
        allTaskIds: [],
      }),
    );

    expect(result.entities['n1']).toBeDefined();
    expect(result.entities['n2']).toBeUndefined();
    expect(result.todayOrder).toEqual([]);
  });

  it('should replace note state on loadAllData when note payload exists', () => {
    const loadedState = createState([createNote('loaded')], ['loaded']);

    const result = noteReducer(
      initialNoteState,
      loadAllData({ appDataComplete: { note: loadedState } as never }),
    );

    expect(result).toEqual(loadedState);
  });

  it('should throw from selectNoteById when note does not exist', () => {
    const state = createState([createNote('n1')]);

    expect(() => selectNoteById.projector(state, { id: 'missing' })).toThrowError(
      'No note',
    );
  });

  it('should select notes by id in input order', () => {
    const n1 = createNote('n1');
    const n2 = createNote('n2');
    const state = createState([n1, n2]);

    const result = selectNotesById.projector(state, { ids: ['n2', 'n1'] });

    expect(result).toEqual([n2, n1]);
  });
});
