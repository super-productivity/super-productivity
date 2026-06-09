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
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
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
  private readonly _initialFlowtimeConfig: FlowtimeConfig;
  private _lastIsBreakEnabled: FlowtimeFormModel['isBreakEnabled'];
  private _lastBreakMode: FlowtimeFormModel['breakMode'];
  private _lastBreakPercentage: FlowtimeFormModel['breakPercentage'];
  private _lastNonEmptyBreakRules: FlowtimeBreakRuleInMinutes[];
  private _isRestoringBreakRules = false;

  T = T;
  form = new FormGroup({});
  model = signal<FlowtimeFormModel>({});

  private readonly _minMaxDurationValidatorMessage = this._translateService.instant(
    T.F.FOCUS_MODE.FLOWTIME_VALIDATION_MIN_MAX,
  );

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
      resetOnHide: false,
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
      resetOnHide: false,
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          !field.parent?.model?.isBreakEnabled ||
          field.parent?.model?.breakMode !== 'ratio',
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
      description: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULES_DESC,
      type: 'repeat',
      resetOnHide: false,
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
    const flowtime = {
      ...DEFAULT_GLOBAL_CONFIG.flowtime,
      ...(cfg?.flowtime ?? {}),
    };
    const breakRules = this._toBreakRulesInMinutes(flowtime);
    this._initialFlowtimeConfig = flowtime;
    this._lastIsBreakEnabled = flowtime.isBreakEnabled;
    this._lastBreakMode = flowtime.breakMode;
    this._lastBreakPercentage = flowtime.breakPercentage;
    this._lastNonEmptyBreakRules = this._copyBreakRules(breakRules);

    this.model.set({
      ...flowtime,
      breakRules,
    });
  }

  updateModel(nextModel: FlowtimeFormModel): void {
    const previousIsBreakEnabled = this._lastIsBreakEnabled;
    const previousBreakMode = this._lastBreakMode;
    const breakMode = this._getNextBreakMode(nextModel);
    const nextModelToSet = {
      ...nextModel,
      breakMode,
      breakPercentage: this._getNextBreakPercentage(nextModel, breakMode),
      breakRules: this._getNextBreakRules(
        nextModel,
        previousIsBreakEnabled,
        previousBreakMode,
        breakMode,
      ),
    };

    this.model.set(nextModelToSet);
    this._rememberModelState(nextModelToSet);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const currentModel = this.model();
    const breakMode = currentModel.breakMode ?? this._initialFlowtimeConfig.breakMode;
    const flowtimeConfig: FlowtimeConfig = {
      isBreakEnabled: currentModel.isBreakEnabled,
      breakMode,
      breakPercentage:
        currentModel.breakPercentage ?? this._initialFlowtimeConfig.breakPercentage,
      breakRules:
        currentModel.isBreakEnabled && breakMode === 'rule' && currentModel.breakRules
          ? this._toBreakRulesInMs(currentModel.breakRules)
          : (this._initialFlowtimeConfig.breakRules ?? []),
    };

    this._globalConfigService.updateSection('flowtime', flowtimeConfig, true);
    this._dialogRef.close(flowtimeConfig);
  }

  close(): void {
    this._dialogRef.close();
  }

  private _getNextBreakMode(
    nextModel: FlowtimeFormModel,
  ): FlowtimeFormModel['breakMode'] {
    const isBreakModeHidden = !nextModel.isBreakEnabled;

    return nextModel.breakMode == null && isBreakModeHidden
      ? (this._lastBreakMode ?? this._initialFlowtimeConfig.breakMode)
      : nextModel.breakMode;
  }

  private _getNextBreakPercentage(
    nextModel: FlowtimeFormModel,
    breakMode: FlowtimeFormModel['breakMode'],
  ): FlowtimeFormModel['breakPercentage'] {
    const isBreakPercentageHidden = !nextModel.isBreakEnabled || breakMode !== 'ratio';

    return nextModel.breakPercentage == null && isBreakPercentageHidden
      ? (this._lastBreakPercentage ?? this._initialFlowtimeConfig.breakPercentage)
      : nextModel.breakPercentage;
  }

  private _getNextBreakRules(
    nextModel: FlowtimeFormModel,
    previousIsBreakEnabled: FlowtimeFormModel['isBreakEnabled'],
    previousBreakMode: FlowtimeFormModel['breakMode'],
    breakMode: FlowtimeFormModel['breakMode'],
  ): FlowtimeBreakRuleInMinutes[] {
    const nextRules = nextModel.breakRules;
    const didRuleFieldsVisibilityChange =
      previousIsBreakEnabled !== nextModel.isBreakEnabled ||
      previousBreakMode !== breakMode;
    const isRuleModeVisible = nextModel.isBreakEnabled === true && breakMode === 'rule';
    const shouldRestoreBreakRules =
      didRuleFieldsVisibilityChange || this._isRestoringBreakRules;
    const hasRestorableBlankBreakRuleFields =
      this._hasRestorableBlankBreakRuleFields(nextRules);

    this._isRestoringBreakRules =
      isRuleModeVisible && shouldRestoreBreakRules && hasRestorableBlankBreakRuleFields;

    if (shouldRestoreBreakRules && hasRestorableBlankBreakRuleFields) {
      return this._restoreBreakRulesFromLastNonEmpty(nextRules);
    }

    return !this._isEmptyBreakRules(nextRules)
      ? this._copyBreakRules(nextRules!)
      : (nextRules ?? []);
  }

  private _isEmptyBreakRules(
    breakRules: FlowtimeBreakRuleInMinutes[] | undefined,
  ): boolean {
    return (
      !breakRules ||
      breakRules.length === 0 ||
      breakRules.every(
        (rule: FlowtimeBreakRuleInMinutes) =>
          this._isBlankFormValue(rule.minDuration) &&
          this._isBlankFormValue(rule.maxDuration) &&
          this._isBlankFormValue(rule.breakDuration),
      )
    );
  }

  private _isBlankFormValue(value: unknown): boolean {
    return value == null || value === '';
  }

  private _hasRestorableBlankBreakRuleFields(
    breakRules: FlowtimeBreakRuleInMinutes[] | undefined,
  ): boolean {
    const fallbackRules = this._lastNonEmptyBreakRules.length
      ? this._lastNonEmptyBreakRules
      : [this._defaultRuleInMinutes];

    return fallbackRules.some((fallbackRule, index) => {
      const rule = breakRules?.[index];

      return (
        !rule ||
        this._isBlankFormValue(rule.minDuration) ||
        this._isBlankFormValue(rule.breakDuration) ||
        (fallbackRule.maxDuration !== null && this._isBlankFormValue(rule.maxDuration))
      );
    });
  }

  private _restoreBreakRulesFromLastNonEmpty(
    nextRules: FlowtimeBreakRuleInMinutes[] | undefined,
  ): FlowtimeBreakRuleInMinutes[] {
    const fallbackRules = this._lastNonEmptyBreakRules.length
      ? this._lastNonEmptyBreakRules
      : [this._defaultRuleInMinutes];
    const rowCount = Math.max(nextRules?.length ?? 0, fallbackRules.length);

    return Array.from({ length: rowCount }, (_, index) => {
      const nextRule = nextRules?.[index];
      const fallbackRule =
        fallbackRules[index] ?? fallbackRules[fallbackRules.length - 1];

      return {
        minDuration: this._isBlankFormValue(nextRule?.minDuration)
          ? fallbackRule.minDuration
          : nextRule!.minDuration,
        maxDuration: this._isBlankFormValue(nextRule?.maxDuration)
          ? fallbackRule.maxDuration
          : nextRule!.maxDuration,
        breakDuration: this._isBlankFormValue(nextRule?.breakDuration)
          ? fallbackRule.breakDuration
          : nextRule!.breakDuration,
      };
    });
  }

  private _rememberModelState(model: FlowtimeFormModel): void {
    this._lastIsBreakEnabled = model.isBreakEnabled;
    this._lastBreakMode = model.breakMode;

    if (!this._isBlankFormValue(model.breakPercentage)) {
      this._lastBreakPercentage = model.breakPercentage;
    }

    if (!this._isEmptyBreakRules(model.breakRules)) {
      this._lastNonEmptyBreakRules = this._copyBreakRules(model.breakRules!);
    }
  }

  private _copyBreakRules(
    breakRules: FlowtimeBreakRuleInMinutes[],
  ): FlowtimeBreakRuleInMinutes[] {
    return breakRules.map((rule: FlowtimeBreakRuleInMinutes) => ({ ...rule }));
  }

  private _toBreakRulesInMinutes(
    flowtime: Pick<FlowtimeConfig, 'breakRules'>,
  ): FlowtimeBreakRuleInMinutes[] {
    const breakRulesInMinutes = (flowtime.breakRules ?? []).map(
      (rule: FlowtimeBreakRule) => ({
        minDuration: Math.round(rule.minDuration / 60000),
        maxDuration:
          rule.maxDuration === null ? null : Math.round(rule.maxDuration / 60000),
        breakDuration: Math.round(rule.breakDuration / 60000),
      }),
    );

    return breakRulesInMinutes.length > 0
      ? breakRulesInMinutes
      : [{ ...this._defaultRuleInMinutes }];
  }

  private _toBreakRulesInMs(
    breakRules: FlowtimeBreakRuleInMinutes[],
  ): FlowtimeBreakRule[] {
    return [...breakRules]
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
      });
  }
}
