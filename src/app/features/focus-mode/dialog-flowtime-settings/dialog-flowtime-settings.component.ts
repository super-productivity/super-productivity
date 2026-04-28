import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogTitle, MatDialogContent } from '@angular/material/dialog';
import { FormlyModule } from '@ngx-formly/core';
import { GlobalConfigService } from '../../config/global-config.service';
import { T } from '../../../t.const';
import { FlowtimeConfig } from '../../config/global-config.model';
import { TranslatePipe } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule } from '@angular/common';

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
  template: `
    <h2 mat-dialog-title>{{ T.F.FOCUS_MODE.FLOWTIME_SETTINGS | translate }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form">
        <formly-form
          [fields]="fields()"
          [form]="form"
          [model]="model()"
          (modelChange)="model.set($event)"
        ></formly-form>
      </form>
      <div class="dialog-actions">
        <span class="spacer"></span>
        <button
          mat-button
          (click)="close()"
        >
          {{ T.G.CANCEL | translate }}
        </button>
        <button
          mat-button
          color="primary"
          (click)="save()"
        >
          {{ T.G.SAVE | translate }}
        </button>
      </div>
    </mat-dialog-content>
  `,
  styles: [
    `
      .dialog-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }

      .spacer {
        flex: 1;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogFlowtimeSettingsComponent {
  private readonly _dialogRef = inject(MatDialogRef<DialogFlowtimeSettingsComponent>);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _defaultRuleInMinutes = {
    minDuration: 0,
    maxDuration: 25,
    breakDuration: 5,
  };

  T = T;
  form = new FormGroup({});
  model = signal<any>({});

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
      hideExpression: (model: any) => !model?.isBreakEnabled,
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
      hideExpression: (model: any) =>
        !model?.isBreakEnabled || model?.breakMode !== 'ratio',
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
      // hideExpression: '!model.isBreakEnabled || model.breakMode !== "rule"',
      // hideExpression: (model: any) =>
      //   !model?.isBreakEnabled || model?.breakMode !== 'rule',
      // props: {
      //   disabled: (model: any) => model?.breakMode !== 'rule',
      // },
      expressions: {
        hide: (field: any) =>
          !field.parent?.model?.isBreakEnabled ||
          field.parent?.model?.breakMode !== 'rule',
      },
      templateOptions: {
        addText: T.F.FOCUS_MODE.FLOWTIME_BREAK_RULES_TITLE,
        // addText: T.F.FOCUS_MODE.FLOWTIME_ADD_BREAK_RULE,
        defaultValue: {
          minDuration: 0,
          maxDuration: 25,
          breakDuration: 5,
        },
      },
      fieldArray: {
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

    const breakRulesInMinutes = (flowtime.breakRules ?? []).map((rule) => ({
      minDuration: Math.round(rule.minDuration / 60000),
      maxDuration: Math.round(rule.maxDuration / 60000),
      breakDuration: Math.round(rule.breakDuration / 60000),
    }));

    this.model.set({
      ...flowtime,
      breakRules:
        breakRulesInMinutes.length > 0
          ? breakRulesInMinutes
          : [{ ...this._defaultRuleInMinutes }],
    });

    effect(() => {
      console.log('Flowtime Model:', this.model());
      console.log('Break Mode:', this.model().breakMode);
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
      breakRules: (currentModel.breakRules ?? []).map((rule: any) => ({
        minDuration: Math.round((rule.minDuration ?? 0) * 60000),
        maxDuration: Math.round((rule.maxDuration ?? 0) * 60000),
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
