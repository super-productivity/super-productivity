import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Location } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { EMPTY, Observable, of, Subject } from 'rxjs';
import { NoteComponent } from './note.component';
import { Note } from '../note.model';
import { NoteService } from '../note.service';
import { NoteState } from '../note.model';
import { ProjectService } from '../../project/project.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';
import { LocalDraft, LocalDraftService } from '../../../core/draft/local-draft.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { DialogFullscreenMarkdownComponent } from '../../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component';

describe('NoteComponent draft lifecycle', () => {
  let component: NoteComponent;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let noteService: jasmine.SpyObj<NoteService>;
  let localDraftService: jasmine.SpyObj<LocalDraftService>;
  let contentChanged$: Subject<string>;
  let afterClosed$: Subject<unknown>;
  let confirmClosed$: Observable<boolean | undefined>;

  const NOTE: Note = {
    id: 'note-1',
    content: 'saved content',
  } as Note;

  const draftOf = (content: string, baseContent: string): LocalDraft => ({
    content,
    baseContent,
    updatedAt: Date.now(),
  });

  const getFullscreenDialogData = (): any =>
    matDialog.open.calls
      .allArgs()
      .find((args) => args[0] === DialogFullscreenMarkdownComponent)?.[1]?.data;

  const isFullscreenDialogOpened = (): boolean => getFullscreenDialogData() !== undefined;

  beforeEach(() => {
    contentChanged$ = new Subject<string>();
    afterClosed$ = new Subject<unknown>();
    confirmClosed$ = of(undefined);

    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    matDialog.open.and.callFake((comp: any): any => {
      if (comp === DialogConfirmComponent) {
        return { afterClosed: () => confirmClosed$ };
      }
      return {
        componentInstance: { contentChanged: contentChanged$, close: () => {} },
        afterClosed: () => afterClosed$,
      };
    });

    noteService = jasmine.createSpyObj('NoteService', ['update', 'remove']);
    noteService.state$ = of({ entities: { [NOTE.id]: NOTE } } as unknown as NoteState);
    localDraftService = jasmine.createSpyObj('LocalDraftService', [
      'loadDraft',
      'saveDraft',
      'clearDraft',
    ]);
    localDraftService.loadDraft.and.returnValue(undefined);

    const clipboardImageService = jasmine.createSpyObj('ClipboardImageService', [
      'resolveMarkdownImages',
    ]);
    clipboardImageService.resolveMarkdownImages.and.callFake((content: string) =>
      Promise.resolve(content),
    );

    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: matDialog },
        { provide: Location, useValue: { subscribe: () => ({ unsubscribe: () => {} }) } },
        { provide: NoteService, useValue: noteService },
        {
          provide: ProjectService,
          useValue: { getProjectsWithoutIdInTreeOrder$: () => EMPTY },
        },
        { provide: WorkContextService, useValue: { activeWorkContextTypeAndId$: EMPTY } },
        { provide: ClipboardImageService, useValue: clipboardImageService },
        { provide: LocalDraftService, useValue: localDraftService },
      ],
    });

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      component = new NoteComponent();
    });
    component.noteSet = NOTE;
  });

  const editFullscreen = (): Promise<void> => component.editFullscreen({} as MouseEvent);

  // The save close-path awaits a store read before consuming the draft.
  const flushCloseHandler = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve));

  describe('opening', () => {
    it('opens with the note content when no draft exists', async () => {
      await editFullscreen();

      expect(getFullscreenDialogData()).toEqual({ content: NOTE.content });
      expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    });

    it('consumes a leftover draft the note already holds (crash landed between save and cleanup)', async () => {
      // Left in place, a later remote edit would turn it into a spurious
      // conflict prompt offering the note's own old text back.
      localDraftService.loadDraft.and.returnValue(draftOf(NOTE.content, 'older base'));

      await editFullscreen();

      expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
      expect(getFullscreenDialogData()).toEqual({ content: NOTE.content });
    });

    it('restores a crash draft into the editor when the note is unchanged, keeping the draft stored', async () => {
      localDraftService.loadDraft.and.returnValue(draftOf('typed text', NOTE.content));

      await editFullscreen();

      // originalContent keeps the discard confirmation anchored to the
      // persisted note content rather than the recovered draft.
      expect(getFullscreenDialogData()).toEqual({
        content: 'typed text',
        originalContent: NOTE.content,
      });
      // The draft must survive until the user saves or discards: clearing on
      // open would lose the text again on a second crash.
      expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    });
  });

  describe('conflict prompt (note changed underneath the draft)', () => {
    beforeEach(() => {
      localDraftService.loadDraft.and.returnValue(draftOf('typed text', 'older base'));
    });

    it('opens the editor with the draft when the user chooses to review it', async () => {
      confirmClosed$ = of(true);

      await editFullscreen();

      expect(getFullscreenDialogData()).toEqual({
        content: 'typed text',
        originalContent: NOTE.content,
      });
      expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    });

    it('clears the draft and opens the saved version when the user keeps it', async () => {
      confirmClosed$ = of(false);

      await editFullscreen();

      expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
      expect(getFullscreenDialogData()).toEqual({ content: NOTE.content });
    });

    it('keeps the draft and does not open the editor when the prompt is dismissed', async () => {
      confirmClosed$ = of(undefined);

      await editFullscreen();

      expect(localDraftService.clearDraft).not.toHaveBeenCalled();
      expect(isFullscreenDialogOpened()).toBe(false);
    });

    it('ignores a second click while the prompt is pending', async () => {
      const pendingConfirm$ = new Subject<boolean>();
      confirmClosed$ = pendingConfirm$.asObservable();

      const first = editFullscreen();
      await editFullscreen();

      expect(
        matDialog.open.calls
          .allArgs()
          .filter((args) => args[0] === DialogConfirmComponent).length,
      ).toBe(1);
      pendingConfirm$.next(false);
      pendingConfirm$.complete();
      await first;
    });

    it('does not open the editor when the note changed while the prompt was up', async () => {
      // The captured snapshot is stale; dispatching its content on close would
      // revert whatever changed it (e.g. a sync) in the meantime.
      const pendingConfirm$ = new Subject<boolean>();
      confirmClosed$ = pendingConfirm$.asObservable();

      const opening = editFullscreen();
      component.noteSet = { ...NOTE, content: 'changed by sync meanwhile' } as Note;
      pendingConfirm$.next(true);
      pendingConfirm$.complete();
      await opening;

      expect(isFullscreenDialogOpened()).toBe(false);
    });
  });

  describe('while editing', () => {
    it('checkpoints the editor content against the note content at session start', async () => {
      await editFullscreen();

      contentChanged$.next('typed so far');

      expect(localDraftService.saveDraft).toHaveBeenCalledWith({
        entityType: 'NOTE',
        entityId: NOTE.id,
        content: 'typed so far',
        baseContent: NOTE.content,
      });
    });

    it('stops checkpointing once the dialog has closed', async () => {
      await editFullscreen();
      afterClosed$.next('final text');

      contentChanged$.next('late debounce emission');

      expect(localDraftService.saveDraft).not.toHaveBeenCalled();
    });
  });

  describe('closing', () => {
    it('updates the note and clears the draft on save', async () => {
      await editFullscreen();

      afterClosed$.next('final text');
      await flushCloseHandler();

      expect(noteService.update).toHaveBeenCalledWith(NOTE.id, {
        content: 'final text',
      });
      expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
    });

    it('keeps the draft when the note no longer exists after the save dispatch', async () => {
      // Deleted on another device (and synced here) while the editor was
      // open: updateOne drops the update for a missing entity and NOTE has no
      // recreate fallback, so the draft is the only surviving copy.
      noteService.state$ = of({ entities: {} } as unknown as NoteState);
      await editFullscreen();
      contentChanged$.next('typed so far');

      afterClosed$.next('typed so far');
      await flushCloseHandler();

      expect(noteService.update).toHaveBeenCalled();
      expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    });

    it('clears the draft without updating on a user-confirmed discard', async () => {
      await editFullscreen();

      afterClosed$.next({ action: 'DISCARD' });

      expect(noteService.update).not.toHaveBeenCalled();
      expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
    });

    it('keeps the draft on a disposal without result (crash stand-in)', async () => {
      // closeAll(), overlay disposal etc. emit undefined: the user neither
      // saved nor discarded, so the text must stay recoverable.
      await editFullscreen();
      contentChanged$.next('typed so far');

      afterClosed$.next(undefined);

      expect(noteService.update).not.toHaveBeenCalled();
      expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    });

    it('removes the note and clears the draft when the note was emptied and saved', async () => {
      await editFullscreen();

      afterClosed$.next({ action: 'DELETE' });

      expect(noteService.remove).toHaveBeenCalled();
      expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
    });
  });

  describe('removeNote', () => {
    it('clears the draft along with the note', () => {
      component.removeNote();

      expect(noteService.remove).toHaveBeenCalled();
      expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
    });
  });
});
