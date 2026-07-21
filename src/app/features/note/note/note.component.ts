import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  Input,
  OnChanges,
  signal,
  SimpleChanges,
  viewChild,
} from '@angular/core';
import { Note } from '../note.model';
import { NoteService } from '../note.service';
import { MatDialog } from '@angular/material/dialog';
import { T } from '../../../t.const';
import { openFullscreenMarkdownDialog } from '../../../ui/dialog-fullscreen-markdown/open-fullscreen-markdown-dialog';
import { firstValueFrom, Observable, of, ReplaySubject } from 'rxjs';
import { TagComponent, TagComponentTag } from '../../tag/tag/tag.component';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { WorkContextType } from '../../work-context/work-context.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { ProjectService } from '../../project/project.service';
import { Project } from '../../project/project.model';
import { EnlargeImgDirective } from '../../../ui/enlarge-img/enlarge-img.directive';
import { LongPressDirective } from '../../../ui/longpress/longpress.directive';
import { MarkdownComponent } from 'ngx-markdown';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { AsyncPipe, Location } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';
import {
  DRAFT_LOAD_ERROR,
  LocalDraftService,
} from '../../../core/draft/local-draft.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { getPhantomChangeRisk } from '../../../op-log/capture/phantom-change-guard.util';
import { Log } from '../../../core/log';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { RenderLinksPipe } from '../../../ui/pipes/render-links.pipe';
import { isPathSafeToOpen } from '../../../../../electron/shared-with-frontend/is-external-url-allowed';

@Component({
  selector: 'note',
  templateUrl: './note.component.html',
  styleUrls: ['./note.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EnlargeImgDirective,
    LongPressDirective,
    MarkdownComponent,
    MatIconButton,
    MatIcon,
    TagComponent,
    MatMenuTrigger,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    AsyncPipe,
    TranslatePipe,
    RenderLinksPipe,
  ],
})
export class NoteComponent implements OnChanges {
  private readonly _matDialog = inject(MatDialog);
  private readonly _location = inject(Location);
  private readonly _noteService = inject(NoteService);
  private readonly _projectService = inject(ProjectService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _clipboardImageService = inject(ClipboardImageService);
  private readonly _localDraftService = inject(LocalDraftService);
  private readonly _operationWriteFlush = inject(OperationWriteFlushService);
  private readonly _operationCapture = inject(OperationCaptureService);

  // Note ids whose fullscreen-open lifecycle is currently in flight. Serializes
  // opens per note so a second click during the async draft/conflict prelude
  // cannot stack a second editor loaded from the same stale snapshot (#8982).
  private readonly _openingNoteIds = new Set<string>();

  note!: Note;

  // The <img> src auto-loads on render (no click), so a synced remote file:// /
  // UNC imgUrl would silently leak the user's NTLM hash. Only a safe URL reaches
  // the [src]/[enlargeImg] bindings. See GHSA-hr87-735w-hfq3.
  safeImgUrl?: string;

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input('note') set noteSet(v: Note) {
    this.note = v;
    this.safeImgUrl = isPathSafeToOpen(v?.imgUrl) ? v.imgUrl : undefined;
    this._note$.next(v);
    this._updateNoteTxt();
  }

  readonly isFocus = input<boolean>();

  readonly markdownEl = viewChild<HTMLElement>('markdownEl');

  isLongNote?: boolean;
  shortenedNote?: string;
  resolvedContent = signal<string>('');
  resolvedShortenedContent = signal<string>('');

  T: typeof T = T;
  readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;

  projectTag$: Observable<TagComponentTag | null> =
    this._workContextService.activeWorkContextTypeAndId$.pipe(
      switchMap(({ activeType }) => {
        return activeType === WorkContextType.TAG
          ? this._note$.pipe(
              map((n) => n.projectId),
              distinctUntilChanged(),
              switchMap((pId) =>
                pId
                  ? this._projectService.getByIdOnceCatchError$(pId).pipe(
                      map((project) =>
                        project
                          ? {
                              ...project,
                              color: project.theme?.primary || DEFAULT_PROJECT_COLOR,
                              icon: project.icon || DEFAULT_PROJECT_ICON,
                              theme: {
                                primary: project.theme?.primary || DEFAULT_PROJECT_COLOR,
                              },
                            }
                          : null,
                      ),
                    )
                  : of(null),
              ),
            )
          : of(null);
      }),
    );

  _note$: ReplaySubject<Note> = new ReplaySubject(1);

  moveToProjectList$: Observable<Project[]> = this._note$.pipe(
    map((note) => note.projectId),
    distinctUntilChanged(),
    switchMap((pid) => this._projectService.getProjectsWithoutIdInTreeOrder$(pid)),
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.note) {
      this._updateNoteTxt();
    }
  }

  toggleLock(): void {
    if (!this.note) {
      throw new Error('No note');
    }
    this._noteService.update(this.note.id, { isLock: !this.note.isLock });
  }

  updateContent(newVal: any): void {
    if (!this.note) {
      throw new Error('No note');
    }
    this._noteService.update(this.note.id, { content: newVal });
  }

  removeNote(): void {
    if (!this.note) {
      throw new Error('No note');
    }
    const noteId = this.note.id;
    this._noteService.remove(this.note);
    // The note is gone, so its crash-safe draft can never be recovered onto it
    // again — drop it best-effort. The fullscreen DELETE path already clears its
    // draft; this covers deletion straight from the note menu (#8982 review).
    this._localDraftService.clearDraft('NOTE', noteId);
  }

  togglePinToToday(): void {
    if (!this.note) {
      throw new Error('No note');
    }
    this._noteService.update(this.note.id, {
      isPinnedToToday: !this.note.isPinnedToToday,
    });
  }

  async editFullscreen(event: MouseEvent): Promise<void> {
    if ((event as any)?.target?.tagName?.toUpperCase() === 'A') {
      return;
    }
    if (!this.note) {
      throw new Error('No note');
    }
    const note = this.note;
    // Guard the whole per-note open lifecycle. Opening is async (draft load plus
    // an optional conflict prompt), and a second click during that window would
    // stack a second editor loaded from the same stale snapshot — closing the
    // stale one after the first save then reverts it (#8982 review). Allow one
    // open per note id at a time; released in `finally` once the editor is up or
    // we bail out.
    if (this._openingNoteIds.has(note.id)) {
      return;
    }
    this._openingNoteIds.add(note.id);
    try {
      let contentToOpen = note.content;
      const draftOrError = await this._localDraftService.loadDraft('NOTE', note.id);
      // A failed read is not the same as "no draft": an unread recovery draft may
      // exist, so all draft handling (including writes and clears) is skipped for
      // this session rather than risking to overwrite or delete it.
      const isDraftUnreadable = draftOrError === DRAFT_LOAD_ERROR;
      const draft = isDraftUnreadable ? undefined : draftOrError;
      if (isDraftUnreadable) {
        Log.err('NoteComponent: Failed to load draft; draft handling disabled', note.id);
      } else if (draft && draft.content === note.content) {
        // The saved note already contains the draft, so it is no longer needed —
        // but only when that content is DURABLY persisted. note.content reflects
        // optimistic NgRx state here; a pending, failed, or sync-window-deferred
        // write means the durable copy is not on disk yet, so clearing would drop
        // the only recoverable copy (#8982 review). Keep the draft on any phantom
        // risk, and clear only the copy this session owns (content === draft.content).
        if (getPhantomChangeRisk(this._operationCapture) === null) {
          await this._localDraftService.clearDraftIfContent(
            'NOTE',
            note.id,
            draft.content,
          );
        }
      } else if (draft && draft.baseContent === note.content) {
        // Crash recovery: the draft was never saved — restore it.
        contentToOpen = draft.content;
      } else if (draft) {
        // The note changed since the draft was created (e.g. through sync).
        // Never auto-overwrite; let the user decide.
        const isReviewDraft = await firstValueFrom(
          this._matDialog
            .open(DialogConfirmComponent, {
              restoreFocus: true,
              data: {
                message: T.F.NOTE.D_DRAFT_CONFLICT.MSG,
                okTxt: T.F.NOTE.D_DRAFT_CONFLICT.REVIEW_DRAFT,
                cancelTxt: T.F.NOTE.D_DRAFT_CONFLICT.KEEP_SAVED,
              },
            })
            .afterClosed(),
        );
        if (isReviewDraft === true) {
          contentToOpen = draft.content;
        } else if (isReviewDraft === false) {
          // The user explicitly chose the saved version over the draft.
          await this._localDraftService.clearDraft('NOTE', note.id);
        } else {
          // No decision (undefined from ESC / backdrop / closeAll). Abort opening
          // the editor entirely: proceeding would let the checkpoint or a Discard
          // overwrite/delete the still-unresolved draft. Leave it intact so the
          // conflict prompt reappears on the next open.
          return;
        }
      }

      // Revalidate the captured snapshot after the async draft/conflict waits,
      // before opening. If the note was deleted or its content changed under us
      // (e.g. through sync) while we awaited, the captured `note` is stale;
      // opening it and dispatching its content on close would revert the newer
      // content (#8982 review).
      const current = this.note;
      if (!current || current.id !== note.id || current.content !== note.content) {
        return;
      }

      // Saves-and-closes on a navigation (resize across the mobile breakpoint,
      // Android back) instead of dropping the edit — see openFullscreenMarkdownDialog
      // (#8434).
      const dialogRef = openFullscreenMarkdownDialog(this._matDialog, this._location, {
        content: contentToOpen,
        ...(contentToOpen !== note.content ? { originalContent: note.content } : {}),
      });
      // Checkpoint the editor contents locally so they survive a crash.
      const contentChangedSub = isDraftUnreadable
        ? undefined
        : dialogRef.componentInstance.contentChanged.subscribe((content) =>
            this._localDraftService.saveDraft({
              entityType: 'NOTE',
              entityId: note.id,
              content,
              baseContent: note.content,
            }),
          );
      dialogRef.afterClosed().subscribe(async (res) => {
        contentChangedSub?.unsubscribe();
        if (!this.note) {
          throw new Error('No note');
        }
        // This removes the project note if the note is made empty and saved by the user.
        if (res?.action === 'DELETE') {
          this._noteService.remove(this.note);
          if (!isDraftUnreadable) {
            this._localDraftService.clearDraft('NOTE', note.id);
          }
        } else if (typeof res === 'string') {
          if (!isDraftUnreadable && res === note.content) {
            // Nothing unsaved: the editor is closing on the content already
            // persisted (ESC on an unedited open, or an edit reverted before
            // close). Keeping a draft here would arm a false "unsaved draft"
            // conflict prompt if the note later changes on another device. Clear
            // only once that content is durable (phantom-risk gate) and only the
            // checkpoint this session owns (content === res) — a newer session's
            // draft under the same key stays put.
            if (getPhantomChangeRisk(this._operationCapture) === null) {
              await this._localDraftService.clearDraftIfContent('NOTE', note.id, res);
            }
          } else if (!isDraftUnreadable) {
            // Persist the draft (baseContent = the still-current note content) and
            // AWAIT it BEFORE dispatching the note update, so a crash in the window
            // between the two leaves a durable draft the next open restores via the
            // baseContent === note.content branch. Best-effort: saveDraft swallows
            // its own write errors, so this resolves even on failure — the flush
            // below is what confirms durability, not this await.
            await this._localDraftService.saveDraft({
              entityType: 'NOTE',
              entityId: note.id,
              content: res,
              baseContent: note.content,
            });
          }
          // Uses the captured `note`, not `this.note`: the guard above ran before
          // the await, so re-reading the instance field here would be reading it
          // across the suspension point.
          this._noteService.update(note.id, { content: res });
          if (!isDraftUnreadable && res !== note.content) {
            try {
              // Clear only once the update is DURABLY persisted, not merely
              // dispatched. flushPendingWrites() drains the op-capture pending
              // counter (incremented synchronously by the meta-reducer, so it is
              // already >=1 here) and re-acquires the write lock. Draining proves
              // the write pipeline is idle, but NOT that the write succeeded, and
              // does not cover a sync-window-deferred action that never bumped the
              // counter — so gate on the full getPhantomChangeRisk predicate
              // (unrecovered failure + pending writes + deferred actions), not the
              // failure flag alone. Clear only the checkpoint this session owns
              // (content === res): a newer editor may have checkpointed different
              // content into the same key while the flush was in flight, and a
              // key-only clear would destroy it (#8982 review). A crash anywhere
              // before the clear also leaves the draft.
              await this._operationWriteFlush.flushPendingWrites();
              if (getPhantomChangeRisk(this._operationCapture) === null) {
                await this._localDraftService.clearDraftIfContent('NOTE', note.id, res);
              }
            } catch (e) {
              // Flush timed out (throws on MAX_WAIT_TIME) — keep the draft. Failing
              // here must leave MORE recoverable state, never less; a later open
              // still clears it via draft.content === note.content once persisted.
              Log.err('NoteComponent: flush before draft clear failed; keeping draft', e);
            }
          }
          // Discard — confirmed by the user in the dialog, so the draft goes too. Any
          // other result (undefined from a force-close) keeps the draft recoverable.
        } else if (res?.action === 'DISCARD' && !isDraftUnreadable) {
          this._localDraftService.clearDraft('NOTE', note.id);
        }
      });
    } finally {
      this._openingNoteIds.delete(note.id);
    }
  }

  trackByProjectId(i: number, project: Project): string {
    return project.id;
  }

  moveNoteToProject(projectId: string): void {
    if (projectId === this.note.projectId) {
      return;
    } else {
      this._noteService.moveToOtherProject(this.note, projectId);
    }
  }

  private _updateNoteTxt(): void {
    const LIMIT = 320;
    this.isLongNote = this.note.content.length > LIMIT;
    this.shortenedNote = this.note.content.slice(0, 160) + '\n\n (...)';
    this._updateResolvedContent();
  }

  private async _updateResolvedContent(): Promise<void> {
    const resolved = await this._clipboardImageService.resolveMarkdownImages(
      this.note.content,
    );
    this.resolvedContent.set(resolved);

    if (this.isLongNote && this.shortenedNote) {
      const resolvedShort = await this._clipboardImageService.resolveMarkdownImages(
        this.shortenedNote,
      );
      this.resolvedShortenedContent.set(resolvedShort);
    }
  }
}
