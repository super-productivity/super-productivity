import { ChangeDetectionStrategy, Component, Input, output } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { GlobalConfigSectionKey, SoundConfig } from '../global-config.model';
import { ProjectCfgFormKey } from '../../project/project.model';
import { exists } from 'src/app/util/exists';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { SOUND_OPTS } from '../form-cfgs/sound-form.const';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { playSound } from '../../../util/play-sound';
import { playDoneSound } from '../../tasks/util/play-done-sound';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';

const sectionKey = 'sound';

@Component({
  selector: 'config-sound-form',
  templateUrl: './config-sound-form.component.html',
  styleUrls: ['./config-sound-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CollapsibleComponent,
    FormsModule,
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatSlider,
    MatInput,
    MatSliderThumb,
    MatSelect,
    MatOption,
    MatSlideToggle,
    TranslatePipe,
  ],
})
export class ConfigSoundFormComponent {
  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set cfg(cfg: SoundConfig) {
    this.config = { ...cfg };
    this.patchForm();
  }

  readonly save = output<{
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey;
    config: SoundConfig;
  }>();

  soundForm = new FormGroup({
    volume: new FormControl<number>(0),
    doneSound: new FormControl<string | null>(null),
    breakReminderSound: new FormControl<string | null>(null),
    trackTimeSound: new FormControl<string | null>(null),
    isIncreaseDoneSoundPitch: new FormControl<boolean>(false),
  });

  soundOpts = SOUND_OPTS;
  config?: SoundConfig;
  title = T.GCF.SOUND.TITLE;
  readonly T = T;
  private isInitializing = true;

  constructor() {
    this.soundForm.valueChanges
      .pipe(takeUntilDestroyed(), debounceTime(300), distinctUntilChanged())
      .subscribe((data) => {
        if (!this.isInitializing) {
          this.updateCfg({
            volume: data.volume ?? 0,
            doneSound: data.doneSound ?? null,
            breakReminderSound: data.breakReminderSound ?? null,
            trackTimeSound: data.trackTimeSound ?? null,
            isIncreaseDoneSoundPitch: data.isIncreaseDoneSoundPitch ?? false,
          });
        }
      });

    this.isInitializing = false;
  }

  patchForm(): void {
    if (this.config && this.soundForm) {
      this.isInitializing = true;
      this.soundForm
        .get('volume')!
        .patchValue(this.config.volume, { emitEvent: false, onlySelf: true });
      this.soundForm
        .get('doneSound')!
        .patchValue(this.config.doneSound, { emitEvent: false, onlySelf: true });
      this.soundForm
        .get('breakReminderSound')!
        .patchValue(this.config.breakReminderSound, { emitEvent: false, onlySelf: true });
      this.soundForm
        .get('trackTimeSound')!
        .patchValue(this.config.trackTimeSound || null, {
          emitEvent: false,
          onlySelf: true,
        });
      this.soundForm
        .get('isIncreaseDoneSoundPitch')!
        .patchValue(this.config.isIncreaseDoneSoundPitch, {
          emitEvent: false,
          onlySelf: true,
        });
      this.isInitializing = false;
    }
  }

  updateCfg(cfg: SoundConfig): void {
    if (!cfg) {
      throw new Error('No config for ' + sectionKey);
    }

    if (
      cfg.breakReminderSound !== this.config?.breakReminderSound &&
      cfg.breakReminderSound
    ) {
      playSound(cfg.breakReminderSound, cfg.volume);
    } else if (cfg.trackTimeSound !== this.config?.trackTimeSound && cfg.trackTimeSound) {
      playSound(cfg.trackTimeSound, cfg.volume);
    } else {
      playDoneSound(cfg);
    }

    this.config = cfg;
    if (this.soundForm.valid) {
      this.save.emit({
        sectionKey: exists(sectionKey),
        config: this.config,
      });
    } else {
      this.soundForm.updateValueAndValidity();
    }
  }
}
