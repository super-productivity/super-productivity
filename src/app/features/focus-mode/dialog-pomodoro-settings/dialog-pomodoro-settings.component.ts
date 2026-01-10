import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogTitle, MatDialogContent } from '@angular/material/dialog';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { GlobalConfigService } from '../../config/global-config.service';
import { T } from '../../../t.const';
import { PomodoroConfig } from '../../config/global-config.model';
import { TranslatePipe } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';

const POMODORO_DURATION_FIELDS: FormlyFieldConfig[] = [
  {
    key: 'duration',
    type: 'duration',
    props: {
      required: true,
      label: T.GCF.POMODORO.DURATION,
    },
  },
  {
    key: 'breakDuration',
    type: 'duration',
    props: {
      required: true,
      label: T.GCF.POMODORO.BREAK_DURATION,
    },
  },
  {
    key: 'longerBreakDuration',
    type: 'duration',
    props: {
      required: true,
      label: T.GCF.POMODORO.LONGER_BREAK_DURATION,
    },
  },
  {
    key: 'cyclesBeforeLongerBreak',
    type: 'input',
    props: {
      label: T.GCF.POMODORO.CYCLES_BEFORE_LONGER_BREAK,
      type: 'number',
      min: 1,
    },
  },
];

@Component({
  selector: 'dialog-pomodoro-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    MatDialogTitle,
    MatDialogContent,
    TranslatePipe,
    MatButton,
  ],
  template: `
    <h2 mat-dialog-title>{{ T.F.FOCUS_MODE.POMODORO_SETTINGS | translate }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form">
        <formly-form
          [fields]="fields"
          [form]="form"
          [model]="model"
          (modelChange)="model = $event"
        ></formly-form>
      </form>
      <div class="dialog-actions">
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
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogPomodoroSettingsComponent {
  private readonly _dialogRef = inject(MatDialogRef<DialogPomodoroSettingsComponent>);
  private readonly _globalConfigService = inject(GlobalConfigService);

  T = T;
  form = new FormGroup({});
  fields: FormlyFieldConfig[] = POMODORO_DURATION_FIELDS;
  model: PomodoroConfig;

  constructor() {
    const cfg = this._globalConfigService.cfg();
    this.model = { ...cfg!.pomodoro };
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this._globalConfigService.updateSection('pomodoro', this.model, true);
    this._dialogRef.close(this.model);
  }

  close(): void {
    this._dialogRef.close();
  }
}
