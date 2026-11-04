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
import {
  getViewSwitchState,
  VIEW_ARRIVAL_FROM_XS,
  VIEW_SWITCH_FROM,
  viewSwitchAnimation,
  ViewSwitchParams,
} from './boards.ani';
import { BreakpointObserver } from '@angular/cdk/layout';
import { getViewLayout } from './boards.util';

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
  /** The `viewSwitch` state: a switch of view or of mode animates. */
  readonly switchState = computed(() => {
    const board = this.board();
    return board ? getViewSwitchState(board) : null;
  });
  private readonly _layout = computed(() => {
    const board = this.board();
    return board ? getViewLayout(board) : null;
  });
  protected readonly T = T;

  private readonly _isXs = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 599px)')
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );
  /** A view just created comes in forward; on phones from the right. */
  readonly switchParams = computed<ViewSwitchParams>(() => {
    const isArrival =
      !!this.boardId() && this.boardId() === this.boardsService.arrivalId();
    return {
      isArrival,
      from: isArrival && this._isXs() ? VIEW_ARRIVAL_FROM_XS : VIEW_SWITCH_FROM,
    };
  });

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

    // A mode switch replaces the list or columns a multi-selection is scoped
    // to. The open task stays.
    effect(() => {
      this._layout();
      untracked(() => this._multiSelect.clear());
    });

    // The open view was deleted (here, in its dialog or on another device).
    effect(() => {
      if (this.boardId() && !this.board()) {
        untracked(() => this._router.navigate(['/boards'], { replaceUrl: true }));
      }
    });
  }

  /** The new view has arrived: later visits switch to it as usual. */
  onSwitchDone(toState: string): void {
    const board = this.board();
    if (
      board &&
      board.id === this.boardsService.arrivalId() &&
      toState === getViewSwitchState(board)
    ) {
      this.boardsService.clearArrival();
    }
  }
}
