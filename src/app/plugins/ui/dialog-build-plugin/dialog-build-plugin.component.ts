import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { environment } from '../../../../environments/environment';
import { ShareService } from '../../../core/share/share.service';
import { SnackService } from '../../../core/snack/snack.service';
import { PluginService } from '../../plugin.service';
import { PluginLog } from '../../../core/log';
import { PluginManifest } from '../../plugin-api.model';
import { PluginState } from '../../plugin-state.model';
import { IS_NATIVE_PLATFORM } from '../../../util/is-native-platform';
import { BUNDLED_PLUGIN_IDS } from '../../bundled-plugins.const';
import { confirmPluginInstall } from '../confirm-plugin-install';
import {
  BuildPluginParseErrorKey,
  buildPluginErrorReport,
  buildPluginPrompt,
  createPluginZipFile,
  parsePluginAnswer,
} from './build-plugin.util';

const PARSE_ERROR_MSG: Record<BuildPluginParseErrorKey, string> = {
  NO_CODE_BLOCKS: T.PLUGINS.BUILD_DIALOG.ERR_NO_CODE_BLOCKS,
  NO_MANIFEST: T.PLUGINS.BUILD_DIALOG.ERR_NO_MANIFEST,
  INVALID_MANIFEST: T.PLUGINS.BUILD_DIALOG.ERR_INVALID_MANIFEST,
  NO_NAME: T.PLUGINS.BUILD_DIALOG.ERR_NO_NAME,
  NO_PLUGIN_CODE: T.PLUGINS.BUILD_DIALOG.ERR_NO_PLUGIN_CODE,
};

/** What step 3 reports: running, stopped with an error, or left off (consent declined). */
export interface BuildPluginInstallResult {
  id: string;
  name: string;
  status: 'running' | 'error' | 'off';
  error?: string;
}

export const PLUGIN_GUIDE_URL =
  'https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md';

/**
 * Guides a non-developer from an idea to an installed plugin: writes the AI
 * prompt, turns the pasted AI answer into a plugin ZIP and installs it through
 * the regular upload path, then hands load errors back for the AI to fix.
 */
@Component({
  selector: 'dialog-build-plugin',
  templateUrl: './dialog-build-plugin.component.html',
  styleUrl: './dialog-build-plugin.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    MatIcon,
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
    TranslatePipe,
  ],
})
export class DialogBuildPluginComponent {
  private readonly _pluginService = inject(PluginService);
  private readonly _shareService = inject(ShareService);
  private readonly _snackService = inject(SnackService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _translateService = inject(TranslateService);

  readonly T: typeof T = T;
  readonly guideUrl = PLUGIN_GUIDE_URL;

  readonly step = signal<1 | 2 | 3>(1);
  readonly idea = signal('');
  readonly answer = signal('');
  readonly isInstalling = signal(false);
  readonly installError = signal<string | null>(null);
  readonly installed = signal<BuildPluginInstallResult | null>(null);

  // the dev tools hint needs a keyboard and a desktop browser or Electron
  readonly isNativePlatform = IS_NATIVE_PLATFORM;

  private readonly _focusTarget = viewChild<ElementRef<HTMLElement>>('focusTarget');
  // a step change removes the clicked button; move focus to what the new step is about
  private readonly _focusStep = effect(() => this._focusTarget()?.nativeElement.focus());

  readonly parsed = computed(() =>
    this.answer().trim() ? parsePluginAnswer(this.answer(), environment.version) : null,
  );
  readonly files = computed(() => {
    const parsed = this.parsed();
    return parsed && 'files' in parsed ? parsed.files : null;
  });
  readonly parseErrorMsg = computed(() => {
    const parsed = this.parsed();
    return parsed && 'errorKey' in parsed ? PARSE_ERROR_MSG[parsed.errorKey] : null;
  });
  /** Installing replaces a plugin with the same id, wanted for fixes but not by surprise. */
  readonly isReplacing = computed(() => {
    const id = this.files()?.manifest.id;
    // a built-in id is refused on install, so it replaces nothing
    return (
      !!id && !BUNDLED_PLUGIN_IDS.has(id) && this._pluginService.pluginStates().has(id)
    );
  });
  readonly permissionsText = computed(() => {
    // the AI's raw manifest is not validated until install
    const permissions: unknown = this.files()?.manifest.permissions;
    return Array.isArray(permissions)
      ? permissions.filter((p) => typeof p === 'string').join(', ')
      : '';
  });

  async copyPrompt(): Promise<void> {
    if (await this._copy(buildPluginPrompt(this.idea(), environment.version), 'Prompt')) {
      this.step.set(2);
    }
  }

  /** Copies a load error (step 3) or an install error (step 2) as a fix request. */
  async copyError(): Promise<void> {
    const installed = this.installed();
    const error = installed?.error ?? this.installError();
    if (error) {
      const report = buildPluginErrorReport(
        error,
        environment.version,
        installed?.id ?? null,
      );
      await this._copy(report, 'Error');
    }
  }

  /** An edited answer is a new attempt; the last install error no longer applies. */
  onAnswerInput(value: string): void {
    this.answer.set(value);
    this.installError.set(null);
  }

  pasteFixedCode(): void {
    this.answer.set('');
    this.installed.set(null);
    this.step.set(2);
  }

  async install(): Promise<void> {
    const files = this.files();
    if (!files || this.isInstalling()) {
      return;
    }
    this.isInstalling.set(true);
    this.installError.set(null);
    const stateBefore = this._pluginService.pluginStates().get(files.manifest.id);
    try {
      const zip = await createPluginZipFile(files);
      if (await this._confirmInstall(zip)) {
        this.installed.set(await this._installAndActivate(zip));
        this.step.set(3);
      }
    } catch (error) {
      PluginLog.err('Failed to install plugin from AI answer:', error);
      if (!this._showRecordedLoadError(files.manifest, stateBefore)) {
        // loadPluginFromZip throws translated messages, as shown for ZIP uploads
        this.installError.set(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.isInstalling.set(false);
    }
  }

  /**
   * Re-installing an enabled plugin throws when its onReady fails, after recording
   * the error on its state: that is a load error for step 3, not an install error.
   */
  private _showRecordedLoadError(
    { id, name }: PluginManifest,
    stateBefore: PluginState | undefined,
  ): boolean {
    const state = this._pluginService.pluginStates().get(id);
    if (!state || state === stateBefore || state.status !== 'error' || !state.error) {
      return false;
    }
    this.installed.set({ id, name, status: 'error', error: state.error });
    this.step.set(3);
    return true;
  }

  private _confirmInstall(zip: File): Promise<boolean> {
    return confirmPluginInstall(zip, {
      matDialog: this._matDialog,
      translateService: this._translateService,
      pluginStates: this._pluginService.pluginStates(),
    });
  }

  private async _installAndActivate(zip: File): Promise<BuildPluginInstallResult> {
    const instance = await this._pluginService.loadPluginFromZip(zip);
    const { id, name } = instance.manifest;
    // A first upload installs disabled; whoever builds a plugin here wants to try
    // it now. Already enabled (a fixed re-install) or blocked: it ran or can't run.
    if (!instance.isEnabled && !instance.error) {
      await this._pluginService.enableAndActivatePlugin(id);
    }
    // activation failures land in the plugin state, not on the returned instance
    const state = this._pluginService.pluginStates().get(id);
    const error = state?.error ?? instance.error;
    if (error) {
      return { id, name, status: 'error', error };
    }
    return { id, name, status: state?.status === 'loaded' ? 'running' : 'off' };
  }

  private async _copy(text: string, label: string): Promise<boolean> {
    const result = await this._shareService.copyToClipboard(text, label);
    if (!result.success) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.PLUGINS.BUILD_DIALOG.COPY_FAILED,
      });
    }
    return result.success;
  }
}
