import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogTitle, MatDialogContent } from '@angular/material/dialog';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { GlobalConfigService } from '../../config/global-config.service';
import { T } from '../../../t.const';
import { PomodoroConfig } from '../../config/global-config.model';
import { TranslatePipe } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { Store } from '@ngrx/store';
import { resetCycles } from '../store/focus-mode.actions';
import { selectCurrentCycle } from '../store/focus-mode.selectors';

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
      required: true,
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
          [disabled]="isResetDisabled()"
          (click)="resetSessionCounter()"
        >
          {{ T.F.FOCUS_MODE.RESET_CYCLES | translate }}
        </button>
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
export class DialogPomodoroSettingsComponent {
  private readonly _dialogRef = inject(MatDialogRef<DialogPomodoroSettingsComponent>);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _store = inject(Store);
  private readonly _currentCycle = this._store.selectSignal(selectCurrentCycle);

  T = T;
  // cycle 1 is the reset target, so resetting there would be a silent no-op (#9893)
  isResetDisabled = computed(() => this._currentCycle() <= 1);
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

  resetSessionCounter(): void {
    this._store.dispatch(resetCycles());
    // close so the reset cycle counter behind the dialog becomes visible
    this._dialogRef.close();
  }

  close(): void {
    this._dialogRef.close();
  }
}
