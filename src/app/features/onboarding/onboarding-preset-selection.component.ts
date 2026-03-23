import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ONBOARDING_PRESETS, OnboardingPreset } from './onboarding-presets.const';
import { GlobalConfigService } from '../config/global-config.service';
import { LS } from '../../core/persistence/storage-keys.const';

@Component({
  selector: 'onboarding-preset-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, TranslatePipe],
  templateUrl: './onboarding-preset-selection.component.html',
  styleUrl: './onboarding-preset-selection.component.scss',
})
export class OnboardingPresetSelectionComponent {
  private _globalConfigService = inject(GlobalConfigService);
  presets = ONBOARDING_PRESETS;
  presetSelected = output<void>();
  selectedPreset = signal<OnboardingPreset | null>(null);

  selectPreset(preset: OnboardingPreset): void {
    if (this.selectedPreset()) {
      return;
    }
    this.selectedPreset.set(preset);
    this._globalConfigService.updateSection('appFeatures', preset.features, true);
    localStorage.setItem(LS.ONBOARDING_PRESET_DONE, 'true');
    this.presetSelected.emit();
  }
}
