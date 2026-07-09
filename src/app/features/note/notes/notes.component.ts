import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  viewChild,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NoteService } from '../note.service';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { DialogAddNoteComponent } from '../dialog-add-note/dialog-add-note.component';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { Note } from '../note.model';
import { T } from '../../../t.const';
import { WorkContextService } from '../../work-context/work-context.service';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { moveItemInArray } from '../../../util/move-item-in-array';
import { MatIcon } from '@angular/material/icon';
import { NoteComponent } from '../note/note.component';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { HISTORY_STATE } from '../../../app.constants';
import { dragDelayForTouch } from '../../../util/input-intent';
import { LayoutService } from 'src/app/core-ui/layout/layout.service';
import { IS_MOBILE } from 'src/app/util/is-mobile';
import { ActivatedRoute } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs/operators';

@Component({
  selector: 'notes',
  templateUrl: './notes.component.html',
  styleUrls: ['./notes.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation, fadeAnimation],
  imports: [
    MatButton,
    MatIcon,
    CdkDropList,
    CdkDrag,
    NoteComponent,
    AsyncPipe,
    TranslatePipe,
  ],
})
export class NotesComponent implements OnInit {
  noteService = inject(NoteService);
  workContextService = inject(WorkContextService);
  private _matDialog = inject(MatDialog);
  private _layoutService = inject(LayoutService);
  private _activatedRoute = inject(ActivatedRoute);
  private _destroyRef = inject(DestroyRef);

  private _focusToken?: object;
  private _focusNoteTimeout?: number;

  T: typeof T = T;
  isElementWasAdded: boolean = false;
  isDragOver: boolean = false;
  dragEnterTarget?: HTMLElement;

  readonly buttonEl = viewChild<MatButton>('buttonEl');

  @HostListener('dragenter', ['$event']) onDragEnter(ev: DragEvent): void {
    this.dragEnterTarget = ev.target as HTMLElement;
    ev.preventDefault();
    this.isDragOver = true;
  }

  @HostListener('dragleave', ['$event']) onDragLeave(ev: DragEvent): void {
    if (this.dragEnterTarget === (ev.target as HTMLElement)) {
      ev.preventDefault();
      this.isDragOver = false;
    }
  }

  @HostListener('drop', ['$event']) onDrop(ev: DragEvent): void {
    this.isDragOver = false;
    // This panel owns drops that land on it: claim the event synchronously so
    // the document-level "link → task" handler (AppComponent) doesn't ALSO fire
    // and create a duplicate task. createFromDrop's own stop/preventDefault run
    // after an `await` inside NoteService, which is too late to stop propagation.
    ev.preventDefault();
    ev.stopPropagation();
    this.noteService.createFromDrop(ev);
  }

  drop(event: CdkDragDrop<Note[] | null>): void {
    const previousIndex = event.previousIndex;
    const currentIndex = event.currentIndex;
    const notes = event.container.data;

    if (!notes) {
      return;
    }

    this.noteService.updateOrder(
      moveItemInArray(notes, previousIndex, currentIndex).map((note) => note.id),
    );
  }

  ngOnInit(): void {
    if (IS_MOBILE) {
      if (!window.history.state?.[HISTORY_STATE.NOTES]) {
        window.history.pushState({ [HISTORY_STATE.NOTES]: true }, '');
      }
    }

    this._destroyRef.onDestroy(() => {
      this._focusToken = undefined;
      window.clearTimeout(this._focusNoteTimeout);
    });

    this._activatedRoute.queryParams
      .pipe(
        map((params) => params.focusItem),
        distinctUntilChanged(),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((focusItem) => {
        if (focusItem) {
          this._focusNote(focusItem);
        } else {
          this._focusToken = undefined;
          window.clearTimeout(this._focusNoteTimeout);
        }
      });
  }

  private _focusNote(noteId: string): void {
    document.querySelectorAll('.highlight-searched-item').forEach((el) => {
      el.classList.remove('highlight-searched-item');
    });
    const id = `n-${noteId}`;
    const startTime = Date.now();
    const timeout = 4000;
    const token = {};
    this._focusToken = token;
    window.clearTimeout(this._focusNoteTimeout);

    const tryFocus = (): void => {
      if (this._focusToken !== token) {
        return;
      }
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-searched-item');
        setTimeout(() => {
          el.classList.remove('highlight-searched-item');
        }, 3000);
      } else if (Date.now() - startTime < timeout) {
        this._focusNoteTimeout = window.setTimeout(tryFocus, 100);
      }
    };
    tryFocus();
  }

  @HostListener('window:popstate')
  onBack(): void {
    // This prevents the project notes bottom sheet from closing automatically
    // when a note (dialog-fullscreen-markdown) was opened before and closed via back button
    if (IS_MOBILE) {
      if (!window.history.state?.[HISTORY_STATE.NOTES]) {
        this._layoutService.hideNotes();
      }
    }
  }

  addNote(): void {
    this._matDialog.open(DialogAddNoteComponent, {
      minWidth: '100vw',
      height: '100vh',
      restoreFocus: true,
      autoFocus: 'textarea',
    });
  }

  protected readonly dragDelayForTouch = dragDelayForTouch;
}
