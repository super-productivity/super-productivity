import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Input,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { trigger, transition, style, animate } from '@angular/animations';
import { PluginService } from '../../plugin.service';
import { PluginBridgeService } from '../../plugin-bridge.service';
import { PluginCleanupService } from '../../plugin-cleanup.service';
import {
  PluginIframeConfig,
  createPluginIframeUrl,
  handlePluginMessage,
  cleanupPluginIframeUrl,
} from '../../util/plugin-iframe.util';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from '@angular/material/card';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PluginLog } from '../../../core/log';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
  selector: 'plugin-index',
  templateUrl: './plugin-index.component.html',
  styleUrls: ['./plugin-index.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatButton,
    MatIcon,
    MatProgressSpinner,
    MatCard,
    MatCardContent,
    MatCardHeader,
    MatCardTitle,
    TranslatePipe,
  ],
  animations: [
    trigger('pluginSwitch', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(20px)' }),
        animate('300ms ease-in-out', style({ opacity: 1, transform: 'translateX(0)' })),
      ]),
      transition('* => *', [
        style({ opacity: 0, transform: 'translateX(-20px)' }),
        animate('300ms ease-in-out', style({ opacity: 1, transform: 'translateX(0)' })),
      ]),
    ]),
  ],
})
export class PluginIndexComponent implements OnInit, OnDestroy {
  @ViewChild('iframe', { static: false }) iframeRef?: ElementRef<HTMLIFrameElement>;

  // Optional input for direct plugin ID (for embedding in other components)
  @Input() directPluginId?: string;
  // Optional input to hide the back button and header UI
  @Input() showFullUI: boolean = true;
  // Optional input to use side panel configuration instead of full page
  @Input() useSidePanelConfig: boolean = false;

  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _sanitizer = inject(DomSanitizer);
  private readonly _pluginService = inject(PluginService);
  private readonly _pluginBridge = inject(PluginBridgeService);
  private readonly _cleanupService = inject(PluginCleanupService);
  private readonly _translateService = inject(TranslateService);
  private readonly _layoutService = inject(LayoutService);

  T = T;

  readonly pluginId = signal<string>('');
  readonly isLoading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly iframeSrc = signal<SafeResourceUrl | null>(null);
  readonly isResizing = this._layoutService.isPanelResizing;

  private _messageListener?: EventListener;
  private _routeSubscription?: Subscription;
  private _currentIframeUrl: string | null = null;

  async ngOnInit(): Promise<void> {
    // If directPluginId is provided, load that plugin directly
    if (this.directPluginId) {
      this.pluginId.set(this.directPluginId);
      this._cleanupIframeCommunication();
      await this._waitForPluginSystem();

      try {
        await this._loadPluginIndex(this.directPluginId);
      } catch (err) {
        PluginLog.err('Failed to load plugin index:', err);
        this.error.set(err instanceof Error ? err.message : 'Failed to load plugin');
        this.isLoading.set(false);
      }
      return;
    }

    // Subscribe to route parameter changes to handle navigation between plugins
    this._routeSubscription = this._route.paramMap.subscribe(async (params) => {
      const newPluginId = params.get('pluginId');
      PluginLog.log(
        'Route paramMap changed, newPluginId:',
        newPluginId,
        'currentPluginId:',
        this.pluginId(),
      );

      if (!newPluginId) {
        this.error.set('Plugin ID not provided');
        this.isLoading.set(false);
        return;
      }

      // Skip if it's the same plugin (prevent unnecessary reloads)
      if (this.pluginId() === newPluginId) {
        PluginLog.log('Same plugin ID, skipping reload');
        return;
      }

      PluginLog.log(
        `Navigating from plugin "${this.pluginId()}" to plugin "${newPluginId}"`,
      );

      // Clean up previous iframe communication BEFORE setting new plugin ID
      this._cleanupIframeCommunication();

      // Reset state when navigating to a different plugin
      this.isLoading.set(true);
      this.error.set(null);
      this.pluginId.set(newPluginId);

      // Wait for plugin system to be initialized
      await this._waitForPluginSystem();

      try {
        await this._loadPluginIndex(newPluginId);
      } catch (err) {
        PluginLog.err('Failed to load plugin index:', err);
        this.error.set(err instanceof Error ? err.message : 'Failed to load plugin');
        this.isLoading.set(false);
      }
    });
  }

  private async _waitForPluginSystem(): Promise<void> {
    // Check if plugin system is already initialized
    if (!this._pluginService.isInitialized()) {
      // Initialize it immediately
      try {
        await this._pluginService.initializePlugins();
      } catch (error) {
        PluginLog.err('Failed to initialize plugin system:', error);
        throw new Error('Failed to initialize plugin system');
      }
    }
  }

  ngOnDestroy(): void {
    this._cleanupIframeCommunication();
    if (this._routeSubscription) {
      this._routeSubscription.unsubscribe();
    }
  }

  goBack(): void {
    this._router.navigate(['/config'], { fragment: 'plugins' });
  }

  private async _loadPluginIndex(pluginId: string): Promise<void> {
    PluginLog.log(`Loading plugin index for: ${pluginId}`);

    // Get the plugin index.html content
    const indexContent = this._pluginService.getPluginIndexHtml(pluginId);
    if (!indexContent) {
      PluginLog.err(`No index.html content found for plugin: ${pluginId}`);
      // Try to get the plugin instance to check if it should have an index.html
      const plugins = await this._pluginService.getAllPlugins();
      const plugin = plugins.find((p) => p.manifest.id === pluginId);

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      if (!plugin.manifest.iFrame) {
        throw new Error('Plugin does not support iframes');
      }

      throw new Error('Plugin index.html not loaded');
    }

    // Get plugin data for iframe setup
    const plugins = await this._pluginService.getAllPlugins();
    const plugin = plugins.find((p) => p.manifest.id === pluginId);
    if (!plugin) {
      throw new Error('Plugin not found');
    }

    const baseCfg = await this._pluginService.getBaseCfg();

    // Create simple plugin config
    const config: PluginIframeConfig = {
      pluginId,
      manifest: plugin.manifest,
      indexHtml: indexContent,
      baseCfg,
      pluginBridge: this._pluginBridge,
      boundMethods: this._pluginBridge.createBoundMethods(pluginId, plugin.manifest),
    };

    // Create iframe URL using blob URL
    const iframeUrl = createPluginIframeUrl(config);

    // Store the URL for cleanup
    this._currentIframeUrl = iframeUrl;

    // Store message handler for cleanup
    this._messageListener = async (event: Event) => {
      await handlePluginMessage(event as MessageEvent, config);
    };

    // Set up message communication
    window.addEventListener('message', this._messageListener);

    // Create safe URL and set iframe source
    const safeUrl = this._sanitizer.bypassSecurityTrustResourceUrl(iframeUrl);
    PluginLog.log(
      `Setting iframe src for plugin ${pluginId}:`,
      iframeUrl.startsWith('blob:')
        ? `blob:${iframeUrl.split(':')[1].substring(0, 20)}...`
        : iframeUrl.substring(0, 100) + '...',
    );
    this.iframeSrc.set(safeUrl);
    this.isLoading.set(false);
    PluginLog.log(`Plugin ${pluginId} iframe src set, loading complete`);
  }

  private _cleanupIframeCommunication(): void {
    const currentPluginId = this.pluginId();
    PluginLog.log(`Cleaning up iframe communication for plugin: ${currentPluginId}`);

    // Remove message listener
    if (this._messageListener) {
      window.removeEventListener('message', this._messageListener);
      this._messageListener = undefined;
      PluginLog.log(`Removed message listener for plugin: ${currentPluginId}`);
    }

    // Cleanup blob URL if it exists
    if (this._currentIframeUrl) {
      cleanupPluginIframeUrl(this._currentIframeUrl);
      console.log(`Cleaned up blob URL for plugin: ${currentPluginId}`);
      this._currentIframeUrl = null;
    }

    // Clear iframe reference from cleanup service (but don't remove from DOM)
    if (currentPluginId) {
      this._cleanupService.cleanupPlugin(currentPluginId);
      PluginLog.log(`Cleaned up plugin references for: ${currentPluginId}`);
    }

    // Set iframe to empty data URL to stop execution but keep iframe in DOM
    this.iframeSrc.set(
      this._sanitizer.bypassSecurityTrustResourceUrl(
        'data:text/html,<html><body></body></html>',
      ),
    );
    PluginLog.log(`Set iframe to empty data URL for plugin: ${currentPluginId}`);
  }

  onIframeLoad(): void {
    PluginLog.log('Plugin iframe loaded for plugin:', this.pluginId());

    // Register iframe with cleanup service
    if (this.iframeRef?.nativeElement && this.pluginId()) {
      this._cleanupService.registerIframe(this.pluginId(), this.iframeRef.nativeElement);
    }
  }
}
