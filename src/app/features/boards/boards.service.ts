import { inject, Injectable, signal } from '@angular/core';
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
import { GlobalConfigService } from '../config/global-config.service';
import { AppFeaturesConfig } from '../config/global-config.model';
import { SnackService } from '../../core/snack/snack.service';

/**
 * Create, edit, duplicate and delete views (boards). Shared by the side menu,
 * the view page's empty state and the boards' own edit buttons.
 */
@Injectable({ providedIn: 'root' })
export class BoardsService {
  private _store = inject(Store);
  private _matDialog = inject(MatDialog);
  private _router = inject(Router);
  private _translateService = inject(TranslateService);
  private _globalConfigService = inject(GlobalConfigService);
  private _snackService = inject(SnackService);

  readonly boards = this._store.selectSignal(selectAllBoards);

  /**
   * A view just created here (Create, Save as view, Duplicate) that the view
   * page hasn't shown yet: it enters with an arrival motion. Local only.
   */
  private readonly _arrivalId = signal<string | null>(null);
  readonly arrivalId = this._arrivalId.asReadonly();

  /** The view page showed the arrival (or never will). */
  clearArrival(): void {
    this._arrivalId.set(null);
  }

  // The edit dialog is loaded on demand: the side menu, which is always
  // loaded, uses this service too.
  /** Opens the create dialog, empty or prefilled (e.g. "Save as view"). */
  async createBoard(
    board: BoardCfg = DEFAULT_BOARD_CFG,
    hints: string[] = [],
  ): Promise<void> {
    const { DialogBoardEditComponent } =
      await import('./dialog-board-edit/dialog-board-edit.component');
    this._matDialog
      .open(DialogBoardEditComponent, {
        restoreFocus: true,
        panelClass: 'fullscreen-xs-dialog',
        data: { board, isCreate: true, hints },
      })
      .afterClosed()
      .subscribe((boardId?: string) => {
        if (boardId) {
          // "Save as view" is offered while Views are off: saving one turns
          // them on, so the new view has its place in the menu.
          if (!this._globalConfigService.appFeatures()?.isBoardsEnabled) {
            this._globalConfigService.updateSection(
              'appFeatures',
              { isBoardsEnabled: true } as Partial<AppFeaturesConfig>,
              true,
            );
          }
          this._openCreated(boardId);
        }
      });
  }

  async editBoard(board: BoardCfg): Promise<void> {
    const { DialogBoardEditComponent } =
      await import('./dialog-board-edit/dialog-board-edit.component');
    this._matDialog.open(DialogBoardEditComponent, {
      restoreFocus: true,
      panelClass: 'fullscreen-xs-dialog',
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
    this._openCreated(id);
  }

  /**
   * Opens a view that was just created, with a clear arrival: the page lets
   * it enter (`viewSwitch`), and a snack names it, since on phones the side
   * menu where its row appears is hidden.
   */
  private _openCreated(id: string): void {
    const title = this.boards().find((board) => board.id === id)?.title;
    this._arrivalId.set(id);
    this._router.navigate(['/boards', id]);
    if (title) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.BOARDS.V.VIEW_CREATED,
        // Default views are titled with translation keys.
        translateParams: { title: this._translateService.instant(title) },
      });
    }
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
