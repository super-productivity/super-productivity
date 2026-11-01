import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenuItem } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { BoardCfg } from '../boards.model';
import { BoardsService } from '../boards.service';

/** Menu items for a view: shared by its side-menu row and the title bar. */
@Component({
  selector: 'view-menu',
  standalone: true,
  imports: [MatIcon, MatMenuItem, TranslatePipe],
  template: `
    <button
      mat-menu-item
      (click)="boardsService.editBoard(board())"
    >
      <mat-icon>edit</mat-icon>
      <span>{{ T.G.EDIT | translate }}</span>
    </button>
    <button
      mat-menu-item
      (click)="boardsService.duplicateBoard(board())"
    >
      <mat-icon>file_copy</mat-icon>
      <span>{{ T.G.DUPLICATE | translate }}</span>
    </button>
    <button
      mat-menu-item
      (click)="boardsService.removeBoard(board())"
    >
      <mat-icon class="color-warn-i">delete_forever</mat-icon>
      <span>{{ T.G.DELETE | translate }}</span>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewMenuComponent {
  readonly boardsService = inject(BoardsService);
  board = input.required<BoardCfg>();
  protected readonly T = T;
}
