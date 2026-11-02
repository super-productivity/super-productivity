import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenuItem } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { BoardCfg } from '../boards.model';
import { BoardsService } from '../boards.service';

export type ViewMenuAction = 'edit' | 'duplicate' | 'delete';

export interface ViewMenuItem {
  action: ViewMenuAction;
  icon: string;
  /** A translation key. */
  label: string;
  isWarn?: boolean;
}

/**
 * A view's menu items. A host that owns a `mat-menu` renders them inside it
 * itself (the title bar): MatMenu's arrow keys only reach items written in the
 * menu's own template, not ones inside another component like `view-menu`.
 */
export const VIEW_MENU_ITEMS: readonly ViewMenuItem[] = [
  { action: 'edit', icon: 'edit', label: T.G.EDIT },
  { action: 'duplicate', icon: 'file_copy', label: T.G.DUPLICATE },
  { action: 'delete', icon: 'delete_forever', label: T.G.DELETE, isWarn: true },
];

export const runViewMenuAction = (
  boardsService: BoardsService,
  board: BoardCfg,
  action: ViewMenuAction,
): void => {
  switch (action) {
    case 'edit':
      void boardsService.editBoard(board);
      return;
    case 'duplicate':
      boardsService.duplicateBoard(board);
      return;
    case 'delete':
      boardsService.removeBoard(board);
      return;
  }
};

/** Menu items for a view, for menus that take a template (the side menu's rows). */
@Component({
  selector: 'view-menu',
  standalone: true,
  imports: [MatIcon, MatMenuItem, TranslatePipe],
  template: `
    @for (item of items; track item.action) {
      <button
        mat-menu-item
        (click)="run(item.action)"
      >
        <mat-icon [class.color-warn-i]="item.isWarn">{{ item.icon }}</mat-icon>
        <span>{{ item.label | translate }}</span>
      </button>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewMenuComponent {
  private readonly _boardsService = inject(BoardsService);
  board = input.required<BoardCfg>();
  readonly items = VIEW_MENU_ITEMS;

  run(action: ViewMenuAction): void {
    runViewMenuAction(this._boardsService, this.board(), action);
  }
}
