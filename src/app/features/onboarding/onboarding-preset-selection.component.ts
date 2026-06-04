import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { ONBOARDING_PRESETS, OnboardingPreset } from './onboarding-presets.const';
import { GlobalConfigService } from '../config/global-config.service';
import { LS } from '../../core/persistence/storage-keys.const';

type DialogSyncCfgComponentType =
  typeof import('../../imex/sync/dialog-sync-cfg/dialog-sync-cfg.component').DialogSyncCfgComponent;

@Component({
  selector: 'onboarding-preset-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, TranslatePipe],
  templateUrl: './onboarding-preset-selection.component.html',
  styleUrl: './onboarding-preset-selection.component.scss',
})
export class OnboardingPresetSelectionComponent {
  private _globalConfigService = inject(GlobalConfigService);
  private _matDialog = inject(MatDialog);
  presets = ONBOARDING_PRESETS;
  presetSelected = output<void>();
  dismissed = output<void>();
  selectedPreset = signal<OnboardingPreset | null>(null);
  isSyncSetupInProgress = signal(false);

  selectPreset(preset: OnboardingPreset): void {
    if (this.selectedPreset()) {
      return;
    }
    this.selectedPreset.set(preset);
    this._globalConfigService.updateSection('appFeatures', preset.features, true);
    localStorage.setItem(LS.ONBOARDING_PRESET_DONE, 'true');
    this.presetSelected.emit();
  }

  async setupSync(): Promise<void> {
    if (this.selectedPreset() || this.isSyncSetupInProgress()) {
      return;
    }
    this.isSyncSetupInProgress.set(true);

    let DialogSyncCfgComponent: DialogSyncCfgComponentType;
    try {
      ({ DialogSyncCfgComponent } =
        await import('../../imex/sync/dialog-sync-cfg/dialog-sync-cfg.component'));
    } catch (e) {
      this.isSyncSetupInProgress.set(false);
      throw e;
    }

    if (this.selectedPreset()) {
      this.isSyncSetupInProgress.set(false);
      return;
    }

    const dialogRef = this._matDialog.open(DialogSyncCfgComponent);
    dialogRef.afterClosed().subscribe(() => {
      this.isSyncSetupInProgress.set(false);
      // A returning user who actually enabled sync (e.g. to restore data from
      // another device) should not be forced to pick a preset afterwards —
      // that would overwrite the appFeatures config they just synced down.
      // Dismiss onboarding instead, without starting the new-user hint tour.
      if (this._globalConfigService.cfg()?.sync.isEnabled) {
        localStorage.setItem(LS.ONBOARDING_PRESET_DONE, 'true');
        localStorage.setItem(LS.ONBOARDING_HINTS_DONE, 'true');
        this.dismissed.emit();
      }
    });
  }
}
