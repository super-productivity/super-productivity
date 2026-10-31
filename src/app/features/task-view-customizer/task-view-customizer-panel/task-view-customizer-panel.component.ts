import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  ViewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { WorkContextService } from '../../work-context/work-context.service';
import { BoardsService } from '../../boards/boards.service';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatMenuModule, MatMenu } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { TaskViewCustomizerService } from '../task-view-customizer.service';
import { TagService } from '../../tag/tag.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_PRIORITY,
  FILTER_SCHEDULE,
  FILTER_TIME,
  FilterOption,
  OPTIONS,
  PRESETS,
  SortOption,
} from '../types';
import { BoardCfg, BoardPanelCfg } from '../../boards/boards.model';
import { BoardsActions } from '../../boards/store/boards.actions';
import {
  getPanelsWithViewFilter,
  getPanelsWithViewFilterPreset,
  getPanelsWithViewSort,
  getViewMenuState,
} from '../../boards/view-menu-rules';
import { TaskViewCustomizerMenuItemComponent } from './menu-item/menu-item.component';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';

@Component({
  selector: 'task-view-customizer-panel',
  templateUrl: './task-view-customizer-panel.component.html',
  styleUrls: ['./task-view-customizer-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  exportAs: 'customizerMenu',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatMenuModule,
    MatIconModule,
    MatDividerModule,
    TranslatePipe,
    TaskViewCustomizerMenuItemComponent,
    ChipListInputComponent,
  ],
})
export class TaskViewCustomizerPanelComponent {
  customizerService = inject(TaskViewCustomizerService);
  private _tagService = inject(TagService);
  private _injector = inject(Injector);
  private _workContextService = inject(WorkContextService);
  private _store = inject(Store);

  /**
   * View mode: the menu edits this view's (board's) rules instead of the task
   * list's customizer state, which it then neither reads nor writes. Each
   * click is one `updateBoard` op built from this board, so pass the store's
   * current board.
   */
  readonly view = input<BoardCfg | undefined>(undefined);

  @ViewChild('customizerMenu', { static: false })
  menu!: MatMenu;

  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly PRESETS = PRESETS;
  readonly FILTER_COMMON = FILTER_COMMON;

  allTags = this._tagService.tagsNoMyDayAndNoListInTreeOrder;

  private readonly _viewState = computed(() => {
    const view = this.view();
    return view ? getViewMenuState(view) : undefined;
  });

  /** The selected sort; `null` when a view's panels sort differently. */
  readonly selectedSort = computed<SortOption | null>(() => {
    const viewState = this._viewState();
    return viewState ? viewState.sort : this.customizerService.selectedSort();
  });

  /**
   * The checked filter per type. A list holds one filter; a view one rule per
   * type that all its panels share.
   */
  readonly activeFilters = computed<Partial<Record<FILTER_OPTION_TYPE, FilterOption>>>(
    () => {
      const viewState = this._viewState();
      if (viewState) return viewState.filters;
      const filter = this.customizerService.selectedFilter();
      return filter.type ? { [filter.type]: filter } : {};
    },
  );

  /** Filter types the view menu can't edit, because they differ per section. */
  readonly differingFilterTypes = computed<Partial<Record<FILTER_OPTION_TYPE, boolean>>>(
    () =>
      Object.fromEntries(
        (this._viewState()?.differingFilterTypes ?? []).map((type) => [type, true]),
      ),
  );

  tagFilterIds = computed(() => {
    const filter = this.activeFilters()[FILTER_OPTION_TYPE.tag];
    if (!filter) {
      return [];
    }
    const known = new Set(this.allTags().map((tag) => tag.id));
    return (filter.tagIds ?? []).filter((id) => known.has(id));
  });

  tagFilterMode = computed(
    () => this.activeFilters()[FILTER_OPTION_TYPE.tag]?.tagFilterMode ?? 'OR',
  );

  onSortSelect(sort: SortOption): void {
    const view = this.view();
    if (view) {
      this._updateViewPanels(view, getPanelsWithViewSort(view, sort));
      return;
    }
    this.customizerService.setSort(sort);
  }

  addTagFilter(tagId: string): void {
    this.updateTagIds([...this.tagFilterIds(), tagId]);
  }

  removeTagFilter(tagId: string): void {
    this.updateTagIds(this.tagFilterIds().filter((id) => id !== tagId));
  }

  setTagFilterMode(mode: 'OR' | 'AND'): void {
    const filter = this.activeFilters()[FILTER_OPTION_TYPE.tag];
    if (!filter) return;
    const view = this.view();
    if (view) {
      this._setViewFilter(view, FILTER_OPTION_TYPE.tag, {
        ...filter,
        tagIds: this.tagFilterIds(),
        tagFilterMode: mode,
      });
      return;
    }
    this.customizerService.setFilter({ ...filter, tagFilterMode: mode });
  }

  private updateTagIds(tagIds: string[]): void {
    const current = this.activeFilters()[FILTER_OPTION_TYPE.tag];
    const tagFilter = OPTIONS.filter.list.find((x) => x.type === FILTER_OPTION_TYPE.tag);
    if (!tagFilter) return;
    const next: FilterOption | null = tagIds.length
      ? {
          ...tagFilter,
          preset: null,
          tagIds,
          tagFilterMode: current?.tagFilterMode ?? 'OR',
        }
      : null;
    const view = this.view();
    if (view) {
      this._setViewFilter(view, FILTER_OPTION_TYPE.tag, next);
      return;
    }
    this.customizerService.setFilter(next ?? DEFAULT_OPTIONS.filter);
  }

  onFilterSelect(filter: FilterOption): void {
    this.customizerService.setFilter(filter);
  }

  onFilterInputChange(filterType: FILTER_OPTION_TYPE, value: string | null): void {
    const view = this.view();
    if (view) {
      if (value) this._setViewFilterPreset(view, filterType, value);
      return;
    }
    if (!value) return this.customizerService.setFilter(DEFAULT_OPTIONS.filter);

    const foundFilter = OPTIONS.filter.list.find((x) => x.type === filterType);
    if (!foundFilter) return;

    this.customizerService.setFilter({ ...foundFilter, preset: value });
  }

  onFilterWithValue(val: {
    filterType: FILTER_OPTION_TYPE;
    preset: FILTER_COMMON | FILTER_SCHEDULE | FILTER_TIME | FILTER_PRIORITY | null;
  }): void {
    const view = this.view();
    if (view) {
      if (val.preset) this._setViewFilterPreset(view, val.filterType, val.preset);
      return;
    }
    const foundFilter = OPTIONS.filter.list.find((x) => x.type === val.filterType);
    if (!foundFilter) return;

    this.customizerService.setFilter({ ...foundFilter, preset: val.preset });
  }

  onResetAll(): void {
    this.customizerService.resetAll();
  }

  /** Opens the create-view dialog prefilled with this list's filter and sort. */
  async saveAsView(): Promise<void> {
    const [list, undoneTasks] = await Promise.all([
      firstValueFrom(this._workContextService.activeWorkContext$),
      firstValueFrom(this._workContextService.undoneTasks$),
    ]);
    const { board, hints } = this.customizerService.buildViewFromList(
      {
        type: list.type,
        id: list.id,
        // Not used for Today: its view is named after the filter.
        title: list.title,
        taskIds: list.taskIds,
      },
      undoneTasks,
    );
    await this._injector.get(BoardsService).createBoard(board, hints);
  }

  private _setViewFilter(
    view: BoardCfg,
    type: FILTER_OPTION_TYPE,
    filter: FilterOption | null,
  ): void {
    this._updateViewPanels(
      view,
      getPanelsWithViewFilter(view, type, filter, { tags: this.allTags() }),
    );
  }

  private _setViewFilterPreset(
    view: BoardCfg,
    type: FILTER_OPTION_TYPE,
    preset: string,
  ): void {
    this._updateViewPanels(
      view,
      getPanelsWithViewFilterPreset(view, type, preset, { tags: this.allTags() }),
    );
  }

  /**
   * One op per click; `null` when the click can't change the view. A view
   * without panels has nothing to change.
   */
  private _updateViewPanels(view: BoardCfg, panels: BoardPanelCfg[] | null): void {
    if (panels?.length) {
      this._store.dispatch(
        BoardsActions.updateBoard({ id: view.id, updates: { panels } }),
      );
    }
  }
}
