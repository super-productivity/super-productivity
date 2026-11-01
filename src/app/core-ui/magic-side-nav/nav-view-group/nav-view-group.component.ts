import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatDivider } from '@angular/material/divider';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NavItemComponent } from '../nav-item/nav-item.component';
import { NavItem, NavViewGroupItem } from '../magic-side-nav.model';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { expandCollapseAni } from '../../../ui/tree-dnd/tree.animations';
import { BoardsService } from '../../../features/boards/boards.service';
import { BoardCfg } from '../../../features/boards/boards.model';
import { BoardsActions } from '../../../features/boards/store/boards.actions';
import { moveItemInArray } from '../../../util/move-item-in-array';
import { dragDelayForTouch } from '../../../util/input-intent';
import { T } from '../../../t.const';
import { ViewMenuComponent } from '../../../features/boards/view-menu/view-menu.component';
import { getViewIcon } from '../../../features/boards/boards.util';
import { VIEW_TEMPLATES } from '../../../features/boards/view-templates';

/** The Views section of the side menu: one route row per board (view). */
@Component({
  selector: 'nav-view-group',
  standalone: true,
  imports: [
    CdkDrag,
    CdkDropList,
    MatIcon,
    MatIconButton,
    MatDivider,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    NavItemComponent,
    TranslatePipe,
    ViewMenuComponent,
  ],
  templateUrl: './nav-view-group.component.html',
  // The section header and rows look like the Projects and Tags sections.
  styleUrls: [
    '../nav-list/nav-list-tree.component.scss',
    './nav-view-group.component.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandCollapseAni],
  host: {
    ['[@.disabled]']: '!isAnimationEnabled()',
  },
})
export class NavViewGroupComponent {
  private readonly _store = inject(Store);
  private readonly _translateService = inject(TranslateService);
  private readonly _navConfigService = inject(MagicNavConfigService);
  readonly boardsService = inject(BoardsService);

  item = input.required<NavViewGroupItem>();
  showLabels = input<boolean>(true);
  isExpanded = input<boolean>(false);

  itemClick = output<NavItem>();

  readonly T = T;
  readonly viewTemplates = VIEW_TEMPLATES;
  readonly dragDelayForTouch = dragDelayForTouch;
  // Off for the first render, so an open section doesn't animate in on start.
  readonly isAnimationEnabled = signal(false);

  // Read here, not passed in through the nav config: boards change on every
  // drop into a column, which must not rebuild the whole side menu.
  readonly rows = computed(() =>
    this.boardsService.boards().map((board) => ({
      board,
      route: `/boards/${board.id}`,
      icon: getViewIcon(board),
    })),
  );

  constructor() {
    afterNextRender(() => this.isAnimationEnabled.set(true));
  }

  onHeaderClick(): void {
    this.itemClick.emit(this.item());
  }

  onRowClick(board: BoardCfg): void {
    // Routes navigate by themselves; the click only closes the mobile menu.
    this.itemClick.emit({
      type: 'route',
      id: `view-${board.id}`,
      label: board.title,
      icon: '',
      route: `/boards/${board.id}`,
    });
  }

  drop(ev: CdkDragDrop<BoardCfg[]>): void {
    if (ev.previousIndex === ev.currentIndex) {
      return;
    }
    const ids = moveItemInArray(
      this.boardsService.boards(),
      ev.previousIndex,
      ev.currentIndex,
    ).map((board) => board.id);
    this._store.dispatch(BoardsActions.sortBoards({ ids }));
  }

  disableFeature(): void {
    this._navConfigService.disableFeature(
      'isBoardsEnabled',
      this._translateService.instant(this.item().label),
    );
  }
}
