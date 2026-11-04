import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  ViewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
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
} from '../types';
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

  @ViewChild('customizerMenu', { static: false })
  menu!: MatMenu;

  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly PRESETS = PRESETS;
  readonly FILTER_COMMON = FILTER_COMMON;

  allTags = this._tagService.tagsNoMyDayAndNoListInTreeOrder;

  tagFilterIds = computed(() => {
    const filter = this.customizerService.selectedFilter();
    if (filter.type !== FILTER_OPTION_TYPE.tag) {
      return [];
    }
    const known = new Set(this.allTags().map((tag) => tag.id));
    return (filter.tagIds ?? []).filter((id) => known.has(id));
  });

  tagFilterMode = computed(
    () => this.customizerService.selectedFilter().tagFilterMode ?? 'OR',
  );

  addTagFilter(tagId: string): void {
    this.updateTagIds([...this.tagFilterIds(), tagId]);
  }

  removeTagFilter(tagId: string): void {
    this.updateTagIds(this.tagFilterIds().filter((id) => id !== tagId));
  }

  setTagFilterMode(mode: 'OR' | 'AND'): void {
    const filter = this.customizerService.selectedFilter();
    if (filter.type === FILTER_OPTION_TYPE.tag) {
      this.customizerService.setFilter({ ...filter, tagFilterMode: mode });
    }
  }

  private updateTagIds(tagIds: string[]): void {
    const filter = this.customizerService.selectedFilter();
    const tagFilter = OPTIONS.filter.list.find((x) => x.type === FILTER_OPTION_TYPE.tag);
    if (!tagFilter) return;
    if (!tagIds.length) {
      this.customizerService.setFilter(DEFAULT_OPTIONS.filter);
      return;
    }
    this.customizerService.setFilter({
      ...tagFilter,
      preset: null,
      tagIds,
      tagFilterMode: filter.type === FILTER_OPTION_TYPE.tag ? filter.tagFilterMode : 'OR',
    });
  }

  onFilterSelect(filter: FilterOption): void {
    this.customizerService.setFilter(filter);
  }

  onFilterInputChange(filterType: FILTER_OPTION_TYPE, value: string | null): void {
    if (!value) return this.customizerService.setFilter(DEFAULT_OPTIONS.filter);

    const foundFilter = OPTIONS.filter.list.find((x) => x.type === filterType);
    if (!foundFilter) return;

    this.customizerService.setFilter({ ...foundFilter, preset: value });
  }

  onFilterWithValue(val: {
    filterType: FILTER_OPTION_TYPE;
    preset: FILTER_COMMON | FILTER_SCHEDULE | FILTER_TIME | FILTER_PRIORITY | null;
  }): void {
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
}
