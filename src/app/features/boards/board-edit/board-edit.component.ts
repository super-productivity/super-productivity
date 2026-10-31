import {
  ChangeDetectionStrategy,
  Component,
  inject,
  model,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormlyModule } from '@ngx-formly/core';
import { BoardCfg } from '../boards.model';
import { BOARDS_FORM } from '../boards-form.const';
import { UntypedFormGroup } from '@angular/forms';
import { nanoid } from 'nanoid';
import { Store } from '@ngrx/store';
import { BoardsActions } from '../store/boards.actions';
import { normalizeBoardForSave, toEditorModel } from '../boards.util';

@Component({
  selector: 'board-edit',
  standalone: true,
  imports: [FormlyModule],
  templateUrl: './board-edit.component.html',
  styleUrl: './board-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardEditComponent implements OnInit {
  store = inject(Store);
  boardCfg = model.required<BoardCfg>();
  isEdit = signal(false);
  afterSave = output<string>();

  form: UntypedFormGroup = new UntypedFormGroup({});

  protected readonly BOARDS_FORM = BOARDS_FORM;

  ngOnInit(): void {
    if (this.boardCfg().id) {
      this.isEdit.set(true);
    } else {
      this.boardCfg.set({ ...this.boardCfg(), id: nanoid() });
    }

    // Defaults for legacy data, and the panel sort as one select value.
    this.boardCfg.set(toEditorModel(this.boardCfg()));
  }

  save(): void {
    if (this.form.valid) {
      // Normalize before dispatching, not only in the reducer: the op carries
      // the payload, and released clients store it as is (e.g. Formly's null).
      const boardCfg = normalizeBoardForSave(this.boardCfg());
      if (this.isEdit()) {
        this.store.dispatch(
          BoardsActions.updateBoard({ id: boardCfg.id, updates: boardCfg }),
        );
      } else {
        this.store.dispatch(BoardsActions.addBoard({ board: boardCfg }));
      }
      this.afterSave.emit(boardCfg.id);
    }
  }

  removeBoard(): void {
    this.store.dispatch(BoardsActions.removeBoard({ id: this.boardCfg().id }));
  }
}
