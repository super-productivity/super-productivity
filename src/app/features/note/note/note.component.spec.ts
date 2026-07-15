import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Location } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { EMPTY, of, Subject } from 'rxjs';
import { NoteComponent } from './note.component';
import { Note } from '../note.model';
import { NoteService } from '../note.service';
import { ProjectService } from '../../project/project.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';
import {
  DRAFT_LOAD_ERROR,
  LocalDraft,
  LocalDraftService,
} from '../../../core/draft/local-draft.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { DialogFullscreenMarkdownComponent } from '../../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component';

describe('NoteComponent editFullscreen', () => {
  let component: NoteComponent;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let noteService: jasmine.SpyObj<NoteService>;
  let localDraftService: jasmine.SpyObj<LocalDraftService>;
  let contentChanged$: Subject<string>;
  let afterClosed$: Subject<unknown>;
  let confirmResult: boolean | undefined;

  const NOTE: Note = {
    id: 'note-1',
    content: 'saved content',
  } as Note;

  const draftOf = (content: string, baseContent: string): LocalDraft => ({
    key: `k:NOTE:${NOTE.id}`,
    entityType: 'NOTE',
    entityId: NOTE.id,
    profileId: 'p',
    content,
    baseContent,
    updatedAt: Date.now(),
  });

  const getFullscreenDialogData = (): any =>
    matDialog.open.calls
      .allArgs()
      .find((args) => args[0] === DialogFullscreenMarkdownComponent)?.[1]?.data;

  beforeEach(() => {
    contentChanged$ = new Subject<string>();
    afterClosed$ = new Subject<unknown>();
    confirmResult = undefined;

    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    matDialog.open.and.callFake((comp: any): any => {
      if (comp === DialogConfirmComponent) {
        return { afterClosed: () => of(confirmResult) };
      }
      return {
        componentInstance: { contentChanged: contentChanged$, close: () => {} },
        afterClosed: () => afterClosed$,
      };
    });

    noteService = jasmine.createSpyObj('NoteService', ['update', 'remove']);
    localDraftService = jasmine.createSpyObj('LocalDraftService', [
      'loadDraft',
      'saveDraft',
      'clearDraft',
    ]);
    localDraftService.loadDraft.and.resolveTo(undefined);
    localDraftService.saveDraft.and.resolveTo(undefined);
    localDraftService.clearDraft.and.resolveTo(undefined);

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

  it('should clear the draft and open the note content when the draft matches the note', async () => {
    localDraftService.loadDraft.and.resolveTo(draftOf('saved content', 'anything'));

    await editFullscreen();

    expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
    const data = getFullscreenDialogData();
    expect(data.content).toBe('saved content');
    expect(data.originalContent).toBeUndefined();
  });

  it('should seed the dialog with the draft content on crash recovery (baseContent matches note)', async () => {
    localDraftService.loadDraft.and.resolveTo(draftOf('draft content', 'saved content'));

    await editFullscreen();

    expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    const data = getFullscreenDialogData();
    expect(data.content).toBe('draft content');
    expect(data.originalContent).toBe('saved content');
  });

  it('should open the draft content when the user resolves a conflict with "review draft"', async () => {
    localDraftService.loadDraft.and.resolveTo(draftOf('draft content', 'other base'));
    confirmResult = true;

    await editFullscreen();

    expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    expect(getFullscreenDialogData().content).toBe('draft content');
  });

  it('should clear the draft and open the saved content when the user resolves a conflict with "keep saved"', async () => {
    localDraftService.loadDraft.and.resolveTo(draftOf('draft content', 'other base'));
    confirmResult = false;

    await editFullscreen();

    expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
    expect(getFullscreenDialogData().content).toBe('saved content');
  });

  it('should abort (not open the editor) and keep the draft when the conflict dialog is dismissed without a decision', async () => {
    localDraftService.loadDraft.and.resolveTo(draftOf('draft content', 'other base'));
    confirmResult = undefined; // ESC / backdrop / closeAll

    await editFullscreen();

    // Opening the editor here would let a checkpoint or Discard overwrite/delete
    // the still-unresolved draft, so we abort until the user actually chooses.
    expect(localDraftService.clearDraft).not.toHaveBeenCalled();
    expect(getFullscreenDialogData()).toBeUndefined();
  });

  it('should remove the note and clear the draft on a DELETE result', async () => {
    await editFullscreen();

    afterClosed$.next({ action: 'DELETE' });

    expect(noteService.remove).toHaveBeenCalledWith(NOTE);
    expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
  });

  it('should update the note and rewrite the draft with the final content on save', async () => {
    await editFullscreen();

    afterClosed$.next('final content');

    expect(noteService.update).toHaveBeenCalledWith(NOTE.id, {
      content: 'final content',
    });
    // The rewrite covers the debounce gap: the next open either lazily clears
    // it (persisted) or crash-recovers it (baseContent still matches).
    expect(localDraftService.saveDraft).toHaveBeenCalledWith({
      entityType: 'NOTE',
      entityId: NOTE.id,
      content: 'final content',
      baseContent: 'saved content',
    });
  });

  it('should keep the draft on a force-close (undefined result)', async () => {
    await editFullscreen();

    afterClosed$.next(undefined);

    expect(noteService.update).not.toHaveBeenCalled();
    expect(noteService.remove).not.toHaveBeenCalled();
    expect(localDraftService.clearDraft).not.toHaveBeenCalled();
  });

  it('should open the editor but skip all draft handling when the draft load fails', async () => {
    localDraftService.loadDraft.and.resolveTo(DRAFT_LOAD_ERROR);

    await editFullscreen();

    expect(getFullscreenDialogData().content).toBe('saved content');
    // No checkpointing: a transient read failure must not lead to overwriting
    // an unread recovery draft.
    contentChanged$.next('typed content');
    expect(localDraftService.saveDraft).not.toHaveBeenCalled();

    afterClosed$.next('final content');
    expect(noteService.update).toHaveBeenCalledWith(NOTE.id, {
      content: 'final content',
    });
    expect(localDraftService.saveDraft).not.toHaveBeenCalled();
    expect(localDraftService.clearDraft).not.toHaveBeenCalled();
  });
});
