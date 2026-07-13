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
      // The saved note already contains the draft, so it is no longer needed.
      await this._localDraftService.clearDraft('NOTE', note.id);
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
      }
      // Anything else (undefined from ESC / backdrop / closeAll) is no
      // decision: open the saved content but keep the draft recoverable.
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
    dialogRef.afterClosed().subscribe((res) => {
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
        // This updates the note, when the user clicks the "Save" button. The draft
        // is rewritten with the saved content: if the update persists, the next
        // open sees draft.content === note.content and lazily clears it; if it
        // crashes before persisting, baseContent === note.content and the
        // crash-recovery branch restores it.
      } else if (typeof res === 'string') {
        this._noteService.update(this.note.id, { content: res });
        if (!isDraftUnreadable) {
          this._localDraftService.saveDraft({
            entityType: 'NOTE',
            entityId: note.id,
            content: res,
            baseContent: note.content,
          });
        }
        // Discard — confirmed by the user in the dialog, so the draft goes too. Any
        // other result (undefined from a force-close) keeps the draft recoverable.
      } else if (res?.action === 'DISCARD' && !isDraftUnreadable) {
        this._localDraftService.clearDraft('NOTE', note.id);
      }
    });
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
