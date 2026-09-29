import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FieldType } from '@ngx-formly/material';
import { ConfigOption, FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { MatOption, MatSelect, MatSelectTrigger } from '@angular/material/select';
import { T } from 'src/app/t.const';
import { TaskPriorityIconPreset } from '../global-config.model';
import { TaskPriorityIndicatorComponent } from '../../tasks/task-priority-indicator/task-priority-indicator.component';
import { TASK_PRIORITY_LEVELS } from '../../tasks/task-priority.const';

const PRESET_LABEL_KEY: Record<TaskPriorityIconPreset, string> = {
  chevrons: T.GCF.TASKS.PRIORITY_ICON_PRESET_CHEVRONS,
  numbers: T.GCF.TASKS.PRIORITY_ICON_PRESET_NUMBERS,
  dots: T.GCF.TASKS.PRIORITY_ICON_PRESET_DOTS,
};

/**
 * Select for `tasks.priorityIconPreset` that previews each preset with the real
 * priority indicator (Low, Medium, High), both in the options and in the closed
 * field. Registered as the `priority-icon-preset-select` formly type (see
 * `PRIORITY_ICON_PRESET_SELECT_FORMLY_CONFIG`).
 */
@Component({
  selector: 'priority-icon-preset-select',
  templateUrl: './priority-icon-preset-select.component.html',
  styleUrl: './priority-icon-preset-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    FormlyModule,
    TranslatePipe,
    MatSelect,
    MatSelectTrigger,
    MatOption,
    NgTemplateOutlet,
    TaskPriorityIndicatorComponent,
  ],
})
export class PriorityIconPresetSelectComponent extends FieldType<FormlyFieldConfig> {
  readonly PRESETS = Object.keys(PRESET_LABEL_KEY) as TaskPriorityIconPreset[];
  readonly PRESET_LABEL_KEY = PRESET_LABEL_KEY;
  readonly LEVELS = TASK_PRIORITY_LEVELS;
}

/** Formly config registering this field type; provided once in main.ts. */
export const PRIORITY_ICON_PRESET_SELECT_FORMLY_CONFIG: ConfigOption = {
  types: [
    {
      name: 'priority-icon-preset-select',
      component: PriorityIconPresetSelectComponent,
      extends: 'input',
      wrappers: ['form-field'],
    },
  ],
};
