import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { nanoid } from 'nanoid';
import { selectAllBoards } from './store/boards.selectors';
import { BoardsActions } from './store/boards.actions';
import { BoardCfg } from './boards.model';
import { DEFAULT_BOARD_CFG } from './boards.const';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../t.const';

/**
 * Create, edit, duplicate and delete views (boards). Shared by the side menu
 * and the view page, so both behave the same.
 */
@Injectable({ providedIn: 'root' })
export class BoardsService {
  private _store = inject(Store);
  private _matDialog = inject(MatDialog);
  private _router = inject(Router);
  private _translateService = inject(TranslateService);

  readonly boards = this._store.selectSignal(selectAllBoards);

  // The edit dialog is loaded on demand: the side menu, which is always
  // loaded, uses this service too.
  async createBoard(): Promise<void> {
    const { DialogBoardEditComponent } =
      await import('./dialog-board-edit/dialog-board-edit.component');
    this._matDialog
      .open(DialogBoardEditComponent, {
        restoreFocus: true,
        data: { board: DEFAULT_BOARD_CFG, isCreate: true },
      })
      .afterClosed()
      .subscribe((boardId?: string) => {
        if (boardId) {
          this._router.navigate(['/boards', boardId]);
        }
      });
  }

  async editBoard(board: BoardCfg): Promise<void> {
    const { DialogBoardEditComponent } =
      await import('./dialog-board-edit/dialog-board-edit.component');
    this._matDialog.open(DialogBoardEditComponent, {
      restoreFocus: true,
      data: { board },
    });
  }

  duplicateBoard(board: BoardCfg): void {
    const id = nanoid();
    this._store.dispatch(
      BoardsActions.addBoard({
        board: {
          cols: board.cols,
          id,
          panels: board.panels.map((panel) => ({
            ...panel,
            id: nanoid(),
            taskIds: [],
          })),
          // Default views are titled with translation keys.
          title: `${this._translateService.instant(board.title)} (copy)`,
        },
      }),
    );
    this._router.navigate(['/boards', id]);
  }

  /** The view page leaves a deleted view by itself (it watches the board list). */
  removeBoard(board: BoardCfg): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          cancelTxt: T.G.CANCEL,
          okTxt: T.G.DELETE,
          message: T.F.BOARDS.V.CONFIRM_DELETE,
        },
      })
      .afterClosed()
      .subscribe((isConfirm: boolean) => {
        if (isConfirm) {
          this._store.dispatch(BoardsActions.removeBoard({ id: board.id }));
        }
      });
  }
}
