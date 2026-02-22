import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { PluginService } from '../../plugin.service';
import { PluginInstance } from '../../plugin-api.model';
import { PluginMetaPersistenceService } from '../../plugin-meta-persistence.service';
import { PluginCacheService } from '../../plugin-cache.service';
import { PluginConfigService } from '../../plugin-config.service';
import { MAX_PLUGIN_ZIP_SIZE } from '../../plugin.const';
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardSubtitle,
  MatCardTitle,
} from '@angular/material/card';
import { MatSlideToggle, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatChip, MatChipSet } from '@angular/material/chips';
import { MatTooltip } from '@angular/material/tooltip';
import { MatError } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PluginIconComponent } from '../plugin-icon/plugin-icon.component';
import { PluginConfigDialogComponent } from '../plugin-config-dialog/plugin-config-dialog.component';
import { IS_ELECTRON } from '../../../app.constants';
import { PluginLog } from '../../../core/log';
import { SnackService } from '../../../core/snack/snack.service';
import { catchError, of } from 'rxjs';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { LanguageCode } from '../../../core/locale.constants';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { confirmDialog } from '../../../util/native-dialogs';

interface CommunityPlugin {
  name: string;
  shortDescription: string;
  url: string;
}

@Component({
  selector: 'plugin-management',
  templateUrl: './plugin-management.component.html',
  styleUrls: ['./plugin-management.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCard,
    MatCardActions,
    MatCardHeader,
    MatCardTitle,
    MatCardSubtitle,
    MatCardContent,
    MatSlideToggle,
    MatIcon,
    MatButton,
    MatIconButton,
    MatChip,
    MatChipSet,
    MatError,
    MatTooltip,
    TranslatePipe,
    PluginIconComponent,
    CollapsibleComponent,
  ],
})
export class PluginManagementComponent {
  private readonly _pluginService = inject(PluginService);
  private readonly _pluginMetaPersistenceService = inject(PluginMetaPersistenceService);
  private readonly _pluginCacheService = inject(PluginCacheService);
  private readonly _pluginConfigService = inject(PluginConfigService);
  private readonly _translateService = inject(TranslateService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _dialog = inject(MatDialog);
  private readonly _http = inject(HttpClient);
  private readonly _snackService = inject(SnackService);

  // Language code to human-readable name mapping
  /* eslint-disable @typescript-eslint/naming-convention */
  private readonly _languageNames: Record<string, string> = {
    ar: 'Arabic',
    de: 'German',
    cs: 'Czech',
    en: 'English',
    es: 'Spanish',
    fa: 'Persian',
    fi: 'Finnish',
    fr: 'French',
    hr: 'Croatian',
    id: 'Indonesian',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    nl: 'Dutch',
    nb: 'Norwegian',
    pl: 'Polish',
    pt: 'Portuguese',
    'pt-br': 'Portuguese (Brazil)',
    ru: 'Russian',
    sk: 'Slovak',
    sv: 'Swedish',
    tr: 'Turkish',
    uk: 'Ukrainian',
    zh: 'Chinese (Simplified)',
    'zh-tw': 'Chinese (Traditional)',
  } as const;
  /* eslint-enable @typescript-eslint/naming-convention */

  readonly communityPlugins = toSignal(
    this._http.get<CommunityPlugin[]>('assets/community-plugins.json').pipe(
      catchError((err) => {
        PluginLog.err('Failed to load community plugins:', err);
        this._snackService.open({
          type: 'ERROR',
          msg: T.PLUGINS.FAILED_TO_LOAD_COMMUNITY_PLUGINS,
        });
        return of([] as CommunityPlugin[]);
      }),
    ),
    { initialValue: [] },
  );

  T: typeof T = T;
  readonly IS_ELECTRON = IS_ELECTRON;

  // Plugin size limits for display
  readonly maxPluginSizeMB = (MAX_PLUGIN_ZIP_SIZE / 1024 / 1024).toFixed(1);

  // Computed signal for all plugins derived from pluginStates
  readonly allPlugins = computed(() => {
    const plugins: PluginInstance[] = [];
    const states = this._pluginService.pluginStates();

    for (const state of states.values()) {
      if (state.instance) {
        // Plugin is loaded, use the instance
        plugins.push(state.instance);
      } else {
        // Create a placeholder instance
        plugins.push({
          manifest: state.manifest,
          loaded: state.status === 'loaded',
          isEnabled: state.isEnabled,
          error: state.error,
        });
      }
    }
    return plugins;
  });

  // Upload state
  readonly isUploading = signal<boolean>(false);
  readonly uploadError = signal<string | null>(null);

  onPluginToggle(plugin: PluginInstance, event: MatSlideToggleChange): void {
    if (event.checked) {
      this.enablePlugin(plugin);
    } else {
      this.disablePlugin(plugin);
    }
  }

  private async enablePlugin(plugin: PluginInstance): Promise<void> {
    PluginLog.log('Enabling plugin:', plugin.manifest.id);

    try {
      // Check if plugin requires Node.js execution consent
      const hasConsent = await this._pluginService.checkNodeExecutionPermission(
        plugin.manifest,
      );
      if (!hasConsent) {
        PluginLog.log(
          'User denied Node.js execution permission for plugin:',
          plugin.manifest.id,
        );
        // Reset the toggle state
        return;
      }

      // Set plugin as enabled in persistence ONLY after consent is granted
      await this._pluginMetaPersistenceService.setPluginEnabled(plugin.manifest.id, true);

      // Activate the plugin (lazy load if needed)
      // Pass true to indicate this is a manual activation from UI
      const instance = await this._pluginService.activatePlugin(plugin.manifest.id, true);
      if (instance) {
        PluginLog.log('Plugin activated successfully:', plugin.manifest.id);
      }

      // Refresh UI with updated plugin states
    } catch (error) {
      PluginLog.err('Failed to enable plugin:', error);
    }
  }

  private async disablePlugin(plugin: PluginInstance): Promise<void> {
    PluginLog.log('Disabling plugin:', plugin.manifest.id);

    try {
      // Set plugin as disabled in persistence
      await this._pluginMetaPersistenceService.setPluginEnabled(
        plugin.manifest.id,
        false,
      );

      // Unload the plugin (this will unregister hooks and remove from loaded plugins)
      this._pluginService.unloadPlugin(plugin.manifest.id);

      // Reload plugins to get the updated state from the service
    } catch (error) {
      PluginLog.err('Failed to disable plugin:', error);
    }
  }

  isPluginLoading(plugin: PluginInstance): boolean {
    const state = this._pluginService.pluginStates().get(plugin.manifest.id);
    return state?.status === 'loading' || false;
  }

  requiresNodeExecution(plugin: PluginInstance): boolean {
    return plugin.manifest.permissions?.includes('nodeExecution') || false;
  }

  canEnablePlugin(plugin: PluginInstance): boolean {
    // Plugin can be enabled if there's no error AND either:
    // 1. It doesn't require nodeExecution, OR
    // 2. We're running in Electron
    return !plugin.error && (!this.requiresNodeExecution(plugin) || IS_ELECTRON);
  }

  getNodeExecutionMessage(): string {
    return this._translateService.instant('PLUGINS.NODE_EXECUTION_REQUIRED');
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!file.name.endsWith('.zip')) {
      this.uploadError.set(
        this._translateService.instant(T.PLUGINS.PLEASE_SELECT_ZIP_FILE),
      );
      return;
    }

    if (file.size > MAX_PLUGIN_ZIP_SIZE) {
      this.uploadError.set(
        this._translateService.instant(T.PLUGINS.FILE_TOO_LARGE, {
          maxSize: this.maxPluginSizeMB,
          fileSize: (file.size / 1024 / 1024).toFixed(1),
        }),
      );
      return;
    }

    this.isUploading.set(true);
    this.uploadError.set(null);

    try {
      await this._pluginService.loadPluginFromZip(file);

      // Clear the input
      input.value = '';
    } catch (error) {
      PluginLog.err('Failed to load plugin from ZIP:', error);
      this.uploadError.set(
        error instanceof Error
          ? error.message
          : this._translateService.instant(T.PLUGINS.FAILED_TO_INSTALL),
      );
    } finally {
      this.isUploading.set(false);
    }
  }

  async clearPluginCache(): Promise<void> {
    try {
      this.isUploading.set(true);
      this.uploadError.set(null);

      await this._pluginCacheService.clearCache();
      this._pluginService.clearUploadedPluginsFromMemory();

      PluginLog.log('Plugin cache cleared successfully');
    } catch (error) {
      PluginLog.err('Failed to clear plugin cache:', error);
      this.uploadError.set(
        error instanceof Error
          ? error.message
          : this._translateService.instant(T.PLUGINS.FAILED_TO_CLEAR_CACHE),
      );
    } finally {
      this.isUploading.set(false);
    }
  }

  isUploadedPlugin(plugin: PluginInstance): boolean {
    // Check if this is an uploaded plugin by checking if it has persistence data with 'uploaded' source
    // This is a simple heuristic - uploaded plugins have the uploaded:// path prefix
    return (
      this._pluginService.getPluginPath(plugin.manifest.id)?.startsWith('uploaded://') ??
      false
    );
  }

  async removeUploadedPlugin(plugin: PluginInstance): Promise<void> {
    if (
      !confirmDialog(
        this._translateService.instant(T.PLUGINS.CONFIRM_REMOVE, {
          name: plugin.manifest.name,
        }),
      )
    ) {
      return;
    }

    try {
      this.isUploading.set(true);
      this.uploadError.set(null);

      await this._pluginService.removeUploadedPlugin(plugin.manifest.id);

      PluginLog.log(`Plugin ${plugin.manifest.id} removed successfully`);
    } catch (error) {
      PluginLog.err('Failed to remove plugin:', error);
      this.uploadError.set(
        error instanceof Error
          ? error.message
          : this._translateService.instant(T.PLUGINS.FAILED_TO_REMOVE),
      );
    } finally {
      this.isUploading.set(false);
    }
  }

  getPluginDescription(plugin: PluginInstance): string {
    // Use manifest description if available
    if (plugin.manifest.description) {
      return plugin.manifest.description;
    }

    // Fallback: generate a basic description based on plugin manifest
    const features: string[] = [];

    if (plugin.manifest.hooks?.length > 0) {
      features.push(
        this._translateService.instant(T.PLUGINS.HOOKS, {
          count: plugin.manifest.hooks.length,
        }),
      );
    }

    if (plugin.manifest.permissions?.length > 0) {
      features.push(
        this._translateService.instant(T.PLUGINS.PERMISSIONS, {
          count: plugin.manifest.permissions.length,
        }),
      );
    }

    if (plugin.manifest.type) {
      features.push(
        this._translateService.instant(T.PLUGINS.TYPE, {
          type: plugin.manifest.type,
        }),
      );
    }

    return features.length > 0
      ? features.join(' • ')
      : this._translateService.instant(T.PLUGINS.NO_ADDITIONAL_INFO);
  }

  getPermissionsHooksTitle(plugin: PluginInstance): string {
    const parts: string[] = [];
    const pCount = plugin.manifest.permissions?.length || 0;
    const hCount = plugin.manifest.hooks?.length || 0;

    if (pCount > 0) {
      parts.push(`${this._translateService.instant(T.PLUGINS.PERMISSIONS)} (${pCount})`);
    }
    if (hCount > 0) {
      parts.push(`${this._translateService.instant(T.PLUGINS.HOOKS)} (${hCount})`);
    }

    return parts.join(' / ');
  }

  async openConfigDialog(plugin: PluginInstance): Promise<void> {
    try {
      // Get the plugin path
      const pluginPath = this._pluginService.getPluginPath(plugin.manifest.id);
      if (!pluginPath) {
        throw new Error(`Plugin path not found for ${plugin.manifest.id}`);
      }

      // Load the JSON schema
      const schema = await this._pluginConfigService.loadPluginConfigSchema(
        plugin.manifest,
        pluginPath,
      );

      // Open the config dialog
      const dialogRef = this._dialog.open(PluginConfigDialogComponent, {
        data: {
          manifest: plugin.manifest,
          schema,
        },
        width: '600px',
        maxHeight: '80vh',
      });

      const result = await dialogRef.afterClosed().toPromise();
      if (result) {
        PluginLog.log(`Configuration saved for plugin ${plugin.manifest.id}`);
      }
    } catch (error) {
      PluginLog.err('Failed to open config dialog:', error);
      // Show error to user
      this.uploadError.set(
        error instanceof Error
          ? error.message
          : this._translateService.instant(T.PLUGINS.FAILED_TO_LOAD_CONFIG),
      );
    }
  }

  /**
   * Get formatted language string for display
   * Returns "English only" if no i18n or only English
   * Returns comma-separated language names otherwise
   */
  getPluginLanguages(plugin: PluginInstance): string {
    const languages = plugin.manifest.i18n?.languages;

    if (!languages || languages.length === 0) {
      return 'English';
    }

    if (languages.length === 1 && languages[0] === 'en') {
      return 'English';
    }

    // Map language codes to names and join with commas
    const languageNames = languages
      .map((code) => this._languageNames[code] || code)
      .join(', ');

    return languageNames;
  }

  /**
   * Check if plugin supports the current app language
   */
  supportsCurrentLanguage(plugin: PluginInstance): boolean {
    const currentLang = this._globalConfigService.localization()?.lng;
    if (!currentLang) {
      return false;
    }

    const languages = plugin.manifest.i18n?.languages;
    if (!languages || languages.length === 0) {
      // English-only plugins support English
      return currentLang === LanguageCode.en;
    }

    return languages.includes(currentLang);
  }
}
