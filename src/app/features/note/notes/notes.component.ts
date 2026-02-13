import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  viewChild,
  OnInit,
} from '@angular/core';
import { NoteService } from '../note.service';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { DialogAddNoteComponent } from '../dialog-add-note/dialog-add-note.component';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { Note } from '../note.model';
import { T } from '../../../t.const';
import { WorkContextService } from '../../work-context/work-context.service';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { moveItemInArray } from '../../../util/move-item-in-array';
import { MatIcon } from '@angular/material/icon';
import { NoteComponent } from '../note/note.component';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DRAG_DELAY_FOR_TOUCH, HISTORY_STATE } from '../../../app.constants';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { LayoutService } from 'src/app/core-ui/layout/layout.service';
import { IS_MOBILE } from 'src/app/util/is-mobile';

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
    CdkDragHandle,
  ],
})
export class NotesComponent implements OnInit {
  noteService = inject(NoteService);
  workContextService = inject(WorkContextService);
  private _matDialog = inject(MatDialog);
  private _layoutService = inject(LayoutService);

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

  protected readonly DRAG_DELAY_FOR_TOUCH = DRAG_DELAY_FOR_TOUCH;
  protected readonly IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;
}
