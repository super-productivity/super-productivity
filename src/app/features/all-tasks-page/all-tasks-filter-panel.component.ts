import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule, MatMenu } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { selectAllProjects } from '../project/store/project.selectors';
import { Project } from '../project/project.model';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FILTER_TIME,
  FilterOption,
  OPTIONS,
  PRESETS,
} from '../task-view-customizer/types';
import { TaskViewCustomizerMenuItemComponent } from '../task-view-customizer/task-view-customizer-panel/menu-item/menu-item.component';

@Component({
  selector: 'all-tasks-filter-panel',
  templateUrl: './all-tasks-filter-panel.component.html',
  styleUrl: './all-tasks-filter-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatIconModule,
    MatDividerModule,
    TranslatePipe,
    TaskViewCustomizerMenuItemComponent,
  ],
})
export class AllTasksFilterPanelComponent {
  customizerService = inject(TaskViewCustomizerService);
  private _store = inject(Store);

  @ViewChild('filterMenu', { static: false })
  filterMenu!: MatMenu;

  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly PRESETS = PRESETS;
  readonly FILTER_COMMON = FILTER_COMMON;

  allProjects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [] as Project[],
  });

  projectSearch = signal('');
  selectedProjectIds = signal<string[]>([]);

  filteredProjects = computed(() => {
    const search = this.projectSearch().toLowerCase();
    return this.allProjects().filter((p) => p.title.toLowerCase().includes(search));
  });

  private _syncFilter = effect(() => {
    const filter = this.customizerService.selectedFilter();
    if (filter.type === OPTIONS.filter.types.project) {
      try {
        const parsed = JSON.parse(filter.preset ?? '');
        if (Array.isArray(parsed)) {
          this.selectedProjectIds.set(parsed);
          return;
        }
      } catch {
        /* single-value preset */
      }
    }
    this.selectedProjectIds.set([]);
    this.projectSearch.set('');
  });

  toggleProject(projectId: string): void {
    const newIds = this.selectedProjectIds().includes(projectId)
      ? this.selectedProjectIds().filter((id) => id !== projectId)
      : [...this.selectedProjectIds(), projectId];

    this.selectedProjectIds.set(newIds);

    if (newIds.length === 0) {
      this.customizerService.setFilter(DEFAULT_OPTIONS.filter);
      return;
    }

    const projectFilter = OPTIONS.filter.list.find(
      (x) => x.type === OPTIONS.filter.types.project,
    );
    if (projectFilter) {
      this.customizerService.setFilter({
        ...projectFilter,
        preset: JSON.stringify(newIds),
      });
    }
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
