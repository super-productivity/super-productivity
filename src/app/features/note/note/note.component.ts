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
  getDraftOpenAction,
  LocalDraftService,
} from '../../../core/draft/local-draft.service';
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

  // Note ids whose fullscreen-open lifecycle is currently in flight. Serializes
  // opens per note so a second click during an async draft-conflict prompt
  // cannot stack a second editor loaded from the same stale snapshot.
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
    this._noteService.remove(this.note);
    // The note is gone, so no draft under this key can ever be recovered onto
    // anything again; leaving full note content behind would be worse.
    this._localDraftService.clearDraft('NOTE', this.note.id);
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
    if (this._openingNoteIds.has(note.id)) {
      return;
    }
    this._openingNoteIds.add(note.id);
    try {
      let contentToOpen = note.content;
      const draft = this._localDraftService.loadDraft('NOTE', note.id);
      if (draft) {
        const action = getDraftOpenAction(draft, note.content);
        if (action === 'IGNORE') {
          // The note already holds the draft text (typically a crash landed
          // between the save and its cleanup). Consume the leftover so a later
          // remote edit cannot turn it into a spurious conflict prompt.
          this._localDraftService.clearDraft('NOTE', note.id);
        } else if (action === 'RESTORE') {
          // Crash recovery: seed the editor with the unsaved text. The draft
          // stays stored until the user saves or discards it below.
          contentToOpen = draft.content;
        } else {
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
            this._localDraftService.clearDraft('NOTE', note.id);
          } else {
            // No decision (ESC / backdrop / closeAll). Leave the draft intact
            // so the prompt reappears, and do not open the editor on a
            // question the user just dismissed.
            return;
          }
        }
      }

      // Revalidate after the async prompt: if the note was deleted or changed
      // underneath it (e.g. through sync), the captured snapshot is stale and
      // dispatching its content on close would revert the newer content.
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
      const contentChangedSub = dialogRef.componentInstance.contentChanged.subscribe(
        (content) => {
          this._localDraftService.saveDraft({
            entityType: 'NOTE',
            entityId: note.id,
            content,
            baseContent: note.content,
          });
        },
      );
      dialogRef.afterClosed().subscribe(async (res) => {
        contentChangedSub.unsubscribe();
        if (!this.note) {
          throw new Error('No note');
        }
        // This removes the project note if the note is made empty and saved by the user.
        if (res?.action === 'DELETE') {
          this._noteService.remove(this.note);
          this._localDraftService.clearDraft('NOTE', note.id);
          // This updates the note, when the user clicks the "Save" button.
        } else if (typeof res === 'string') {
          this._noteService.update(note.id, { content: res });
          // The dispatch is synchronous, so the store already holds the text;
          // the draft is consumed. (Should the async op-log write behind the
          // dispatch fail AND the app crash, the text is lost with the draft —
          // an accepted double-failure window; every ordinary crash is covered
          // by the draft staying alive until this very line.)
          //
          // Unless the note vanished while the editor was open (deleted on
          // another device, synced here): updateOne drops the update for a
          // missing entity and NOTE has no recreate fallback, so the draft is
          // then the only surviving copy — keep it.
          const { entities } = await firstValueFrom(this._noteService.state$);
          if (entities[note.id]) {
            this._localDraftService.clearDraft('NOTE', note.id);
          }
        } else if (res?.action === 'DISCARD') {
          // Confirmed by the user in the dialog. Any other result (undefined
          // from a force-close/disposal) leaves the draft for crash recovery.
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
