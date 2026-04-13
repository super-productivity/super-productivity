import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import {
  BaseOption,
  DEFAULT_OPTIONS,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FILTER_TIME,
  FilterOption,
  OPTIONS,
  PRESETS,
} from '../../types';

@Component({
  selector: 'task-view-customizer-menu-item',
  templateUrl: './menu-item.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
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
  ],
})
export class TaskViewCustomizerMenuItemComponent {
  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly PRESETS = PRESETS;

  readonly type = input.required<FILTER_OPTION_TYPE>();
  readonly options = input.required<BaseOption<FILTER_SCHEDULE | FILTER_TIME>[]>();
  readonly selectedFilter = input.required<FilterOption>();

  readonly byClick = output<{
    filterType: FILTER_OPTION_TYPE;
    preset: FILTER_SCHEDULE | FILTER_TIME | null;
  }>();
}
