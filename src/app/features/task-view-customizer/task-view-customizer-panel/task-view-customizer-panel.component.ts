import { ChangeDetectionStrategy, Component, inject, ViewChild } from '@angular/core';
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

  @ViewChild('customizerMenu', { static: false })
  menu!: MatMenu;

  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly PRESETS = PRESETS;
  readonly FILTER_COMMON = FILTER_COMMON;

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
