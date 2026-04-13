import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import {
  SimpleCounter,
  SimpleCounterCfgFields,
  SimpleCounterCopy,
  SimpleCounterType,
} from '../simple-counter.model';
import { T } from '../../../t.const';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import { FormsModule, ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { adjustToDialogFormlyForm } from '../../../util/adjust-to-dialog-formly-form';
import { SIMPLE_COUNTER_FORM } from '../../config/form-cfgs/simple-counter-form.const';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';
import { SimpleCounterService } from '../simple-counter.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';

@Component({
  selector: 'dialog-simple-counter-edit-settings',
  templateUrl: './dialog-simple-counter-edit-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    ReactiveFormsModule,
    FormsModule,
    FormlyModule,
  ],
})
export class DialogSimpleCounterEditSettingsComponent {
  private readonly _dialogRef = inject(
    MatDialogRef<DialogSimpleCounterEditSettingsComponent>,
  );
  private readonly _simpleCounterService = inject(SimpleCounterService);
  private readonly _matDialog = inject(MatDialog);
  readonly dialogData = inject<{ simpleCounter: SimpleCounterCopy }>(MAT_DIALOG_DATA);

  readonly T = T;
  readonly SimpleCounterType = SimpleCounterType;

  readonly form = new UntypedFormGroup({});
  readonly formOptions: FormlyFormOptions = {};
  private readonly _fieldArray = SIMPLE_COUNTER_FORM.items?.[0]?.fieldArray as
    | { fieldGroup?: FormlyFieldConfig[] }
    | undefined;
  readonly fields: FormlyFieldConfig[] = adjustToDialogFormlyForm([
    ...(this._fieldArray?.fieldGroup ?? []),
  ]);

  private readonly _initialModel = this._extractSettingsModel(
    this.dialogData.simpleCounter,
  );
  model: SimpleCounterCfgFields = this._cloneSettings(this._initialModel);

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const normalized = this._normalizeSettings(this.model);
    if (this.dialogData.simpleCounter.id) {
      this._simpleCounterService.updateSimpleCounter(
        this.dialogData.simpleCounter.id,
        normalized,
      );
    } else {
      this._simpleCounterService.addSimpleCounter({
        ...this.dialogData.simpleCounter,
        ...normalized,
      } as SimpleCounter);
    }
    this._dialogRef.close(normalized);
  }

  close(): void {
    this._dialogRef.close();
  }

  delete(): void {
    const id = this.dialogData.simpleCounter.id;
    if (!id) return;
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.F.SIMPLE_COUNTER.D_CONFIRM_REMOVE.MSG,
          okTxt: T.F.SIMPLE_COUNTER.D_CONFIRM_REMOVE.OK,
        },
      })
      .afterClosed()
      .subscribe((confirmed: boolean) => {
        if (confirmed) {
          this._simpleCounterService.deleteSimpleCounter(id);
          this._dialogRef.close();
        }
      });
  }

  isDirty(): boolean {
    return (
      JSON.stringify(this._normalizeSettings(this._initialModel)) !==
      JSON.stringify(this._normalizeSettings(this.model))
    );
  }

  private _extractSettingsModel(counter: SimpleCounterCopy): SimpleCounterCfgFields {
    return {
      id: counter.id,
      title: counter.title,
      isEnabled: counter.isEnabled,
      isHideButton: counter.isHideButton,
      icon: counter.icon,
      type: counter.type,
      isTrackStreaks: counter.isTrackStreaks,
      streakMinValue: counter.streakMinValue ?? EMPTY_SIMPLE_COUNTER.streakMinValue,
      streakMode: counter.streakMode || 'specific-days',
      streakWeekDays: counter.streakWeekDays
        ? { ...counter.streakWeekDays }
        : counter.isTrackStreaks
          ? { ...EMPTY_SIMPLE_COUNTER.streakWeekDays }
          : undefined,
      streakWeeklyFrequency: counter.streakWeeklyFrequency ?? 3,
      countdownDuration: counter.countdownDuration,
    };
  }

  private _normalizeSettings(
    settings: SimpleCounterCfgFields,
  ): Partial<SimpleCounterCopy> {
    const normalized: Partial<SimpleCounterCopy> = {
      title: settings.title,
      isEnabled: settings.isEnabled,
      isHideButton: settings.isHideButton,
      icon: settings.icon,
      type: settings.type,
      isTrackStreaks: settings.isTrackStreaks,
      streakMinValue: settings.streakMinValue,
      streakMode: settings.streakMode || 'specific-days',
      streakWeekDays: settings.streakWeekDays
        ? { ...settings.streakWeekDays }
        : settings.isTrackStreaks
          ? { ...EMPTY_SIMPLE_COUNTER.streakWeekDays }
          : undefined,
      streakWeeklyFrequency: settings.streakWeeklyFrequency,
      countdownDuration: settings.countdownDuration ?? undefined,
    };

    if (!normalized.isTrackStreaks) {
      normalized.streakWeekDays = undefined;
      normalized.streakMinValue = undefined;
      normalized.streakMode = undefined;
      normalized.streakWeeklyFrequency = undefined;
    }

    if (
      normalized.type !== SimpleCounterType.RepeatedCountdownReminder &&
      normalized.countdownDuration
    ) {
      normalized.countdownDuration = undefined;
    }

    return normalized;
  }

  private _cloneSettings(settings: SimpleCounterCfgFields): SimpleCounterCfgFields {
    return {
      ...settings,
      streakMode: settings.streakMode || 'specific-days',
      streakWeekDays: settings.streakWeekDays
        ? { ...settings.streakWeekDays }
        : settings.isTrackStreaks
          ? { ...EMPTY_SIMPLE_COUNTER.streakWeekDays }
          : undefined,
    };
  }
}
