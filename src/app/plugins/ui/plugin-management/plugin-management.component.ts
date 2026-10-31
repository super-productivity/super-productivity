import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { PluginService } from '../../plugin.service';
import { PluginInstance } from '../../plugin-api.model';
import { PluginMetaPersistenceService } from '../../plugin-meta-persistence.service';
import { PluginCacheService } from '../../plugin-cache.service';
import { PluginConfigService } from '../../plugin-config.service';
import { MAX_PLUGIN_ZIP_SIZE } from '../../plugin.const';
import { MatSlideToggle, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatChip, MatChipSet } from '@angular/material/chips';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { MatError } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PluginIconComponent } from '../plugin-icon/plugin-icon.component';
import { PluginConfigDialogComponent } from '../plugin-config-dialog/plugin-config-dialog.component';
import { IS_ELECTRON } from '../../../app.constants';
import { PluginLog } from '../../../core/log';
import { SnackService } from '../../../core/snack/snack.service';
import { PluginBridgeService } from '../../plugin-bridge.service';
import { DEFAULT_LANGUAGE, LanguageCode } from '../../../core/locale.constants';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { escapeHtml } from '../../../util/escape-html';
import { getUploadedPluginIds } from '../../plugin-state.model';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { firstValueFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';
import { selectAll as selectAllIssueProviders } from '../../../features/issue/store/issue-provider.selectors';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import COMMUNITY_PLUGINS_DATA from '../../../../assets/community-plugins.json';
import { PluginApiAccess, PluginSecurityService } from '../../plugin-security';
import {
  BUNDLED_PLUGIN_TABS,
  DEV_ONLY_BUNDLED_PLUGIN_IDS,
} from '../../bundled-plugins.const';
import { environment } from '../../../../environments/environment';
import { Capacitor } from '@capacitor/core';
import {
  CommunityPlugin,
  CommunityPluginDownloadError,
  CommunityPluginDownloadFailure,
  CommunityPluginRelease,
  CommunityPluginStatus,
  downloadVerifiedCommunityPlugin,
  getCommunityPluginStatus,
} from '../../util/community-plugin.util';

const COMMUNITY_DOWNLOAD_ERROR_KEYS: Record<CommunityPluginDownloadFailure, string> = {
  download: T.PLUGINS.COMMUNITY_DOWNLOAD_FAILED,
  tooLarge: T.PLUGINS.COMMUNITY_DOWNLOAD_TOO_LARGE,
  hashMismatch: T.PLUGINS.COMMUNITY_HASH_MISMATCH,
  manifestMismatch: T.PLUGINS.COMMUNITY_MANIFEST_MISMATCH,
};

interface PluginManifestAuthor {
  author?: unknown;
}

/**
 * The app's Chinese codes stand for scripts, not regions: `zh` is Simplified
 * and `zh-tw` is Traditional. Read literally, `zh-tw` would be "Chinese (Taiwan)".
 */
const LANGUAGE_CODE_TO_BCP47: Readonly<Record<string, string>> = {
  [LanguageCode.zh]: 'zh-Hans',
  [LanguageCode.zh_tw]: 'zh-Hant',
};

const createLanguageDisplayNames = (locale: string): Intl.DisplayNames | null => {
  try {
    return new Intl.DisplayNames([locale], {
      type: 'language',
      languageDisplay: 'standard',
    });
  } catch {
    return null;
  }
};

/** Never throws: an unknown or malformed code is shown as is. */
const getLanguageName = (
  displayNames: Intl.DisplayNames | null,
  code: string,
): string => {
  try {
    return displayNames?.of(LANGUAGE_CODE_TO_BCP47[code] ?? code) ?? code;
  } catch {
    return code;
  }
};

/** Falls back to the runtime's default locale for a malformed code. */
const createCollator = (locale: string): Intl.Collator => {
  const options: Intl.CollatorOptions = { sensitivity: 'base', numeric: true };
  try {
    return new Intl.Collator([locale], options);
  } catch {
    return new Intl.Collator(undefined, options);
  }
};

/** Tab indexes of the plugins page; "Features" opens by default. */
export const PLUGIN_TAB_INDEX = { FEATURES: 0, INTEGRATIONS: 1, COMMUNITY: 2 } as const;

/** How long a just-installed plugin's row stays highlighted. */
const INSTALLED_PLUGIN_HIGHLIGHT_MS = 3000;

@Component({
  selector: 'plugin-management',
  templateUrl: './plugin-management.component.html',
  styleUrls: ['./plugin-management.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    MatSlideToggle,
    MatIcon,
    MatButton,
    MatIconButton,
    MatChip,
    MatChipSet,
    MatError,
    MatTooltip,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTab,
    MatTabGroup,
    TranslatePipe,
    PluginIconComponent,
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
  private readonly _store = inject(Store);
  private readonly _router = inject(Router);
  private readonly _layoutService = inject(LayoutService);
  private readonly _pluginBridge = inject(PluginBridgeService);
  private readonly _pluginSecurity = inject(PluginSecurityService);
  private readonly _snackService = inject(SnackService);
  private readonly _injector = inject(Injector);
  private readonly _allIssueProviders = this._store.selectSignal(selectAllIssueProviders);

  /** Current UI language; follows `TranslateService.use()` so a switch re-renders. */
  private readonly _uiLang = toSignal(
    this._translateService.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this._translateService.getCurrentLang() },
  );

  /** One formatter per UI language, shared by every plugin row. */
  private readonly _languageDisplayNames = computed(() =>
    createLanguageDisplayNames(this._uiLang() || DEFAULT_LANGUAGE),
  );

  /** Sorts plugin names the way the UI language does. */
  private readonly _nameCollator = computed(() =>
    createCollator(this._uiLang() || DEFAULT_LANGUAGE),
  );

  readonly communityPlugins = signal<CommunityPlugin[]>(
    [...(COMMUNITY_PLUGINS_DATA as CommunityPlugin[])].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    ),
  );

  /** Versions of uploaded plugins, by id; listed entries are matched against these. */
  private readonly _uploadedPluginVersions = computed(() => {
    const versions = new Map<string, string>();
    for (const [id, state] of this._pluginService.pluginStates()) {
      if (state.type === 'uploaded') {
        versions.set(id, state.manifest.version);
      }
    }
    return versions;
  });

  readonly communityPluginRows = computed(() => {
    const versions = this._uploadedPluginVersions();
    return this.communityPlugins().map((plugin) => {
      const status: CommunityPluginStatus = plugin.id
        ? getCommunityPluginStatus(plugin, versions.get(plugin.id))
        : 'notInstalled';
      return { plugin, status };
    });
  });

  /** Listed entries with a newer release than the installed plugin, by plugin id. */
  readonly communityUpdates = computed(() => {
    const updates = new Map<
      string,
      { plugin: CommunityPlugin; release: CommunityPluginRelease }
    >();
    for (const { plugin, status } of this.communityPluginRows()) {
      if (status === 'updateAvailable' && plugin.id && plugin.release) {
        updates.set(plugin.id, { plugin, release: plugin.release });
      }
    }
    return updates;
  });

  T: typeof T = T;
  readonly IS_ELECTRON = IS_ELECTRON;
  /**
   * The web app cannot download from release hosts that send no CORS headers
   * (GitHub, Codeberg), so it links to the ZIP for a manual install instead.
   * Electron adds the header itself; Capacitor fetches natively. The legacy
   * Android WebView (no Capacitor bridge) has no CORS bypass, so it links too.
   */
  readonly isInAppInstall = IS_ELECTRON || Capacitor.isNativePlatform();

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

  // Development and E2E builds (plain `ng build`) are not `production`, so they list them.
  private readonly _isShowDevPlugins = !environment.production;
  // Dev-only plugins seen enabled stay listed, so disabling one does not make it vanish.
  // Filled from inside _listedPluginsByName (via isPluginListed); it only ever grows while this
  // page is open, so re-running the computed gives the same result.
  private readonly _shownDevPluginIds = new Set<string>();

  // Rows are sorted by name and never by enabled state, so a row stays where it is
  // while its toggle is used.
  private readonly _listedPluginsByName = computed(() => {
    const collator = this._nameCollator();
    return this.allPlugins()
      .filter((p) => this._isListed(p))
      .sort((a, b) => collator.compare(a.manifest.name, b.manifest.name));
  });

  private readonly _builtInPlugins = computed(() =>
    this._listedPluginsByName().filter((p) => !this._isUploadedState(p)),
  );

  // The "Features" tab: built-in plugins that are not integrations.
  readonly featurePlugins = computed(() =>
    this._builtInPlugins().filter((p) => !this._isIntegrationPlugin(p)),
  );

  // The "Integrations" tab: built-in issue and calendar providers and the plugins that
  // BUNDLED_PLUGIN_TABS places there.
  readonly integrationPlugins = computed(() =>
    this._builtInPlugins().filter((p) => this._isIntegrationPlugin(p)),
  );

  // The "Community" tab lists these between its install row and the community catalog.
  readonly uploadedPlugins = computed(() =>
    this._listedPluginsByName().filter((p) => this._isUploadedState(p)),
  );

  readonly selectedTabIndex = signal<number>(PLUGIN_TAB_INDEX.FEATURES);

  /** Ids of plugins whose details area is open. */
  readonly expandedPluginIds = signal<ReadonlySet<string>>(new Set());

  /** The just-installed plugin, highlighted for a moment after its row is revealed. */
  readonly highlightedPluginId = signal<string | null>(null);
  private _highlightTimeout?: number;
  private readonly _pluginRows = viewChildren<ElementRef<HTMLElement>>('pluginRow');

  constructor() {
    inject(DestroyRef).onDestroy(() => window.clearTimeout(this._highlightTimeout));
  }

  // Upload state
  readonly isUploading = signal<boolean>(false);
  readonly uploadError = signal<string | null>(null);

  onPluginToggle(plugin: PluginInstance, event: MatSlideToggleChange): void {
    if (event.checked) {
      this.enablePlugin(plugin, event);
    } else {
      this.disablePlugin(plugin, event);
    }
  }

  private async enablePlugin(
    plugin: PluginInstance,
    event: MatSlideToggleChange,
  ): Promise<void> {
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
        // The toggle switched itself on on click; turn it back off since nothing was enabled
        event.source.checked = false;
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

  private async disablePlugin(
    plugin: PluginInstance,
    event: MatSlideToggleChange,
  ): Promise<void> {
    PluginLog.log('Disabling plugin:', plugin.manifest.id);

    // Check if this plugin has attached issue providers
    const attachedProviders = this._allIssueProviders().filter(
      (ip) =>
        'pluginId' in ip && (ip as { pluginId: string }).pluginId === plugin.manifest.id,
    );
    if (attachedProviders.length > 0) {
      if (
        !(await this._confirmInDialog(T.PLUGINS.CONFIRM_DISABLE_WITH_ISSUE_PROVIDERS, {
          count: attachedProviders.length,
          name: escapeHtml(plugin.manifest.name),
        }))
      ) {
        // The toggle switched itself off on click; turn it back on since the user cancelled
        event.source.checked = true;
        return;
      }
    }

    try {
      // Persist isEnabled=false, tear down the runtime, and revoke nodeExecution consent
      // (session grant + persisted) in one place so re-enabling re-prompts — issue #8512
      // Phase 2: "consent is revocable" via the existing toggle, no separate UI. See
      // PluginService.disablePlugin for why the revoke is funnelled there.
      await this._pluginService.disablePlugin(plugin.manifest.id);

      // Reload plugins to get the updated state from the service
    } catch (error) {
      PluginLog.err('Failed to disable plugin:', error);
    }
  }

  private _isUploadedState(plugin: PluginInstance): boolean {
    return (
      this._pluginService.pluginStates().get(plugin.manifest.id)?.type === 'uploaded'
    );
  }

  private _isIntegrationPlugin(plugin: PluginInstance): boolean {
    return (
      this.isIssueProviderPlugin(plugin) ||
      BUNDLED_PLUGIN_TABS.get(plugin.manifest.id) === 'integrations'
    );
  }

  private _isListed(plugin: PluginInstance): boolean {
    return isPluginListed(plugin, this._isShowDevPlugins, this._shownDevPluginIds);
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

  getPluginAuthor(plugin: PluginInstance): string | null {
    const author = (plugin.manifest as PluginManifestAuthor).author;
    return typeof author === 'string' && author.trim().length > 0 ? author.trim() : null;
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

    this.uploadError.set(null);
    if (!(await this._confirmInstall())) {
      input.value = '';
      return;
    }

    this.isUploading.set(true);

    try {
      const plugin = await this._pluginService.loadPluginFromZip(file);
      // A plugin whose code fails at load time still resolves, with `error`
      // set and its row showing the failure; only a clean load gets a snack.
      this._revealInstalledPlugin(plugin.manifest.id);
      if (!plugin.error) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.PLUGINS.PLUGIN_INSTALLED,
          translateParams: { name: plugin.manifest.name },
        });
      }

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

  /**
   * Installs or updates a listed plugin from its pinned release. Shows the same risk
   * warning as a ZIP upload: the checksum proves the file is the listed one, not
   * that its code was reviewed.
   */
  async installCommunityPlugin(plugin: CommunityPlugin): Promise<void> {
    const { id, release } = plugin;
    if (!id || !release || this.isUploading()) {
      return;
    }
    // Re-checked: another install may have started while the dialog was open.
    if (!(await this._confirmInstall()) || this.isUploading()) {
      return;
    }

    this.isUploading.set(true);
    try {
      const file = await downloadVerifiedCommunityPlugin(id, release);
      const installed = await this._pluginService.loadPluginFromZip(file);
      this._revealInstalledPlugin(installed.manifest.id);
      if (!installed.error) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: T.PLUGINS.PLUGIN_INSTALLED,
          translateParams: { name: installed.manifest.name },
        });
      }
    } catch (error) {
      PluginLog.err('Failed to install community plugin:', id, error);
      if (error instanceof CommunityPluginDownloadError) {
        this._snackService.open({
          type: 'ERROR',
          msg: COMMUNITY_DOWNLOAD_ERROR_KEYS[error.reason],
          translateParams: { name: plugin.name, maxSize: this.maxPluginSizeMB },
        });
      } else if (error instanceof Error) {
        // loadPluginFromZip throws translated messages, as shown for ZIP uploads.
        this._snackService.open({
          type: 'ERROR',
          msg: error.message,
          isSkipTranslate: true,
        });
      } else {
        this._snackService.open({ type: 'ERROR', msg: T.PLUGINS.FAILED_TO_INSTALL });
      }
    } finally {
      this.isUploading.set(false);
    }
  }

  async clearPluginCache(): Promise<void> {
    // Counts the same plugins clearUploadedPluginsFromMemory removes. With none
    // installed, nothing visible is lost, so the cache is cleared without asking.
    const uploadedCount = getUploadedPluginIds(this._pluginService.pluginStates()).length;
    if (
      uploadedCount > 0 &&
      !(await this._confirmInDialog(
        T.PLUGINS.CONFIRM_CLEAR_CACHE,
        { count: uploadedCount },
        T.PLUGINS.REMOVE_ALL_UPLOADED_PLUGINS,
      ))
    ) {
      return;
    }

    try {
      this.isUploading.set(true);
      this.uploadError.set(null);

      await this._pluginCacheService.clearCache();
      // Awaited so persisted nodeExecution consent is cleared for every wiped uploaded
      // plugin before the method returns (issue #8512 Phase 2 — see the service method).
      await this._pluginService.clearUploadedPluginsFromMemory();

      PluginLog.log('Uploaded plugins removed');
    } catch (error) {
      PluginLog.err('Failed to remove uploaded plugins:', error);
      this.uploadError.set(
        error instanceof Error
          ? error.message
          : this._translateService.instant(T.PLUGINS.FAILED_TO_REMOVE_UPLOADED_PLUGINS),
      );
    } finally {
      this.isUploading.set(false);
    }
  }

  toggleDetails(plugin: PluginInstance): void {
    const id = plugin.manifest.id;
    this.expandedPluginIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /**
   * Shows the installed plugin's row: in the "Community" tab, scrolled into view and
   * highlighted for a moment, so an upload never looks like nothing happened (#10477).
   */
  private _revealInstalledPlugin(pluginId: string): void {
    this.selectedTabIndex.set(PLUGIN_TAB_INDEX.COMMUNITY);
    this.highlightedPluginId.set(pluginId);
    window.clearTimeout(this._highlightTimeout);
    this._highlightTimeout = window.setTimeout(() => {
      if (this.highlightedPluginId() === pluginId) {
        this.highlightedPluginId.set(null);
      }
    }, INSTALLED_PLUGIN_HIGHLIGHT_MS);

    afterNextRender(
      () => {
        this._pluginRows()
          .find((row) => row.nativeElement.dataset['pluginId'] === pluginId)
          ?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      { injector: this._injector },
    );
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
    // The name comes from the uploaded ZIP and the dialog renders the message as HTML.
    if (
      !(await this._confirmInDialog(
        T.PLUGINS.CONFIRM_REMOVE,
        { name: escapeHtml(plugin.manifest.name) },
        T.PLUGINS.REMOVE,
      ))
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

  /** Resolves true only for the OK button; Cancel, Esc and backdrop resolve false. */
  // Uploaded code is unreviewed, so the full risk list is shown here, right before it
  // is installed, instead of above every plugin on the page.
  private async _confirmInstall(): Promise<boolean> {
    const t = (key: string): string => escapeHtml(this._translateService.instant(key));
    const risks = [
      T.PLUGINS.RISK_DATA_ACCESS,
      T.PLUGINS.RISK_MALICIOUS_CODE,
      T.PLUGINS.RISK_SYSTEM_ACCESS,
      T.PLUGINS.RISK_PERFORMANCE,
    ];
    const message =
      `<p>${t(T.PLUGINS.SECURITY_WARNING)}</p>` +
      `<ul>${risks.map((risk) => `<li>${t(risk)}</li>`).join('')}</ul>` +
      `<p>${t(T.PLUGINS.RECOMMENDATION)}</p>`;
    const result = await firstValueFrom(
      this._dialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: { message, okTxt: T.PLUGINS.INSTALL_PLUGIN },
        })
        .afterClosed(),
    );
    return result === true;
  }

  private async _confirmInDialog(
    message: string,
    translateParams: Record<string, string | number>,
    okTxt?: string,
  ): Promise<boolean> {
    const result = await firstValueFrom(
      this._dialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: { message, translateParams, okTxt },
        })
        .afterClosed(),
    );
    return result === true;
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

  /**
   * Hosts the plugin can actually reach via `PluginAPI.request`. `allowedHosts` only takes
   * effect when the plugin also declares the `http` capability — the bridge rejects `request`
   * without it — so the UI must not advertise "network access" for `allowedHosts` alone.
   */
  getApiAccess(plugin: PluginInstance): PluginApiAccess[] {
    return this._pluginSecurity.getDeclaredApiAccess(plugin.manifest);
  }

  /** Declared permissions not described by getApiAccess (nothing checks them). */
  getOtherPermissions(plugin: PluginInstance): string[] {
    const described = new Set(this.getApiAccess(plugin).map((a) => a.permission));
    return (plugin.manifest.permissions ?? []).filter((p) => !described.has(p));
  }

  hasConfigHandler(plugin: PluginInstance): boolean {
    return this._pluginBridge.hasConfigHandler(plugin.manifest.id);
  }

  isIssueProviderPlugin(plugin: PluginInstance): boolean {
    return plugin.manifest.type === 'issueProvider';
  }

  /**
   * Sends the user to the issue-provider panel, the hub where connections are
   * added and managed. Enabling an issue-provider plugin here only registers it;
   * setup (and multiple connections per provider) lives in that panel's "+" tab,
   * which is otherwise hard to find. Navigates to the work view first since the
   * panel only renders there, then reveals it (guarded so we never toggle it shut).
   */
  goToIssuePanel(): Promise<void> {
    return this._router.navigate(['/active/tasks']).then(() => {
      if (!this._layoutService.isShowIssuePanel()) {
        this._layoutService.toggleAddTaskPanel();
      }
    });
  }

  openPluginConfig(plugin: PluginInstance): void {
    this._pluginBridge.invokeConfigHandler(plugin.manifest.id);
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
      // A snack, not `uploadError`: that one renders under the install row of the
      // "Community" tab, far from the plugin whose settings button was clicked. The thrown messages
      // are untranslated developer text, so they stay in the log above.
      this._snackService.open({ type: 'ERROR', msg: T.PLUGINS.FAILED_TO_LOAD_CONFIG });
    }
  }

  /**
   * Comma-separated names of the plugin's languages, in the UI language.
   * Plugins without `i18n.languages` are English-only.
   */
  getPluginLanguages(plugin: PluginInstance): string {
    const languages = plugin.manifest.i18n?.languages;
    const codes = languages?.length ? languages : [LanguageCode.en];
    const displayNames = this._languageDisplayNames();

    return codes.map((code) => getLanguageName(displayNames, code)).join(', ');
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

/**
 * Whether the plugins page lists `plugin`. Dev-only bundled plugins are listed only when
 * `isShowDevPlugins` is set or once seen enabled; `shownDevPluginIds` remembers the latter.
 */
export const isPluginListed = (
  plugin: PluginInstance,
  isShowDevPlugins: boolean,
  shownDevPluginIds: Set<string>,
): boolean => {
  const id = plugin.manifest.id;
  if (isShowDevPlugins || !DEV_ONLY_BUNDLED_PLUGIN_IDS.has(id)) {
    return true;
  }
  if (plugin.isEnabled) {
    shownDevPluginIds.add(id);
  }
  return shownDevPluginIds.has(id);
};
