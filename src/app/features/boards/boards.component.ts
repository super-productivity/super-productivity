import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { MatTab, MatTabContent, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { Store } from '@ngrx/store';
import { T } from '../../t.const';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { nanoid } from 'nanoid';
import { BoardComponent } from './board/board.component';
import { CdkScrollable } from '@angular/cdk/overlay';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectAllBoards } from './store/boards.selectors';
import { LS } from '../../core/persistence/storage-keys.const';
import { TranslatePipe } from '@ngx-translate/core';
import { BoardEditComponent } from './board-edit/board-edit.component';
import { DEFAULT_BOARD_CFG } from './boards.const';
import { BoardsActions } from './store/boards.actions';
import { BoardCfg } from './boards.model';
import { MatDialog } from '@angular/material/dialog';
import { DialogBoardEditComponent } from './dialog-board-edit/dialog-board-edit.component';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { Log } from 'src/app/core/log';

@Component({
  selector: 'boards',
  standalone: true,
  imports: [
    MatMenuModule,
    MatTabGroup,
    MatTab,
    MatIcon,
    MatTabContent,
    MatTabLabel,
    BoardComponent,
    CdkScrollable,
    CdkDropListGroup,
    TranslatePipe,
    BoardEditComponent,
  ],
  templateUrl: './boards.component.html',
  styleUrl: './boards.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardsComponent {
  private _matDialog = inject(MatDialog);
  store = inject(Store);
  elementRef = inject(ElementRef);
  selectedTabIndex = signal(localStorage.getItem(LS.SELECTED_BOARD) || 0);

  boards = toSignal(this.store.select(selectAllBoards));
  protected readonly T = T;

  DEFAULT_BOARD_CFG = DEFAULT_BOARD_CFG;

  constructor() {
    effect(() => {
      localStorage.setItem(LS.SELECTED_BOARD, this.selectedTabIndex().toString());
    });
  }

  goToLastIndex(): void {
    // NOTE: since the index number does not change (the add tab index is at the same index as the newly added tab) we need to do this in two steps
    const newIndex = (this.boards()?.length || 1) - 1;
    setTimeout(() => {
      this.selectedTabIndex.set(newIndex + 1);
      setTimeout(() => {
        this.selectedTabIndex.set(newIndex);
      }, 10);
    });
  }

  // Tab change happens before the click event gets to the callback.
  // We need to delay updating the selected tab index until the click event has completed
  // propagation.
  onTabChange(index: number): void {
    setTimeout(() => this.selectedTabIndex.set(index));
  }

  get componentElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }

  duplicateBoard(boardToDuplicate: BoardCfg): void {
    if (!boardToDuplicate) {
      Log.warn('No board selected to duplicate');
      return;
    }
    this.store.dispatch(
      BoardsActions.addBoard({
        board: {
          cols: boardToDuplicate.cols,
          id: nanoid(),
          panels: boardToDuplicate.panels.map((panel) => ({
            ...panel,
            taskIds: [],
          })),
          title: `${boardToDuplicate.title} (copy)`,
        },
      }),
    );
  }

  editBoard(board: BoardCfg): void {
    if (!board) {
      Log.warn('No board selected to edit');
      return;
    }
    this._matDialog.open(DialogBoardEditComponent, {
      data: {
        board: board,
      },
    });
  }

  removeBoard(board: BoardCfg): void {
    if (!board) {
      Log.warn('No board selected to remove');
      return;
    }
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
          this.store.dispatch(BoardsActions.removeBoard({ id: board.id }));
        }
      });
  }
}
