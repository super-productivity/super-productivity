import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogTitle, MatDialogContent } from '@angular/material/dialog';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { GlobalConfigService } from '../../config/global-config.service';
import { T } from '../../../t.const';
import { FlowtimeBreakRule, FlowtimeConfig } from '../../config/global-config.model';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule } from '@angular/common';

/** Break-rule shape used inside the form (values in minutes, not ms). */
interface FlowtimeBreakRuleInMinutes {
  minDuration: number;
  maxDuration: number | null;
  breakDuration: number;
}

/**
 * View-model for the flowtime settings form.
 * Mirrors {@link FlowtimeConfig} but break-rule durations are in **minutes**
 * (the saved config stores milliseconds).
 */
interface FlowtimeFormModel {
  isBreakEnabled?: boolean | null;
  breakMode?: 'ratio' | 'rule' | null;
  breakPercentage?: number | null;
  breakRules?: FlowtimeBreakRuleInMinutes[];
}

@Component({
  selector: 'dialog-flowtime-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormlyModule,
    MatDialogTitle,
    MatDialogContent,
    TranslatePipe,
    MatButton,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
  ],
  templateUrl: './dialog-flowtime-settings.component.html',
  styleUrls: ['./dialog-flowtime-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogFlowtimeSettingsComponent {
  private readonly _dialogRef = inject(MatDialogRef<DialogFlowtimeSettingsComponent>);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _translateService = inject(TranslateService);
  private readonly _defaultRuleInMinutes: FlowtimeBreakRuleInMinutes = {
    minDuration: 0,
    maxDuration: 25,
    breakDuration: 5,
  };

  T = T;
  form = new FormGroup({});
  model = signal<FlowtimeFormModel>({});

  private readonly _minMaxDurationValidatorMessage = this._translateService.instant(
    T.F.FOCUS_MODE.FLOWTIME_VALIDATION_MIN_MAX,
  );

  // Disable expression shared by every break-related field: editable only
  // while "Enable Flowtime breaks" is checked. Model values remain set
  // regardless of toggle state.
  private readonly _disabledWhenBreaksOff = (field: FormlyFieldConfig): boolean => {
    // For top-level fields, the parent is the root form; for nested fields
    // (inside the repeat group), walk up until we find isBreakEnabled.
    let f: FormlyFieldConfig | undefined = field.parent;
    while (f) {
      if (f.model && 'isBreakEnabled' in f.model) {
        return !f.model.isBreakEnabled;
      }
      f = f.parent;
    }
    return false;
  };

  readonly fields = computed(() => [
    {
      key: 'isBreakEnabled',
      type: 'checkbox',
      props: {
        label: T.F.FOCUS_MODE.FLOWTIME_ENABLE_BREAKS,
      },
    },
    {
      key: 'breakMode',
      type: 'select',
      expressions: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'props.disabled': this._disabledWhenBreaksOff,
      },
      props: {
        label: T.F.FOCUS_MODE.FLOWTIME_BREAK_MODE,
        options: [
          {
            label: T.F.FOCUS_MODE.FLOWTIME_BREAK_MODE_RATIO,
            value: 'ratio',
          },
          {
            label: T.F.FOCUS_MODE.FLOWTIME_BREAK_MODE_RULE,
            value: 'rule',
          },
        ],
      },
    },
    {
      key: 'breakPercentage',
      type: 'input',
      expressions: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'props.disabled': this._disabledWhenBreaksOff,
        hide: (field: FormlyFieldConfig) => field.parent?.model?.breakMode !== 'ratio',
      },
      props: {
        label: T.F.FOCUS_MODE.FLOWTIME_BREAK_PERCENTAGE,
        type: 'number',
        min: 1,
        max: 100,
        required: true,
        description: T.F.FOCUS_MODE.FLOWTIME_BREAK_PERCENTAGE_DESC,
      },
    },
    {
      key: 'breakRules',
      className: 'flowtime-break-rules',
      description: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULES_DESC,
      type: 'repeat',
      expressions: {
        hide: (field: FormlyFieldConfig) => field.parent?.model?.breakMode !== 'rule',
      },
      props: {
        addText: T.F.FOCUS_MODE.FLOWTIME_ADD_BREAK_RULE,
        defaultValue: {
          minDuration: 0,
          maxDuration: 25,
          breakDuration: 5,
        },
      },
      fieldArray: {
        fieldGroupClassName: 'formly-row',
        validators: {
          minMaxDuration: {
            expression: (control: AbstractControl) => {
              const min = control.get('minDuration')?.value;
              const max = control.get('maxDuration')?.value;
              if (min == null || min === '') {
                return true;
              }

              return max == null || max === '' || Number(max) >= Number(min);
            },
            message: this._minMaxDurationValidatorMessage,
          },
        },
        fieldGroup: [
          {
            key: 'minDuration',
            type: 'input',
            expressions: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'props.disabled': this._disabledWhenBreaksOff,
            },
            props: {
              label: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULE_MIN,
              type: 'number',
              min: 0,
              max: 480,
              required: true,
            },
          },
          {
            key: 'maxDuration',
            type: 'input',
            expressions: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'props.disabled': this._disabledWhenBreaksOff,
            },
            props: {
              label: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULE_MAX,
              type: 'number',
              min: 1,
              max: 480,
            },
          },
          {
            key: 'breakDuration',
            type: 'input',
            expressions: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'props.disabled': this._disabledWhenBreaksOff,
            },
            props: {
              label: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULE_DURATION,
              type: 'number',
              min: 1,
              required: true,
            },
          },
        ],
      },
    },
  ]);

  constructor() {
    const cfg = this._globalConfigService.cfg();
    const flowtime = cfg?.flowtime ?? {
      isBreakEnabled: false,
      breakMode: 'ratio',
      breakPercentage: 20,
      breakRules: [],
    };

    const breakRulesInMinutes = (flowtime.breakRules ?? []).map(
      (rule: FlowtimeBreakRule) => ({
        minDuration: Math.round(rule.minDuration / 60000),
        maxDuration:
          rule.maxDuration === null ? null : Math.round(rule.maxDuration / 60000),
        breakDuration: Math.round(rule.breakDuration / 60000),
      }),
    );

    this.model.set({
      ...flowtime,
      // Default to 'ratio' when not yet configured so the percentage field
      // shows by default (per UX: disabled but visible until enable is on).
      breakMode: flowtime.breakMode ?? 'ratio',
      breakRules:
        breakRulesInMinutes.length > 0
          ? breakRulesInMinutes
          : [{ ...this._defaultRuleInMinutes }],
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const currentModel = this.model();
    const flowtimeConfig: FlowtimeConfig = {
      isBreakEnabled: currentModel.isBreakEnabled,
      breakMode: currentModel.breakMode,
      breakPercentage: currentModel.breakPercentage,
      breakRules: [...(currentModel.breakRules ?? [])]
        .sort((a, b) => (a.minDuration ?? 0) - (b.minDuration ?? 0))
        .map((rule: FlowtimeBreakRuleInMinutes) => {
          const min = rule.minDuration ?? 0;

          let max = rule.maxDuration == null ? null : rule.maxDuration;

          if (max !== null && max < min) {
            max = min;
          }

          return {
            minDuration: Math.round(min * 60000),
            maxDuration: max === null ? null : Math.round(max * 60000),
            breakDuration: Math.round((rule.breakDuration ?? 0) * 60000),
          };
        }),
    };

    this._globalConfigService.updateSection('flowtime', flowtimeConfig, true);
    this._dialogRef.close(flowtimeConfig);
  }

  close(): void {
    this._dialogRef.close();
  }
}
