/* eslint-disable @typescript-eslint/naming-convention */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  viewChildren,
} from '@angular/core';
import { BoardCfg } from '../boards.model';
import {
  BoardPanelComponent,
  BoardPanelNavigation,
} from '../board-panel/board-panel.component';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { selectAllTagIds } from '../../tag/store/tag.reducer';
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

@Component({
  selector: 'board',
  standalone: true,
  imports: [BoardPanelComponent, MatIcon, MatButton, TranslatePipe],
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--cols]': 'missingTagIds().length === 0 && boardCfg().cols',
    // One column reads like a task list: list width, centered.
    '[class.isSingleColumn]': 'boardCfg().cols <= 1',
    '[class.isListLayout]': 'isListLayout()',
  },
})
export class BoardComponent {
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _boardsService = inject(BoardsService);

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

  // A one-column view reads like a task list: task rows instead of cards,
  // its stacked panels being sections of that list (rows move between them
  // by drag and keyboard as cards did). Boards with columns keep their cards.
  readonly isListLayout = computed(() => this.boardCfg().cols <= 1);
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
  }

  allExistingTagIds = toSignal(this._store.select(selectAllTagIds), { initialValue: [] });

  missingTagIds = computed(() => {
    const allExistingTagIds: string[] = this.allExistingTagIds() as string[];
    const allPanelTagIds = this.boardCfg().panels.reduce<string[]>((acc, panel) => {
      return [...acc, ...(panel.includedTagIds || []), ...(panel.excludedTagIds || [])];
    }, []);
    return unique(allPanelTagIds.filter((tagId) => !allExistingTagIds.includes(tagId)));
  });

  createTags(): void {
    const missingTagIds = this.missingTagIds();
    if (missingTagIds.length) {
      missingTagIds.forEach((tagId) => {
        const defaultTags = [IMPORTANT_TAG, URGENT_TAG, IN_PROGRESS_TAG];

        const defaultTag = defaultTags.find((tagInner) => tagInner.id === tagId);

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

  editBoard(): void {
    this._boardsService.editBoard(this.boardCfg());
  }

  protected readonly T = T;
}
