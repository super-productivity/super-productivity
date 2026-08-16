import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  ViewChild,
} from '@angular/core';
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

  @ViewChild('customizerMenu', { static: false })
  menu!: MatMenu;

  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly PRESETS = PRESETS;
  readonly FILTER_COMMON = FILTER_COMMON;

  allTags = this._tagService.tagsInTreeOrder;

  tagFilterIds = computed(() => {
    const f = this.customizerService.selectedFilter();
    return f.type === FILTER_OPTION_TYPE.tag ? (f.tagIds ?? []) : [];
  });

  tagFilterMode = computed(
    () => this.customizerService.selectedFilter().tagFilterMode ?? 'OR',
  );

  addTagFilter(tagId: string): void {
    const current = this.customizerService.selectedFilter();
    const currentIds =
      current.type === FILTER_OPTION_TYPE.tag ? (current.tagIds ?? []) : [];
    if (currentIds.includes(tagId)) return;
    const tagFilter = OPTIONS.filter.list.find((x) => x.type === FILTER_OPTION_TYPE.tag)!;
    this.customizerService.setFilter({
      ...tagFilter,
      tagIds: [...currentIds, tagId],
      tagFilterMode: current.tagFilterMode ?? 'OR',
    });
  }

  removeTagFilter(tagId: string): void {
    const current = this.customizerService.selectedFilter();
    const newIds = (current.tagIds ?? []).filter((id) => id !== tagId);
    if (!newIds.length) {
      this.customizerService.setFilter(DEFAULT_OPTIONS.filter);
      return;
    }
    const tagFilter = OPTIONS.filter.list.find((x) => x.type === FILTER_OPTION_TYPE.tag)!;
    this.customizerService.setFilter({
      ...tagFilter,
      tagIds: newIds,
      tagFilterMode: current.tagFilterMode ?? 'OR',
    });
  }

  setTagFilterMode(mode: 'OR' | 'AND'): void {
    const current = this.customizerService.selectedFilter();
    if (current.type !== FILTER_OPTION_TYPE.tag) return;
    this.customizerService.setFilter({ ...current, tagFilterMode: mode });
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
    preset: FILTER_SCHEDULE | FILTER_TIME | null;
  }): void {
    const foundFilter = OPTIONS.filter.list.find((x) => x.type === val.filterType);
    if (!foundFilter) return;

    this.customizerService.setFilter({ ...foundFilter, preset: val.preset });
  }

  onResetAll(): void {
    this.customizerService.resetAll();
  }
}
