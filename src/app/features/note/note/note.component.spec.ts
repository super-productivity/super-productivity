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
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';

describe('NoteComponent editFullscreen', () => {
  let component: NoteComponent;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let noteService: jasmine.SpyObj<NoteService>;
  let localDraftService: jasmine.SpyObj<LocalDraftService>;
  let flushService: jasmine.SpyObj<OperationWriteFlushService>;
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

    flushService = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
    ]);
    flushService.flushPendingWrites.and.resolveTo(undefined);

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
        { provide: OperationWriteFlushService, useValue: flushService },
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

  it('should persist the draft BEFORE dispatching the note update on save (durability ordering)', async () => {
    const callOrder: string[] = [];
    // Push on RESOLUTION, not invocation: the guarantee is that saveDraft has
    // *resolved* before dispatch (the crash-safety window), not merely that it
    // was called first. A fake that pushes synchronously at call time stays green
    // even if the production `await` is deleted — the exact false-positive
    // johannesjo found by mutation-testing this spec (#8982 review).
    localDraftService.saveDraft.and.callFake(async () => {
      await Promise.resolve();
      callOrder.push('saveDraft');
    });
    noteService.update.and.callFake(() => {
      callOrder.push('update');
    });

    await editFullscreen();

    afterClosed$.next('final content');
    // The subscriber awaits saveDraft before dispatching, so let the microtask
    // queue drain before asserting the update landed.
    await Promise.resolve();
    await Promise.resolve();

    // The draft (with the about-to-be-saved content, baseContent still the
    // current note) is written durably first; only then is the update dispatched
    // and (after the flush) the draft cleared.
    expect(localDraftService.saveDraft).toHaveBeenCalledWith({
      entityType: 'NOTE',
      entityId: NOTE.id,
      content: 'final content',
      baseContent: 'saved content',
    });
    expect(noteService.update).toHaveBeenCalledWith(NOTE.id, {
      content: 'final content',
    });
    // Ordering is the crash-safety guarantee: draft durable before dispatch.
    // Drop the production `await` and this flips to ['update', 'saveDraft'].
    expect(callOrder).toEqual(['saveDraft', 'update']);
  });

  it('does not clear the draft until the update is durably persisted (flush gates the clear)', async () => {
    let resolveFlush!: () => void;
    flushService.flushPendingWrites.and.returnValue(
      new Promise<void>((r) => (resolveFlush = r)),
    );

    await editFullscreen();

    afterClosed$.next('final content');
    await Promise.resolve();
    await Promise.resolve();

    // Dispatched, but the flush hasn't resolved — this is the crash window. The
    // draft MUST survive it, or a crash here loses the edit.
    expect(noteService.update).toHaveBeenCalledWith(NOTE.id, {
      content: 'final content',
    });
    expect(localDraftService.clearDraft).not.toHaveBeenCalled();

    resolveFlush();
    await Promise.resolve();
    await Promise.resolve();

    // Drop the `await` before clearDraft and it clears while the flush is still
    // pending -> this expectation goes red.
    expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
  });

  it('keeps the draft when the flush times out (fail-safe direction)', async () => {
    flushService.flushPendingWrites.and.rejectWith(new Error('flush timeout'));

    await editFullscreen();

    afterClosed$.next('final content');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Failing must leave MORE recoverable state, never less: the note was still
    // dispatched, but the draft is kept so the next open can recover it.
    expect(noteService.update).toHaveBeenCalledWith(NOTE.id, {
      content: 'final content',
    });
    expect(localDraftService.clearDraft).not.toHaveBeenCalled();
  });

  it('clears the draft (does not save one) when closing on unchanged content', async () => {
    await editFullscreen();

    // ESC on an unedited open, or an edit reverted before close: res equals the
    // note content, so there is nothing unsaved to recover.
    afterClosed$.next('saved content');
    await Promise.resolve();
    await Promise.resolve();

    expect(localDraftService.saveDraft).not.toHaveBeenCalled();
    expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
    // No durable-persistence gate needed for a no-op: nothing unsaved existed, so
    // the flush is skipped entirely.
    expect(flushService.flushPendingWrites).not.toHaveBeenCalled();
  });

  it('checkpoints the editor contents while typing (crash-safety premise)', async () => {
    await editFullscreen();

    // The while-typing checkpoint IS the crash-safety premise (type, crash,
    // recover). Delete the contentChanged -> saveDraft subscription in production
    // and this is the only test that goes red.
    contentChanged$.next('typed so far');

    expect(localDraftService.saveDraft).toHaveBeenCalledWith({
      entityType: 'NOTE',
      entityId: NOTE.id,
      content: 'typed so far',
      baseContent: 'saved content',
    });
  });

  it('should remove the note and clear its draft when deleted from the note menu', () => {
    component.removeNote();

    expect(noteService.remove).toHaveBeenCalledWith(NOTE);
    // The fullscreen DELETE path already clears; this covers menu-deletion, which
    // otherwise left the draft behind to recover onto a note that no longer exists.
    expect(localDraftService.clearDraft).toHaveBeenCalledWith('NOTE', NOTE.id);
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
