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
import { combineLatest, firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';
import { ONBOARDING_PRESETS, OnboardingPreset } from './onboarding-presets.const';
import { GlobalConfigService } from '../config/global-config.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { ProjectService } from '../project/project.service';
import { TaskService } from '../tasks/task.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';

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
  private _projectService = inject(ProjectService);
  private _syncWrapperService = inject(SyncWrapperService);
  private _taskService = inject(TaskService);
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
      void this._dismissIfSyncRestoredData();
    });
  }

  private async _dismissIfSyncRestoredData(): Promise<void> {
    if (!this._globalConfigService.cfg()?.sync.isEnabled) {
      return;
    }

    await firstValueFrom(this._syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$);
    const [projectList, taskList] = await firstValueFrom(
      combineLatest([this._projectService.list$, this._taskService.allTasks$]).pipe(
        first(),
      ),
    );
    if (projectList.length <= 2 && taskList.length === 0) {
      return;
    }

    localStorage.setItem(LS.ONBOARDING_PRESET_DONE, 'true');
    localStorage.setItem(LS.ONBOARDING_HINTS_DONE, 'true');
    this.dismissed.emit();
  }
}
