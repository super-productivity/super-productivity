import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { BoardCfg } from '../boards.model';
import { nanoid } from 'nanoid';
import { Store } from '@ngrx/store';
import { BoardsActions } from '../store/boards.actions';
import { ViewEditorComponent } from '../view-editor/view-editor.component';

/** Saves what the view editor builds: one `addBoard` or `updateBoard`. */
@Component({
  selector: 'board-edit',
  standalone: true,
  imports: [ViewEditorComponent],
  templateUrl: './board-edit.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardEditComponent {
  private readonly _store = inject(Store);
  private readonly _editor = viewChild.required(ViewEditorComponent);

  /** The stored board; a new one has no id yet. */
  readonly board = input.required<BoardCfg>();
  readonly afterSave = output<string>();

  readonly isEdit = computed(() => !!this.board().id);
  readonly boardCfg = computed<BoardCfg>(() =>
    this.isEdit() ? this.board() : { ...this.board(), id: nanoid() },
  );

  /** Does nothing while a field is invalid (the editor shows why). */
  save(): void {
    // Normalized before dispatching, not only in the reducer: the op carries
    // the payload, and released clients store it as is.
    const board = this._editor().buildBoard();
    if (!board) {
      return;
    }
    if (this.isEdit()) {
      this._store.dispatch(BoardsActions.updateBoard({ id: board.id, updates: board }));
    } else {
      this._store.dispatch(BoardsActions.addBoard({ board }));
    }
    this.afterSave.emit(board.id);
  }

  removeBoard(): void {
    this._store.dispatch(BoardsActions.removeBoard({ id: this.board().id }));
  }
}
