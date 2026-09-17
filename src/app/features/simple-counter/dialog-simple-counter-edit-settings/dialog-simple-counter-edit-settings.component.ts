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
import {
  BUILT_IN_SOUND_OPTIONS,
  SIMPLE_COUNTER_FORM,
} from '../../config/form-cfgs/simple-counter-form.const';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';
import { SimpleCounterService } from '../simple-counter.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { playSound, playSoundFromBuffer } from '../../../util/play-sound';
import {
  CustomSoundStorageService,
  StoredCustomSound,
} from '../custom-sound-storage.service';
import { SnackService } from '../../../core/snack/snack.service';

const CUSTOM_PREFIX = 'custom:';

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
  private readonly _translateService = inject(TranslateService);
  private readonly _customSoundService = inject(CustomSoundStorageService);
  private readonly _snackService = inject(SnackService);
  readonly dialogData = inject<{ simpleCounter: SimpleCounterCopy }>(MAT_DIALOG_DATA);

  readonly T = T;
  readonly SimpleCounterType = SimpleCounterType;
  readonly CUSTOM_PREFIX = CUSTOM_PREFIX;

  /** Reactive list of user-uploaded sounds from IndexedDB. */
  readonly customSounds = this._customSoundService.sounds;

  readonly form = new UntypedFormGroup({});
  readonly formOptions: FormlyFormOptions = {};

  readonly fields: FormlyFieldConfig[];

  private readonly _initialModel = this._extractSettingsModel(
    this.dialogData.simpleCounter,
  );
  model: SimpleCounterCfgFields = this._cloneSettings(this._initialModel);

  constructor() {
    const fieldArray = SIMPLE_COUNTER_FORM.items?.[0]?.fieldArray as
      | { fieldGroup?: FormlyFieldConfig[] }
      | undefined;
    const baseFields = adjustToDialogFormlyForm([...(fieldArray?.fieldGroup ?? [])]);

    // Patch the soundType field to include dynamic custom sound options,
    // without mutating the shared SIMPLE_COUNTER_FORM constant.
    this.fields = baseFields.map((f) => {
      if (f.key !== 'soundType') return f;
      return {
        ...f,
        expressions: {
          ...f.expressions,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'props.options': () => this._getSoundTypeOptions(),
        },
      };
    });

    // Eagerly load custom sounds from IDB so the signal is populated
    // before the template renders.
    this._customSoundService.listSounds().catch(() => {});
  }

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

  async previewSound(): Promise<void> {
    const soundFile = this.model.soundType || 'positive.mp3';
    const volume = this.model.soundVolume != null ? this.model.soundVolume : 80;
    if (volume <= 0) return;
    if (soundFile.startsWith(CUSTOM_PREFIX)) {
      const soundId = soundFile.slice(CUSTOM_PREFIX.length);
      const stored = await this._customSoundService.getSound(soundId);
      if (stored) {
        await playSoundFromBuffer(
          `${CUSTOM_PREFIX}${soundId}`,
          stored.arrayBuffer,
          volume,
        );
      }
    } else {
      await playSound(soundFile, volume);
    }
  }

  async previewCustomSound(sound: StoredCustomSound): Promise<void> {
    const volume = this.model.soundVolume != null ? this.model.soundVolume : 80;
    if (volume > 0) {
      await playSoundFromBuffer(`${CUSTOM_PREFIX}${sound.id}`, sound.arrayBuffer, volume);
    }
  }

  selectCustomSound(id: string): void {
    this.model = { ...this.model, soundType: `${CUSTOM_PREFIX}${id}` };
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this._uploadCustomSound(file);
    // Reset so the same file can be re-uploaded
    input.value = '';
  }

  async removeCustomSound(id: string): Promise<void> {
    if (this.model.soundType === `${CUSTOM_PREFIX}${id}`) {
      this.model = { ...this.model, soundType: undefined };
    }
    await this._customSoundService.removeSound(id);
  }

  private async _uploadCustomSound(file: File): Promise<void> {
    try {
      await this._customSoundService.installFromFile(file);
    } catch (e) {
      this._snackService.open({
        msg: e instanceof Error ? e.message : 'Failed to upload sound',
        type: 'ERROR',
        isSkipTranslate: true,
      });
    }
  }

  private _getSoundTypeOptions(): { label: string; value: string }[] {
    const builtIns = BUILT_IN_SOUND_OPTIONS.map((o) => ({
      ...o,
      label: this._translateService.instant(o.label),
    }));
    const customs = this._customSoundService.sounds().map((s) => ({
      label: `🎵 ${s.name}`,
      value: `${CUSTOM_PREFIX}${s.id}`,
    }));
    return [...builtIns, ...customs];
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
      isAudioEnabled: counter.isAudioEnabled,
      soundType: counter.soundType,
      soundVolume: counter.soundVolume,
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
      isAudioEnabled: settings.isAudioEnabled,
      soundType: settings.isAudioEnabled ? settings.soundType : undefined,
      soundVolume: settings.isAudioEnabled ? settings.soundVolume : undefined,
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
