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
        hide: (field: FormlyFieldConfig) => !field.parent?.model?.isBreakEnabled,
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
        hide: (field: FormlyFieldConfig) =>
          !field.parent?.model?.isBreakEnabled ||
          field.parent?.model?.breakMode !== 'ratio',
      },
      props: {
        label: T.F.FOCUS_MODE.FLOWTIME_BREAK_PERCENTAGE,
        type: 'number',
        min: 0,
        max: 100,
        required: true,
        description: T.F.FOCUS_MODE.FLOWTIME_BREAK_PERCENTAGE_DESC,
      },
    },
    {
      key: 'breakRules',
      type: 'repeat',
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          !field.parent?.model?.isBreakEnabled ||
          field.parent?.model?.breakMode !== 'rule',
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
        validators: {
          minMaxDuration: {
            expression: (control: AbstractControl<FlowtimeBreakRuleInMinutes>) => {
              const val = control.value;
              if (!val || val.maxDuration === null || val.maxDuration === undefined) {
                return true;
              }
              return val.minDuration <= val.maxDuration;
            },
            message: () =>
              this._translateService.instant(T.F.FOCUS_MODE.FLOWTIME_VALIDATION_MIN_MAX),
          },
        },
        fieldGroup: [
          {
            key: 'minDuration',
            type: 'input',
            props: {
              label: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULE_MIN,
              type: 'number',
              min: 0,
              required: true,
            },
          },
          {
            key: 'maxDuration',
            type: 'input',
            props: {
              label: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULE_MAX,
              type: 'number',
              min: 1,
              required: true,
            },
          },
          {
            key: 'breakDuration',
            type: 'input',
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
    // Sort rules by minDuration
    const sortedRules = [...(currentModel.breakRules ?? [])].sort(
      (a, b) => (a.minDuration ?? 0) - (b.minDuration ?? 0),
    );

    // Ensure max >= min for each rule (if max is not null)
    for (const rule of sortedRules) {
      if (
        rule.maxDuration !== null &&
        rule.maxDuration !== undefined &&
        rule.maxDuration < (rule.minDuration ?? 0)
      ) {
        rule.maxDuration = rule.minDuration ?? 0;
      }
    }

    const flowtimeConfig: FlowtimeConfig = {
      isBreakEnabled: currentModel.isBreakEnabled,
      breakMode: currentModel.breakMode,
      breakPercentage: currentModel.breakPercentage,
      breakRules: sortedRules.map((rule: FlowtimeBreakRuleInMinutes) => ({
        minDuration: Math.round((rule.minDuration ?? 0) * 60000),
        maxDuration:
          rule.maxDuration === null || rule.maxDuration === undefined
            ? null
            : Math.round(rule.maxDuration * 60000),
        breakDuration: Math.round((rule.breakDuration ?? 0) * 60000),
      })),
    };

    this._globalConfigService.updateSection('flowtime', flowtimeConfig, true);
    this._dialogRef.close(flowtimeConfig);
  }

  close(): void {
    this._dialogRef.close();
  }
}
