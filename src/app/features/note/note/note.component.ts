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
import { DialogFullscreenMarkdownComponent } from '../../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component';
import { Observable, of, ReplaySubject } from 'rxjs';
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
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';

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
  ],
})
export class NoteComponent implements OnChanges {
  private readonly _matDialog = inject(MatDialog);
  private readonly _noteService = inject(NoteService);
  private readonly _projectService = inject(ProjectService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _clipboardImageService = inject(ClipboardImageService);

  note!: Note;

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input('note') set noteSet(v: Note) {
    this.note = v;
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
                              icon: 'list',
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
    switchMap((pid) => this._projectService.getProjectsWithoutId$(pid)),
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

  editFullscreen(event: MouseEvent): void {
    if ((event as any)?.target?.tagName?.toUpperCase() === 'A') {
      return;
    }
    if (!this.note) {
      throw new Error('No note');
    }
    this._matDialog
      .open(DialogFullscreenMarkdownComponent, {
        minWidth: '100vw',
        height: '100vh',
        restoreFocus: true,
        autoFocus: 'textarea',
        data: {
          content: this.note.content,
        },
      })
      .afterClosed()
      .subscribe((res) => {
        if (!this.note) {
          throw new Error('No note');
        }
        // This removes the project note if the note is made empty and saved by the user.
        if (res?.action === 'DELETE') {
          this._noteService.remove(this.note);
          // This updates the note, when the user clicks the "Save" button.
        } else if (typeof res === 'string') {
          this._noteService.update(this.note.id, { content: res });
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
