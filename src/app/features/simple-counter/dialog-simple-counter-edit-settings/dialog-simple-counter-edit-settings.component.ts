import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  SimpleCounter,
  SimpleCounterCfgFields,
  SimpleCounterCopy,
  SimpleCounterType,
} from '../simple-counter.model';
import { T } from '../../../t.const';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { SimpleCounterService } from '../simple-counter.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';

@Component({
  selector: 'dialog-simple-counter-edit-settings',
  standalone: true,
  templateUrl: './dialog-simple-counter-edit-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    TranslateModule,
    ReactiveFormsModule,
    FormsModule,
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

  private readonly _initialModel = this._extractSettingsModel(
    this.dialogData.simpleCounter,
  );
  model: SimpleCounterCfgFields = this._cloneSettings(this._initialModel);

  save(): void {
    if (!this.model.title || this.model.title.trim() === '') {
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
    const now = new Date();
    const defaultDateStr = now.toISOString().split('T')[0];
    const defaultTimestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

    const defaultWeekDays: { [key: number]: boolean } = {};
    for (let i = 0; i < 7; i++) {
      defaultWeekDays[i] = true;
    }

    return {
      id: counter.id,
      title: counter.title || '',
      isEnabled: counter.isEnabled ?? true,
      isHideButton: counter.isHideButton,
      icon: counter.icon,
      type: counter.type || SimpleCounterType.ClickCounter,
      isTrackStreaks: true,
      streakMinValue: counter.streakMinValue ?? 1,
      streakMode: counter.streakMode || 'specific-days',
      streakWeekDays: counter.streakWeekDays
        ? { ...counter.streakWeekDays }
        : defaultWeekDays,
      streakWeeklyFrequency: counter.streakWeeklyFrequency ?? 3,
      countdownDuration: counter.countdownDuration,

      // Custom iOS Habit Attributes
      color: counter.color || '#89b4fa',
      group: counter.group || 'Health',
      habitType: counter.habitType || 'positive',
      dailyGoalUnit: counter.dailyGoalUnit || 'times',
      maxDailyGoal: counter.maxDailyGoal || 1,
      repeatMode: counter.repeatMode || 'Daily',
      startDate: counter.startDate || defaultDateStr,
      targetDays: counter.targetDays || 365,
      reminderTime: counter.reminderTime || '09:00',
      memo: counter.memo || '',
      createdAt: counter.createdAt || defaultTimestamp,
      updatedAt: defaultTimestamp,
    };
  }

  private _normalizeSettings(
    settings: SimpleCounterCfgFields,
  ): Partial<SimpleCounterCopy> {
    const now = new Date();
    const defaultTimestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

    const defaultWeekDays: { [key: number]: boolean } = {};
    for (let i = 0; i < 7; i++) {
      defaultWeekDays[i] = true;
    }

    const normalized: Partial<SimpleCounterCopy> = {
      title: settings.title,
      isEnabled: settings.isEnabled,
      isHideButton: settings.isHideButton,
      icon: settings.icon,
      type: settings.type || SimpleCounterType.ClickCounter,
      isTrackStreaks: true,
      streakMinValue: settings.streakMinValue ?? 1,
      streakMode: settings.streakMode || 'specific-days',
      streakWeekDays: settings.streakWeekDays
        ? { ...settings.streakWeekDays }
        : defaultWeekDays,
      streakWeeklyFrequency: settings.streakWeeklyFrequency,
      countdownDuration: settings.countdownDuration ?? undefined,

      // Custom iOS Habit Attributes
      color: settings.color || '#89b4fa',
      group: settings.group || 'Health',
      habitType: settings.habitType || 'positive',
      dailyGoalUnit: settings.dailyGoalUnit || 'times',
      maxDailyGoal: settings.maxDailyGoal || 1,
      repeatMode: settings.repeatMode || 'Daily',
      startDate: settings.startDate,
      targetDays: settings.targetDays || 365,
      reminderTime: settings.reminderTime,
      memo: settings.memo || '',
      createdAt: settings.createdAt || defaultTimestamp,
      updatedAt: defaultTimestamp,
    };

    return normalized;
  }

  private _cloneSettings(settings: SimpleCounterCfgFields): SimpleCounterCfgFields {
    const defaultWeekDays: { [key: number]: boolean } = {};
    for (let i = 0; i < 7; i++) {
      defaultWeekDays[i] = true;
    }

    return {
      ...settings,
      streakMode: settings.streakMode || 'specific-days',
      streakWeekDays: settings.streakWeekDays
        ? { ...settings.streakWeekDays }
        : defaultWeekDays,
    };
  }
}
