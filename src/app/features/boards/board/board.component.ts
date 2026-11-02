/* eslint-disable @typescript-eslint/naming-convention */
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  untracked,
  viewChildren,
} from '@angular/core';
import { BoardCfg } from '../boards.model';
import {
  BoardPanelComponent,
  BoardPanelNavigation,
} from '../board-panel/board-panel.component';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Store } from '@ngrx/store';
import { unique } from '../../../util/unique';
import { addTag } from '../../tag/store/tag.actions';
import {
  DEFAULT_TAG,
  IMPORTANT_TAG,
  IN_PROGRESS_TAG,
  URGENT_TAG,
} from '../../tag/tag.const';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BoardsService } from '../boards.service';
import { T } from '../../../t.const';
import { ViewTaskListRegistry } from '../../tasks/view-task-list-registry.service';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { expandOutOnlyAnimation } from '../../../ui/animations/expand.ani';
import { LayoutService } from '../../../core-ui/layout/layout.service';

// The tags the default views use, created with their fixed ids.
const DEFAULT_VIEW_TAGS = [IMPORTANT_TAG, URGENT_TAG, IN_PROGRESS_TAG];

@Component({
  selector: 'board',
  standalone: true,
  imports: [BoardPanelComponent, MatIcon, MatButton, TranslatePipe],
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
  animations: [expandOutOnlyAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--cols]': 'boardCfg().cols',
    // One column reads like a task list: list width, centered.
    '[class.isSingleColumn]': 'boardCfg().cols <= 1',
    '[class.isListLayout]': 'isListLayout()',
  },
})
export class BoardComponent {
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _boardsService = inject(BoardsService);
  private _layoutService = inject(LayoutService);
  private _viewCtx = inject(ViewCriteriaContextService);
  private _element = inject<ElementRef<HTMLElement>>(ElementRef);
  private _injector = inject(Injector);

  boardCfg = input.required<BoardCfg>();
  private _panels = viewChildren(BoardPanelComponent);
  private _panelElements = viewChildren(BoardPanelComponent, { read: ElementRef });

  async adjacentPanel(sourceId: string, event: BoardPanelNavigation): Promise<void> {
    const panels = this._panels();
    const index = panels.findIndex((panel) => panel.panelCfg().id === sourceId);
    const rects = this._panelElements().map((element) =>
      (element.nativeElement as HTMLElement).getBoundingClientRect(),
    );
    const source = rects[index];
    // Use the rendered grid so responsive columns and RTL follow visual direction.
    let targetIndex = -1;
    let distance = Infinity;
    rects.forEach((rect, panelIndex) => {
      const isVertical = event.direction === 'up' || event.direction === 'down';
      const offset =
        event.direction === 'up'
          ? source.top - rect.top
          : event.direction === 'down'
            ? rect.top - source.top
            : (rect.left - source.left) * event.direction;
      const isAligned = isVertical ? rect.left === source.left : rect.top === source.top;
      if (isAligned && offset > 0 && offset < distance) {
        targetIndex = panelIndex;
        distance = offset;
      }
    });
    const target = panels[targetIndex];
    if (!target) return;
    if (
      event.taskIds &&
      !(await target.moveTasks(event.taskIds, event.direction === 'down' ? 0 : undefined))
    )
      return;
    target.focusRow(event.rowIndex, event.focusTaskId ?? event.taskIds?.[0]);
  }

  // Cards side by side, rows when stacked: a one-column view, and any view on
  // a phone (where the grid stacks its columns), reads like a task list: task
  // rows instead of cards, its stacked panels being sections of that list
  // (rows move between them by drag and keyboard as cards did). The stored
  // layout stays as it is.
  readonly isListLayout = computed(
    () => this.boardCfg().cols <= 1 || this._layoutService.isXs(),
  );
  readonly isSectioned = computed(
    () => this.isListLayout() && this.boardCfg().panels.length > 1,
  );

  constructor() {
    // The open view list's columns, in display order: the add-task bar adds
    // into the first one that accepts new tasks.
    const registry = inject(ViewTaskListRegistry);
    effect(() => {
      registry.set(this, this.isListLayout() ? this._panels() : []);
    });
    inject(DestroyRef).onDestroy(() => registry.clear(this));

    // Crossing the phone breakpoint (rotating, resizing) swaps cards and rows:
    // the focused task keeps the focus. Runs before the swap renders.
    let wasListLayout: boolean | undefined;
    effect(() => {
      const isListLayout = this.isListLayout();
      if (wasListLayout !== undefined && wasListLayout !== isListLayout) {
        untracked(() => this._refocusAfterSwap());
      }
      wasListLayout = isListLayout;
    });
  }

  private _refocusAfterSwap(): void {
    const focused = document.activeElement?.closest<HTMLElement>('[data-task-id]');
    const taskId = focused?.dataset.taskId;
    if (!taskId || !this._element.nativeElement.contains(focused)) return;
    const panelEl = focused.closest('board-panel');
    const panel =
      this._panels()[
        this._panelElements().findIndex((el) => el.nativeElement === panelEl)
      ];
    afterNextRender(() => panel?.focusRow(0, taskId), { injector: this._injector });
  }

  // Tags the rules name that don't exist (the default views' tags on an
  // install that never created them). The columns still show; moves and adds
  // that would write such a tag are refused (BoardPanelComponent).
  missingTagIds = computed(() => {
    const existing = this._viewCtx.tagIdSet();
    const allPanelTagIds = this.boardCfg().panels.flatMap((panel) => [
      ...(panel.includedTagIds || []),
      ...(panel.excludedTagIds || []),
    ]);
    return unique(allPanelTagIds.filter((tagId) => !existing.has(tagId)));
  });

  // Default tags by their title (plain strings), an unknown id as is.
  missingTagNames = computed(() =>
    this.missingTagIds()
      .map((id) => DEFAULT_VIEW_TAGS.find((tag) => tag.id === id)?.title ?? id)
      .join(', '),
  );

  createTags(): void {
    const missingTagIds = this.missingTagIds();
    if (missingTagIds.length) {
      missingTagIds.forEach((tagId) => {
        const defaultTag = DEFAULT_VIEW_TAGS.find((tagInner) => tagInner.id === tagId);

        const tag = defaultTag
          ? {
              ...defaultTag,
              title: this._translateService.instant(defaultTag.title),
            }
          : {
              ...DEFAULT_TAG,
              id: tagId,
              title: `some-tag-${tagId}`,
            };

        this._store.dispatch(addTag({ tag }));
      });
    }
  }

  /** `panelId`: the column whose title was clicked, shown open. */
  editBoard(panelId?: string): void {
    void this._boardsService.editBoard(this.boardCfg(), panelId);
  }

  protected readonly T = T;
}
