import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { NoteService } from './note.service';
import { Note } from './note.model';
import { deleteNote } from './store/note.actions';
import { WorkContextService } from '../work-context/work-context.service';

describe('NoteService', () => {
  let service: NoteService;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NoteService,
        provideMockStore(),
        { provide: WorkContextService, useValue: {} },
      ],
    });
    service = TestBed.inject(NoteService);
    store = TestBed.inject(MockStore);
  });

  describe('remove', () => {
    // #10380: the conflict resolver recreates a note whose local delete lost
    // to a remote edit from this payload. Without the whole note it restores a
    // note lacking content and created, which fails validation.
    it('dispatches deleteNote carrying the whole deleted note', () => {
      const dispatchSpy = spyOn(store, 'dispatch');
      const note: Note = {
        id: 'n1',
        projectId: 'p1',
        isPinnedToToday: true,
        content: 'content',
        isLock: true,
        created: 1,
        modified: 2,
      };

      service.remove(note);

      expect(dispatchSpy).toHaveBeenCalledOnceWith(
        deleteNote({ id: 'n1', projectId: 'p1', isPinnedToToday: true, note }),
      );
    });
  });
});
