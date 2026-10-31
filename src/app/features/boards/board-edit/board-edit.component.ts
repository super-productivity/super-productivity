import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
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
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { Store } from '@ngrx/store';
import { BoardsActions } from '../store/boards.actions';
import { DEFAULT_BOARD_CFG, DEFAULT_PANEL_CFG } from '../boards.const';
import { withDueStateImpliesScheduled } from '../boards.util';

@Component({
  selector: 'board-edit',
  standalone: true,
  imports: [FormlyModule, MatButton, MatIcon, TranslatePipe],
  templateUrl: './board-edit.component.html',
  styleUrl: './board-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardEditComponent implements OnInit {
  store = inject(Store);
  boardCfg = model.required<BoardCfg>();
  isEdit = signal(false);
  isHideBtns = input<boolean>(false);
  afterSave = output<string>();

  form: UntypedFormGroup = new UntypedFormGroup({});

  protected readonly BOARDS_FORM = BOARDS_FORM;

  ngOnInit(): void {
    if (this.boardCfg().id) {
      this.isEdit.set(true);
    } else {
      this.boardCfg.set({ ...this.boardCfg(), id: nanoid() });
    }

    // be safe with legacy data (only required for my current SP config)
    const boardCfg = this.boardCfg();
    this.boardCfg.set({
      ...DEFAULT_BOARD_CFG,
      ...boardCfg,
      // Ensure each panel has all default properties
      panels:
        boardCfg.panels?.map((panel) => ({
          ...DEFAULT_PANEL_CFG,
          ...panel,
        })) || [],
    });
  }

  protected readonly T = T;

  save(): void {
    if (this.form.valid) {
      const boardCfg = withDueStateImpliesScheduled(this.boardCfg());
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
