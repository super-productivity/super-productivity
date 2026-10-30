import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { LocalRestApiNoteRoutesService } from './local-rest-api-note-routes.service';
import { NoteService } from './note.service';
import { Note } from './note.model';
import { ProjectService } from '../project/project.service';
import { Project } from '../project/project.model';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiNoteRoutesService', () => {
  let service: LocalRestApiNoteRoutesService;
  let noteServiceMock: jasmine.SpyObj<NoteService>;
  let notes$: BehaviorSubject<Note[]>;

  const createNote = (id: string, overrides: Partial<Note> = {}): Note => ({
    id,
    projectId: 'p1',
    isPinnedToToday: false,
    content: `Note ${id}`,
    created: 1,
    modified: 1,
    ...overrides,
  });

  const request = (
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method,
    path,
    query,
    body,
  });

  const handle = async (
    req: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> => {
    const response = await service.handle(req);
    if (!response) {
      throw new Error(`Route not handled: ${req.method} ${req.path}`);
    }
    return response;
  };

  const errorCode = (response: LocalRestApiResponsePayload): string | undefined =>
    response.body.ok ? undefined : response.body.error.code;

  const data = <T>(response: LocalRestApiResponsePayload): T => {
    if (!response.body.ok) {
      throw new Error(`Expected success, got ${response.body.error.code}`);
    }
    return response.body.data as T;
  };

  const expectNoDispatch = (): void => {
    expect(noteServiceMock.add).not.toHaveBeenCalled();
    expect(noteServiceMock.update).not.toHaveBeenCalled();
    expect(noteServiceMock.remove).not.toHaveBeenCalled();
    expect(noteServiceMock.moveToOtherProject).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    notes$ = new BehaviorSubject<Note[]>([
      createNote('n1'),
      createNote('n2', { projectId: 'p2' }),
      createNote('today', { projectId: null, isPinnedToToday: true }),
    ]);

    noteServiceMock = jasmine.createSpyObj<NoteService>(
      'NoteService',
      ['getByIdOnce$', 'add', 'update', 'remove', 'moveToOtherProject'],
      { notes$ },
    );
    // Like the store's selectNoteById: throws for a missing id.
    noteServiceMock.getByIdOnce$.and.throwError('Note not found');
    // Like NoteService.add with a project in view.
    noteServiceMock.add.and.callFake((note: Partial<Note> = {}) => {
      notes$.next([
        {
          ...createNote('generated'),
          content: '',
          ...note,
        } as Note,
        ...notes$.value,
      ]);
    });
    noteServiceMock.update.and.callFake((id, changes) => {
      notes$.next(notes$.value.map((n) => (n.id === id ? { ...n, ...changes } : n)));
    });
    noteServiceMock.remove.and.callFake((note) => {
      notes$.next(notes$.value.filter((n) => n.id !== note.id));
    });
    noteServiceMock.moveToOtherProject.and.callFake((note, targetProjectId) => {
      notes$.next(
        notes$.value.map((n) =>
          n.id === note.id ? { ...n, projectId: targetProjectId } : n,
        ),
      );
    });

    const projects = [
      { id: 'p1', isArchived: false },
      { id: 'p2', isArchived: false },
      { id: 'archived', isArchived: true },
    ] as Project[];

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiNoteRoutesService,
        { provide: NoteService, useValue: noteServiceMock },
        { provide: ProjectService, useValue: { list: signal(projects) } },
      ],
    });
    service = TestBed.inject(LocalRestApiNoteRoutesService);
  });

  describe('routing', () => {
    it('does not handle routes it does not own', async () => {
      expect(await service.handle(request('GET', '/tasks'))).toBeUndefined();
      expect(await service.handle(request('GET', '/notesx'))).toBeUndefined();
      expect(await service.handle(request('PUT', '/notes'))).toBeUndefined();
      expect(await service.handle(request('DELETE', '/notes'))).toBeUndefined();
      expect(await service.handle(request('POST', '/notes/n1'))).toBeUndefined();
      expect(await service.handle(request('PUT', '/notes/n1'))).toBeUndefined();
      expect(await service.handle(request('GET', '/notes/n1/extra'))).toBeUndefined();
      expectNoDispatch();
    });

    it('handles a trailing slash', async () => {
      const response = await handle(request('GET', '/notes/'));
      expect(response.status).toBe(200);
    });
  });

  describe('GET /notes', () => {
    it('lists all notes', async () => {
      const response = await handle(request('GET', '/notes'));
      expect(response.status).toBe(200);
      expect(data<Note[]>(response).map((n) => n.id)).toEqual(['n1', 'n2', 'today']);
    });

    it('filters by projectId', async () => {
      const response = await handle(
        request('GET', '/notes', undefined, { projectId: 'p2' }),
      );
      expect(data<Note[]>(response).map((n) => n.id)).toEqual(['n2']);
    });

    it('returns an empty list for an unknown projectId', async () => {
      const response = await handle(
        request('GET', '/notes', undefined, { projectId: 'nope' }),
      );
      expect(data<Note[]>(response)).toEqual([]);
    });
  });

  describe('GET /notes/:id', () => {
    it('returns the note', async () => {
      const response = await handle(request('GET', '/notes/n2'));
      expect(response.status).toBe(200);
      expect(data<Note>(response).id).toBe('n2');
    });

    it('returns 404 for an unknown id without the throwing getByIdOnce$', async () => {
      const response = await handle(request('GET', '/notes/missing'));
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('NOTE_NOT_FOUND');
      expect(noteServiceMock.getByIdOnce$).not.toHaveBeenCalled();
    });

    it('does not resolve prototype members as notes', async () => {
      const response = await handle(request('GET', '/notes/__proto__'));
      expect(errorCode(response)).toBe('NOTE_NOT_FOUND');
    });
  });

  describe('POST /notes', () => {
    it('creates a note and returns it with 201', async () => {
      const response = await handle(
        request('POST', '/notes', { content: 'Hello', projectId: 'p2' }),
      );
      expect(response.status).toBe(201);
      const created = data<Note>(response);
      expect(created.content).toBe('Hello');
      expect(created.projectId).toBe('p2');
      const passed = noteServiceMock.add.calls.mostRecent().args[0] as Partial<Note>;
      expect(passed.id).toBe(created.id);
      expect(passed).toEqual({
        content: 'Hello',
        projectId: 'p2',
        isPinnedToToday: false,
        id: created.id,
      });
      expect(noteServiceMock.getByIdOnce$).not.toHaveBeenCalled();
    });

    it('passes project and pin explicitly so the view in use does not decide', async () => {
      // NoteService.add falls back to the active context for missing fields.
      await handle(
        request('POST', '/notes', { content: 'Pinned', isPinnedToToday: true }),
      );
      expect(noteServiceMock.add.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({ projectId: null, isPinnedToToday: true }),
      );

      await handle(request('POST', '/notes', { content: 'In p1', projectId: 'p1' }));
      expect(noteServiceMock.add.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({ projectId: 'p1', isPinnedToToday: false }),
      );
    });

    it('creates a pinned note without a project when projectId is left out', async () => {
      const response = await handle(
        request('POST', '/notes', { content: 'Hello', isPinnedToToday: true }),
      );
      expect(response.status).toBe(201);
      expect(data<Note>(response)).toEqual(
        jasmine.objectContaining({ projectId: null, isPinnedToToday: true }),
      );
    });

    it('creates a note in the given project, pinned when asked', async () => {
      const response = await handle(
        request('POST', '/notes', {
          content: 'Hello',
          projectId: 'p2',
          isPinnedToToday: true,
        }),
      );
      expect(response.status).toBe(201);
      expect(data<Note>(response)).toEqual(
        jasmine.objectContaining({ projectId: 'p2', isPinnedToToday: true }),
      );
    });

    it('creates a note pinned to Today without a project', async () => {
      const response = await handle(
        request('POST', '/notes', {
          content: 'Hello',
          projectId: null,
          isPinnedToToday: true,
        }),
      );
      expect(response.status).toBe(201);
      expect(data<Note>(response).projectId).toBeNull();
      expect(data<Note>(response).isPinnedToToday).toBe(true);
    });

    it('rejects a note that would show up nowhere', async () => {
      for (const body of [
        { content: 'Hello' },
        { content: 'Hello', projectId: null },
        { content: 'Hello', isPinnedToToday: false },
        { content: 'Hello', projectId: null, isPinnedToToday: false },
      ]) {
        const response = await handle(request('POST', '/notes', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('rejects missing, empty and whitespace-only content', async () => {
      for (const body of [{}, { content: '' }, { content: '   ' }, { content: 42 }]) {
        const response = await handle(request('POST', '/notes', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('rejects a body that is not an object', async () => {
      for (const body of [undefined, null, 'text', 42, ['content']]) {
        const response = await handle(request('POST', '/notes', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('rejects wrongly typed fields with details', async () => {
      const response = await handle(
        request('POST', '/notes', {
          content: 'Hi',
          projectId: 1,
          isPinnedToToday: 'yes',
        }),
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      const details = response.body.ok ? undefined : response.body.error.details;
      expect(details).toEqual(
        jasmine.arrayContaining([
          jasmine.objectContaining({ path: '$input.projectId' }),
          jasmine.objectContaining({ path: '$input.isPinnedToToday' }),
        ]),
      );
      expectNoDispatch();
    });

    it('rejects fields that are not writable', async () => {
      const response = await handle(
        request('POST', '/notes', { content: 'Hi', id: 'mine', imgUrl: 'x' }),
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expectNoDispatch();
    });

    it('returns 404 for an unknown or archived project', async () => {
      for (const projectId of ['nope', 'archived', '', '__proto__']) {
        const response = await handle(
          request('POST', '/notes', { content: 'Hi', projectId }),
        );
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
      expectNoDispatch();
    });
  });

  describe('PATCH /notes/:id', () => {
    it('updates content and pin and returns the note', async () => {
      const response = await handle(
        request('PATCH', '/notes/n1', { content: 'Changed', isPinnedToToday: true }),
      );
      expect(response.status).toBe(200);
      expect(noteServiceMock.update).toHaveBeenCalledOnceWith('n1', {
        content: 'Changed',
        isPinnedToToday: true,
      });
      expect(data<Note>(response).content).toBe('Changed');
      expect(data<Note>(response).isPinnedToToday).toBe(true);
      expect(noteServiceMock.getByIdOnce$).not.toHaveBeenCalled();
    });

    it('allows emptying the content', async () => {
      const response = await handle(request('PATCH', '/notes/n1', { content: '' }));
      expect(response.status).toBe(200);
      expect(data<Note>(response).content).toBe('');
    });

    it('moves the note to another project with the move action', async () => {
      const response = await handle(request('PATCH', '/notes/n1', { projectId: 'p2' }));
      expect(response.status).toBe(200);
      expect(noteServiceMock.moveToOtherProject).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ id: 'n1', projectId: 'p1' }),
        'p2',
      );
      expect(noteServiceMock.update).not.toHaveBeenCalled();
      expect(data<Note>(response).projectId).toBe('p2');
    });

    it('moves a Today note into a project and keeps it pinned', async () => {
      const response = await handle(
        request('PATCH', '/notes/today', { projectId: 'p1' }),
      );
      expect(response.status).toBe(200);
      expect(noteServiceMock.moveToOtherProject).toHaveBeenCalledTimes(1);
      expect(noteServiceMock.update).not.toHaveBeenCalled();
      expect(data<Note>(response)).toEqual(
        jasmine.objectContaining({ projectId: 'p1', isPinnedToToday: true }),
      );
    });

    it('rejects a move combined with other changes (one request, one op)', async () => {
      for (const body of [
        { projectId: 'p2', content: 'Changed' },
        { projectId: 'p2', isPinnedToToday: true },
        { projectId: 'p2', content: 'Note n1', isPinnedToToday: false },
      ]) {
        const response = await handle(request('PATCH', '/notes/n1', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('treats the current projectId as no move next to other changes', async () => {
      const response = await handle(
        request('PATCH', '/notes/n1', { projectId: 'p1', content: 'Changed' }),
      );
      expect(response.status).toBe(200);
      expect(noteServiceMock.moveToOtherProject).not.toHaveBeenCalled();
      expect(noteServiceMock.update).toHaveBeenCalledOnceWith('n1', {
        content: 'Changed',
      });
    });

    it('dispatches nothing for unchanged values', async () => {
      const response = await handle(
        request('PATCH', '/notes/n1', {
          content: 'Note n1',
          projectId: 'p1',
          isPinnedToToday: false,
        }),
      );
      expect(response.status).toBe(200);
      expect(data<Note>(response).id).toBe('n1');
      expectNoDispatch();
    });

    it('rejects unpinning a note without a project', async () => {
      const response = await handle(
        request('PATCH', '/notes/today', { isPinnedToToday: false }),
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('rejects clearing the project', async () => {
      const response = await handle(request('PATCH', '/notes/n1', { projectId: null }));
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('returns 404 for an unknown or archived project', async () => {
      for (const projectId of ['nope', 'archived']) {
        const response = await handle(request('PATCH', '/notes/n1', { projectId }));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
      expectNoDispatch();
    });

    it('returns 404 for an unknown note', async () => {
      const response = await handle(request('PATCH', '/notes/missing', { content: 'x' }));
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('NOTE_NOT_FOUND');
      expect(noteServiceMock.getByIdOnce$).not.toHaveBeenCalled();
      expectNoDispatch();
    });

    it('rejects a body that is not an object', async () => {
      for (const body of [undefined, null, 'text', ['content']]) {
        const response = await handle(request('PATCH', '/notes/n1', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('rejects wrongly typed fields', async () => {
      const response = await handle(
        request('PATCH', '/notes/n1', { content: 3, isPinnedToToday: 'no' }),
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('rejects fields that are not writable', async () => {
      const response = await handle(
        request('PATCH', '/notes/n1', { created: 5, backgroundColor: 'red' }),
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expectNoDispatch();
    });
  });

  describe('DELETE /notes/:id', () => {
    it('deletes the note', async () => {
      const response = await handle(request('DELETE', '/notes/n2'));
      expect(response.status).toBe(200);
      expect(data<unknown>(response)).toEqual({ deleted: true, id: 'n2' });
      expect(noteServiceMock.remove).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ id: 'n2', projectId: 'p2' }),
      );
      expect(notes$.value.map((n) => n.id)).toEqual(['n1', 'today']);
    });

    it('returns 404 for an unknown note', async () => {
      const response = await handle(request('DELETE', '/notes/missing'));
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('NOTE_NOT_FOUND');
      expect(noteServiceMock.getByIdOnce$).not.toHaveBeenCalled();
      expectNoDispatch();
    });
  });
});
