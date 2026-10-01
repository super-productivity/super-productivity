import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Input,
  signal,
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
import { TranslatePipe } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { toSignal } from '@angular/core/rxjs-interop';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { Store } from '@ngrx/store';
import { selectAllProjects } from '../../project/store/project.selectors';
import { Project } from '../../project/project.model';
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
  ],
})
export class TaskViewCustomizerPanelComponent {
  customizerService = inject(TaskViewCustomizerService);
  private _workContextService = inject(WorkContextService);
  private _store = inject(Store);

  @ViewChild('customizerMenu', { static: false })
  menu!: MatMenu;

  @Input() multiSelectProject = false;
  @Input() showSaveSort = true;

  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly PRESETS = PRESETS;
  readonly FILTER_COMMON = FILTER_COMMON;

  private _activeCtx = toSignal(this._workContextService.activeWorkContextTypeAndId$);
  isInProjectContext = computed(
    () => this._activeCtx()?.activeType === WorkContextType.PROJECT,
  );

  // Multi-select project filter
  allProjects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [] as Project[],
  });

  projectSearch = signal('');

  // Single source of truth: the checked ids live in the persisted filter
  // itself (`projectIds`), the panel just derives from it (rev. п.6 — the
  // signal+effect JSON round-trip is gone).
  selectedProjectIds = computed<string[]>(() => {
    if (!this.multiSelectProject) return [];
    const filter = this.customizerService.selectedFilter();
    if (filter.type !== OPTIONS.filter.types.project) return [];
    return filter.projectIds ?? [];
  });

  filteredProjects = computed(() => {
    const search = this.projectSearch().toLowerCase();
    return this.allProjects().filter((p) => p.title.toLowerCase().includes(search));
  });

  toggleProject(projectId: string): void {
    const current = this.selectedProjectIds();
    const newIds = current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId];

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
        preset: null,
        projectIds: newIds,
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
    preset: FILTER_COMMON | FILTER_SCHEDULE | FILTER_TIME | FILTER_PRIORITY | null;
  }): void {
    const foundFilter = OPTIONS.filter.list.find((x) => x.type === val.filterType);
    if (!foundFilter) return;

    this.customizerService.setFilter({ ...foundFilter, preset: val.preset });
  }

  onResetAll(): void {
    this.customizerService.resetAll();
  }
}
