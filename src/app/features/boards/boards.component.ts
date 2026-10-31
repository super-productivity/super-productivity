import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { BoardComponent } from './board/board.component';
import { LS } from '../../core/persistence/storage-keys.const';
import { setSelectedTask } from '../tasks/store/task.actions';
import { TaskMultiSelectService } from '../tasks/task-multi-select.service';
import { BoardsService } from './boards.service';
import { viewSwitchAnimation } from './boards.ani';

/**
 * One view (board) per route: `/boards/:boardId`. `BoardRouteGuard` resolves
 * `/boards` to a view, so this page only shows the "no views" state when there
 * is no id.
 */
@Component({
  selector: 'boards',
  standalone: true,
  imports: [BoardComponent, CdkDropListGroup, MatButton, MatIcon, TranslatePipe],
  templateUrl: './boards.component.html',
  styleUrl: './boards.component.scss',
  animations: [viewSwitchAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardsComponent {
  private _route = inject(ActivatedRoute);
  private _router = inject(Router);
  private _store = inject(Store);
  private _multiSelect = inject(TaskMultiSelectService);
  readonly boardsService = inject(BoardsService);

  readonly boardId = toSignal(
    this._route.paramMap.pipe(map((params) => params.get('boardId'))),
    { initialValue: null },
  );
  readonly board = computed(() => {
    const id = this.boardId();
    return id ? this.boardsService.boards().find((board) => board.id === id) : undefined;
  });
  protected readonly T = T;

  constructor() {
    effect(() => {
      const id = this.boardId();
      untracked(() => {
        // Selection and the open task belong to the view that was left.
        this._multiSelect.clear();
        this._store.dispatch(setSelectedTask({ id: null }));
        if (id) {
          localStorage.setItem(LS.SELECTED_BOARD, id);
        }
      });
    });

    // The open view was deleted (here, in its dialog or on another device).
    effect(() => {
      if (this.boardId() && !this.board()) {
        untracked(() => this._router.navigate(['/boards'], { replaceUrl: true }));
      }
    });
  }
}
