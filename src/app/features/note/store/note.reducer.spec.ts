import { Note, NoteState } from '../note.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { updateNote, updateNoteOrder } from './note.actions';
import { noteReducer } from './note.reducer';

describe('noteReducer Today ordering', () => {
  const note = (id: string, isPinnedToToday: boolean): Note => ({
    id,
    projectId: id === 'todayOnly' ? null : 'project',
    content: `Note ${id}`,
    created: 100,
    modified: 100,
    isPinnedToToday,
  });
  const baseline: NoteState = {
    ids: ['target', 'sibling', 'witness', 'todayOnly'],
    entities: {
      target: note('target', false),
      sibling: note('sibling', true),
      witness: note('witness', true),
      todayOnly: note('todayOnly', false),
    },
    todayOrder: ['sibling', 'witness', 'todayOnly'],
  };
  const reorder = updateNoteOrder({
    ids: ['witness', 'sibling', 'todayOnly'],
    activeContextType: WorkContextType.TAG,
    activeContextId: 'TODAY',
  });
  const pin = updateNote({ note: { id: 'target', changes: { isPinnedToToday: true } } });

  it('preserves a concurrent pin in either replay order', () => {
    const pinThenOrder = noteReducer(noteReducer(baseline, pin), reorder);
    const orderThenPin = noteReducer(noteReducer(baseline, reorder), pin);
    expect(pinThenOrder).toEqual(orderThenPin);
    expect(pinThenOrder.todayOrder).toEqual(['target', ...reorder.ids]);
    expect(pinThenOrder.entities).toEqual({
      ...baseline.entities,
      target: { ...baseline.entities.target!, isPinnedToToday: true },
    });
    expect(pinThenOrder.ids).toEqual(baseline.ids);
  });

  it('does not restore a removed Today member from a stale order', () => {
    const removed = noteReducer(
      baseline,
      updateNote({
        note: { id: 'sibling', changes: { isPinnedToToday: false } },
      }),
    );
    const result = noteReducer(removed, reorder);
    expect(result.todayOrder).toEqual(['witness', 'todayOnly']);
    expect(result.entities).toBe(removed.entities);
  });

  it('can replay the same order without duplicating the concurrent pin', () => {
    const once = noteReducer(noteReducer(baseline, pin), reorder);
    expect(noteReducer(once, reorder)).toEqual(once);
    expect(new Set(once.todayOrder).size).toBe(4);
  });

  it('leaves Today unchanged for project-note ordering', () => {
    expect(
      noteReducer(
        baseline,
        updateNoteOrder({
          ids: ['witness', 'target', 'sibling'],
          activeContextType: WorkContextType.PROJECT,
          activeContextId: 'project',
        }),
      ),
    ).toBe(baseline);
  });
});
