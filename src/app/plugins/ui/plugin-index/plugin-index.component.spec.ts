import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { signal } from '@angular/core';
import { PluginIframeMessageType } from '@super-productivity/plugin-api';
import { PluginIndexComponent } from './plugin-index.component';
import { PluginService } from '../../plugin.service';
import { PluginBridgeService } from '../../plugin-bridge.service';
import { PluginCleanupService } from '../../plugin-cleanup.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';

const PLUGIN_ID = 'test-plugin';

describe('PluginIndexComponent', () => {
  let fixture: ComponentFixture<PluginIndexComponent>;
  let component: PluginIndexComponent;
  let pluginService: jasmine.SpyObj<PluginService>;
  let pluginBridge: jasmine.SpyObj<PluginBridgeService>;

  const setup = async (): Promise<void> => {
    pluginService = jasmine.createSpyObj<PluginService>('PluginService', [
      'isInitialized',
      'initializePlugins',
      'getPluginIndexHtml',
      'getAllPlugins',
      'getBaseCfg',
      'getPluginIframeGeneration',
    ]);
    pluginService.isInitialized.and.returnValue(true);
    pluginService.getPluginIndexHtml.and.returnValue(
      '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    );
    pluginService.getAllPlugins.and.resolveTo([
      { manifest: { id: PLUGIN_ID, iFrame: true }, error: null } as never,
    ]);
    pluginService.getBaseCfg.and.resolveTo({} as never);
    pluginService.getPluginIframeGeneration.and.returnValue(0);

    pluginBridge = jasmine.createSpyObj<PluginBridgeService>('PluginBridgeService', [
      'createBoundMethods',
      'sendMessageToPlugin',
    ]);
    pluginBridge.createBoundMethods.and.returnValue({} as never);
    pluginBridge.sendMessageToPlugin.and.resolveTo('translated');

    const cleanupService = jasmine.createSpyObj<PluginCleanupService>(
      'PluginCleanupService',
      ['registerIframe', 'cleanupPlugin'],
    );

    await TestBed.configureTestingModule({
      imports: [PluginIndexComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: PluginService, useValue: pluginService },
        { provide: PluginBridgeService, useValue: pluginBridge },
        { provide: PluginCleanupService, useValue: cleanupService },
        { provide: LayoutService, useValue: { isPanelResizing: signal(false) } },
        { provide: ActivatedRoute, useValue: { paramMap: EMPTY } },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PluginIndexComponent);
    component = fixture.componentInstance;
    // The side-panel container drives the component via this input.
    fixture.componentRef.setInput('directPluginId', PLUGIN_ID);
    fixture.componentRef.setInput('showFullUI', false);
    fixture.componentRef.setInput('useSidePanelConfig', true);
    // contentWindow only exists for a connected iframe.
    document.body.appendChild(fixture.nativeElement);

    await component.ngOnInit();
    fixture.detectChanges();
  };

  afterEach(() => {
    fixture?.destroy();
    fixture?.nativeElement?.remove();
  });

  const getIframe = (): HTMLIFrameElement =>
    fixture.nativeElement.querySelector('iframe[data-plugin-iframe]');

  it('renders the plugin iframe after loading', async () => {
    await setup();
    expect(getIframe()).toBeTruthy();
    expect(component.isLoading()).toBe(false);
  });

  // Regression for #8394: with zoneless change detection the @ViewChild can be
  // assigned only AFTER the srcdoc iframe posts its first (tokenless)
  // PLUGIN_MESSAGE. The host must still attribute that message to the iframe via
  // the live DOM, or the message is dropped forever and the panel stays blank.
  it('handles a plugin message even when the @ViewChild iframeRef is not set', async () => {
    await setup();
    const iframe = getIframe();
    expect(iframe.contentWindow).toBeTruthy();

    // Stand in for the race: under zoneless CD the @ViewChild can still be
    // unassigned when the iframe posts its first message. Clearing it proves
    // message handling no longer depends on iframeRef (the old code read it
    // here and dropped the message); attribution comes from the live DOM.
    (component as unknown as { iframeRef?: unknown }).iframeRef = undefined;

    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          type: PluginIframeMessageType.MESSAGE,
          messageId: 'm1',
          message: { type: 'translate', payload: { key: 'HOME.TITLE' } },
        },
      }),
    );

    expect(pluginBridge.sendMessageToPlugin).toHaveBeenCalledWith(PLUGIN_ID, {
      type: 'translate',
      payload: { key: 'HOME.TITLE' },
    });
  });

  it('ignores messages whose source is not this plugin iframe', async () => {
    await setup();

    // A message from a foreign window (e.g. another plugin's iframe) must not be
    // answered with this plugin's bridge — isolation is preserved.
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: PluginIframeMessageType.MESSAGE,
          messageId: 'm2',
          message: { type: 'translate', payload: { key: 'HOME.TITLE' } },
        },
      }),
    );

    expect(pluginBridge.sendMessageToPlugin).not.toHaveBeenCalled();
  });
});
