import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { T } from '../../../t.const';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { firstValueFrom, of, Subject } from 'rxjs';
import { DialogEditIssueProviderComponent } from './dialog-edit-issue-provider.component';
import { ICAL_TYPE } from '../issue.const';
import { IssueProvider, IssueProviderKey } from '../issue.model';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { RegisteredPluginIssueProvider } from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { IssueService } from '../issue.service';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskService } from '../../tasks/task.service';
import { TagService } from '../../tag/tag.service';
import { PluginOAuthBridgeService } from '../../../plugins/oauth/plugin-oauth-bridge.service';
import { PluginOAuthService } from '../../../plugins/oauth/plugin-oauth.service';
import {
  deleteOAuthTokens,
  loadOAuthTokens,
  saveOAuthTokens,
} from '../../../plugins/oauth/plugin-oauth-token-store';
import { GOOGLE_CALENDAR_PLUGIN_ID } from '../../../plugins/oauth/plugin-oauth-token-key.util';

describe('DialogEditIssueProviderComponent', () => {
  let fixture: ComponentFixture<DialogEditIssueProviderComponent> | undefined;
  let component: DialogEditIssueProviderComponent;
  let beforeClosed$: Subject<void>;
  let pluginBridge: jasmine.SpyObj<PluginBridgeService>;
  let store: jasmine.SpyObj<Store>;
  let cleanupPending: Promise<void> = Promise.resolve();

  const GOOGLE_PROVIDER_KEY = `plugin:${GOOGLE_CALENDAR_PLUGIN_ID}` as IssueProviderKey;
  const OTHER_PROVIDER_KEY = 'plugin:other-provider' as IssueProviderKey;
  const BASE_OAUTH_CONFIG: OAuthFlowConfig = {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: 'desktop-client-id',
    webClientId: 'web-client-id',
    scopes: ['calendar.readonly'],
  };

  const tokenStoreKeys = [
    `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth`,
    `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__new-provider`,
    `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__existing-provider`,
  ];

  const createProvider = (
    issueProviderKey: IssueProviderKey,
    pluginId: string,
  ): RegisteredPluginIssueProvider =>
    ({
      pluginId,
      registeredKey: issueProviderKey,
      definition: {
        configFields: [
          {
            key: 'connect',
            type: 'oauthButton',
            label: 'Connect',
            oauthConfig: BASE_OAUTH_CONFIG,
          },
        ],
        issueDisplay: [],
        getHeaders: () => ({}),
      },
      name: 'Plugin',
      humanReadableName: 'Plugin',
      icon: 'extension',
      pollIntervalMs: 0,
      issueStrings: { singular: 'Issue', plural: 'Issues' },
      useAgendaView: true,
    }) as unknown as RegisteredPluginIssueProvider;

  const createIssueProvider = (
    issueProviderKey: IssueProviderKey,
    pluginId: string,
    id = 'existing-provider',
  ): IssueProvider =>
    ({
      id,
      isEnabled: true,
      issueProviderKey,
      pluginId,
      pluginConfig: {},
    }) as IssueProvider;

  const createPluginBridgeSpy = (): jasmine.SpyObj<PluginBridgeService> => {
    const bridge = jasmine.createSpyObj<PluginBridgeService>('PluginBridgeService', [
      'restoreAndCheckOAuthTokens',
      'clearOAuthTokens',
      'clearOAuthToken',
      'startOAuthFlow',
    ]);
    bridge.restoreAndCheckOAuthTokens.and.resolveTo(false);
    bridge.clearOAuthTokens.and.resolveTo();
    bridge.clearOAuthToken.and.callFake((pluginId, tokenKey) => {
      const key = tokenKey ? `${pluginId}__oauth__${tokenKey}` : `${pluginId}__oauth`;
      cleanupPending = deleteOAuthTokens(key);
      return cleanupPending;
    });
    bridge.startOAuthFlow.and.callFake(async (pluginId, _config, tokenKey) => {
      const key = tokenKey ? `${pluginId}__oauth__${tokenKey}` : `${pluginId}__oauth`;
      tokenStoreKeys.push(key);
      await saveOAuthTokens(key, 'connected-credential');
      return {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 4102444800000,
      };
    });
    return bridge;
  };

  const setup = async ({
    data = { issueProviderKey: ICAL_TYPE },
    pluginProvider,
    bridge = createPluginBridgeSpy(),
  }: {
    data?: {
      issueProvider?: IssueProvider;
      issueProviderKey?: IssueProviderKey;
      isDuplicate?: boolean;
    };
    pluginProvider?: RegisteredPluginIssueProvider;
    bridge?: jasmine.SpyObj<PluginBridgeService> | Partial<PluginBridgeService>;
  } = {}): Promise<void> => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    beforeClosed$ = new Subject<void>();
    pluginBridge = bridge as jasmine.SpyObj<PluginBridgeService>;
    store = jasmine.createSpyObj<Store>('Store', ['dispatch', 'select', 'pipe']);

    const pluginRegistry = jasmine.createSpyObj<PluginIssueProviderRegistryService>(
      'PluginIssueProviderRegistryService',
      [
        'hasProvider',
        'getUseAgendaView',
        'getProvider',
        'getName',
        'getConfigFields',
        'getFieldMappings',
      ],
    );
    pluginRegistry.hasProvider.and.callFake(
      (key: string) => !!pluginProvider && key === pluginProvider.registeredKey,
    );
    pluginRegistry.getUseAgendaView.and.returnValue(
      pluginProvider?.useAgendaView ?? false,
    );
    pluginRegistry.getProvider.and.callFake((key: string) =>
      pluginProvider && key === pluginProvider.registeredKey ? pluginProvider : undefined,
    );
    pluginRegistry.getName.and.returnValue(pluginProvider?.name ?? 'Plugin');
    pluginRegistry.getConfigFields.and.returnValue(
      pluginProvider?.definition.configFields ?? [],
    );
    pluginRegistry.getFieldMappings.and.returnValue(
      pluginProvider?.definition.fieldMappings ?? [],
    );

    await TestBed.configureTestingModule({
      imports: [DialogEditIssueProviderComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: PluginIssueProviderRegistryService, useValue: pluginRegistry },
        { provide: PluginBridgeService, useValue: pluginBridge },
        PluginOAuthBridgeService,
        PluginOAuthService,
        { provide: HttpClient, useValue: jasmine.createSpyObj('HttpClient', ['post']) },
        {
          provide: PluginHttpService,
          useValue: jasmine.createSpyObj('PluginHttpService', ['createHttpHelper']),
        },
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj('MatDialogRef', ['close', 'beforeClosed']),
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: Store, useValue: store },
        {
          provide: IssueService,
          useValue: jasmine.createSpyObj('IssueService', ['testConnection']),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: TaskService, useValue: { allTasks$: of([]) } },
        { provide: TagService, useValue: { tagsNoMyDayAndNoList$: of([]) } },
      ],
    })
      // Render nothing: we only exercise the component logic, not the
      // (heavy) template with its Material + child-component dependencies.
      .overrideComponent(DialogEditIssueProviderComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    const dialogRef = TestBed.inject(MatDialogRef) as jasmine.SpyObj<
      MatDialogRef<DialogEditIssueProviderComponent>
    >;
    dialogRef.beforeClosed.and.returnValue(beforeClosed$.asObservable());

    fixture = TestBed.createComponent(DialogEditIssueProviderComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
    await Promise.resolve();
  };

  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    fixture?.destroy();
    await Promise.all(tokenStoreKeys.map((key) => deleteOAuthTokens(key)));
  });

  describe('formlyModelChange (#8777 infinite rebuild-loop guard)', () => {
    // Formly runs in immutable mode (see formly-config.module.ts) and emits a
    // fresh clone of the full model on every change, short-circuiting its own
    // rebuild ONLY when it receives that exact reference back
    // (`_modelChangeValue === model`). If the handler runs the emitted model
    // through mergeIssueProviderModelUpdates() it produces a NEW object, defeats
    // that guard, and — because immutable mode re-clones array field values on
    // each rebuild — spins an infinite rebuild -> patchValue -> modelChange loop
    // that froze the whole app when picking a "Calendars to display" entry (an
    // array-valued multiSelect field). #8777
    it('assigns the emitted model by reference (no merged copy)', () => {
      const emitted = {
        ...component.model,
        pluginConfig: { readCalendarIds: ['primary'] },
      } as Partial<IssueProvider>;

      component.formlyModelChange(emitted);

      // Formly's immutable guard compares the top-level model reference; a merged
      // copy would differ and re-trigger a rebuild, looping forever on arrays.
      expect(component.model).toBe(emitted);
    });

    it('resets isConnectionWorks so a prior success is invalidated', () => {
      component.isConnectionWorks.set(true);

      component.formlyModelChange({ ...component.model } as Partial<IssueProvider>);

      expect(component.isConnectionWorks()).toBe(false);
    });
  });

  describe('customCfgCmpSave', () => {
    // Custom cfg components (Jira/OpenProject/Nextcloud-Deck) emit PARTIAL config
    // updates, so this path must still merge to preserve omitted keys.
    it('merges partial pluginConfig updates, preserving omitted keys', () => {
      component.model = {
        ...component.model,
        pluginConfig: { accountId: '1', bucketId: '10' },
      } as Partial<IssueProvider>;

      component.customCfgCmpSave({
        pluginConfig: { accountId: '2' },
      } as unknown as Parameters<typeof component.customCfgCmpSave>[0]);

      const model = component.model;
      const pluginConfig = 'pluginConfig' in model ? model.pluginConfig : undefined;
      expect(pluginConfig).toEqual({
        accountId: '2',
        bucketId: '10',
      });
    });
  });

  describe('Google OAuth dialog isolation', () => {
    it('with real OAuth persistence seeded only with legacy tokens, stays disconnected and creates no scoped copy', async () => {
      const legacyKey = `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth`;
      await deleteOAuthTokens(legacyKey);
      await saveOAuthTokens(
        legacyKey,
        JSON.stringify({
          accessToken: 'legacy-access',
          refreshToken: 'legacy-refresh',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          clientId: 'client-id',
          expiresAt: Date.now() + 3_600_000,
        }),
      );

      const bridge = {
        restoreAndCheckOAuthTokens: (
          pluginId: string,
          tokenKey?: string,
        ): Promise<boolean> =>
          TestBed.inject(PluginOAuthBridgeService).restoreAndCheckOAuthTokens(
            pluginId,
            BASE_OAUTH_CONFIG,
            tokenKey,
          ),
        clearOAuthToken: (pluginId: string, tokenKey?: string): Promise<void> =>
          TestBed.inject(PluginOAuthBridgeService).clearOAuthToken(pluginId, tokenKey),
        startOAuthFlow: (
          pluginId: string,
          oauthConfig: OAuthFlowConfig,
          tokenKey?: string,
        ) =>
          TestBed.inject(PluginOAuthBridgeService).startOAuthFlow(
            pluginId,
            oauthConfig,
            tokenKey,
          ),
      } satisfies Partial<PluginBridgeService>;

      await setup({
        data: { issueProviderKey: GOOGLE_PROVIDER_KEY },
        pluginProvider: createProvider(GOOGLE_PROVIDER_KEY, GOOGLE_CALENDAR_PLUGIN_ID),
        bridge,
      });
      const scopedKey = `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__${component.model.id}`;
      tokenStoreKeys.push(scopedKey);
      expect(component.isOAuthConnected()).toBeFalse();
      expect(await loadOAuthTokens(scopedKey)).toBeNull();
      expect(await loadOAuthTokens(legacyKey)).not.toBeNull();
    });

    it('cleans a scoped Google token when a new provider dialog closes after connect', async () => {
      await setup({
        data: { issueProviderKey: GOOGLE_PROVIDER_KEY },
        pluginProvider: createProvider(GOOGLE_PROVIDER_KEY, GOOGLE_CALENDAR_PLUGIN_ID),
      });

      await component.connectOAuth(BASE_OAUTH_CONFIG);
      beforeClosed$.next();
      await cleanupPending;
      expect(
        await loadOAuthTokens(
          `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__${component.model.id}`,
        ),
      ).toBeNull();
    });

    it('cleans a scoped Google token if OAuth finishes after the new provider dialog was cancelled', async () => {
      const oauthDone$ = new Subject<{
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
      }>();
      pluginBridge.startOAuthFlow.and.returnValue(firstValueFrom(oauthDone$));
      await setup({
        data: { issueProviderKey: GOOGLE_PROVIDER_KEY },
        pluginProvider: createProvider(GOOGLE_PROVIDER_KEY, GOOGLE_CALENDAR_PLUGIN_ID),
        bridge: pluginBridge,
      });

      const connectPromise = component.connectOAuth(BASE_OAUTH_CONFIG);
      beforeClosed$.next();
      await cleanupPending;
      const key = `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__${component.model.id}`;
      tokenStoreKeys.push(key);
      await saveOAuthTokens(key, 'credential-arriving-after-cancel');

      oauthDone$.next({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60_000,
      });
      await connectPromise;

      expect(await loadOAuthTokens(key)).toBeNull();
      expect(component.isOAuthConnected()).toBeFalse();
    });

    it('cleans a scoped Google token when a new provider component is destroyed without a close event', async () => {
      await setup({
        data: { issueProviderKey: GOOGLE_PROVIDER_KEY },
        pluginProvider: createProvider(GOOGLE_PROVIDER_KEY, GOOGLE_CALENDAR_PLUGIN_ID),
      });

      await component.connectOAuth(BASE_OAUTH_CONFIG);
      fixture!.destroy();
      await cleanupPending;
      expect(
        await loadOAuthTokens(
          `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__${component.model.id}`,
        ),
      ).toBeNull();
    });

    it('keeps a scoped Google token after a new provider is saved with submit(true)', async () => {
      await setup({
        data: { issueProviderKey: GOOGLE_PROVIDER_KEY },
        pluginProvider: createProvider(GOOGLE_PROVIDER_KEY, GOOGLE_CALENDAR_PLUGIN_ID),
      });

      await component.connectOAuth(BASE_OAUTH_CONFIG);
      component.submit(true);
      beforeClosed$.next();
      await cleanupPending;
      expect(
        await loadOAuthTokens(
          `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__${component.model.id}`,
        ),
      ).toBe('connected-credential');
    });

    it('keeps existing saved provider tokens when the edit dialog closes', async () => {
      const issueProvider = createIssueProvider(
        GOOGLE_PROVIDER_KEY,
        GOOGLE_CALENDAR_PLUGIN_ID,
      );
      await setup({
        data: { issueProvider },
        pluginProvider: createProvider(GOOGLE_PROVIDER_KEY, GOOGLE_CALENDAR_PLUGIN_ID),
      });

      await component.connectOAuth(BASE_OAUTH_CONFIG);
      beforeClosed$.next();
      await cleanupPending;
      expect(
        await loadOAuthTokens(
          `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth__${component.model.id}`,
        ),
      ).toBe('connected-credential');
    });

    it('does not clean legacy OAuth tokens for unscoped non-Google plugins', async () => {
      await setup({
        data: { issueProviderKey: OTHER_PROVIDER_KEY },
        pluginProvider: createProvider(OTHER_PROVIDER_KEY, 'other-provider'),
      });

      await component.connectOAuth(BASE_OAUTH_CONFIG);
      beforeClosed$.next();
      await cleanupPending;
      expect(await loadOAuthTokens('other-provider__oauth')).toBe('connected-credential');
    });
  });

  describe('testConnection failure reporting (#9635)', () => {
    const openedSnack = (): { msg: string; translateParams: { errorMsg: string } } =>
      (
        TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>
      ).open.calls.mostRecent().args[0] as {
        msg: string;
        translateParams: { errorMsg: string };
      };

    it('shows the status code so the user need not open dev tools', async () => {
      const issueService = TestBed.inject(IssueService) as jasmine.SpyObj<IssueService>;
      issueService.testConnection.and.rejectWith(
        new HttpErrorResponse({
          status: 401,
          statusText: 'Unauthorized',
          url: 'https://cal.example.com/x/basic.ics',
        }),
      );

      await component.testConnection();

      expect(openedSnack().msg).toBe(T.F.ISSUE.S.CONNECTION_FAILED_WITH_ERROR);
      expect(openedSnack().translateParams.errorMsg).toContain('401');
      expect(component.isConnectionWorks()).toBe(false);
    });

    // iCal/CalDAV URLs routinely embed a secret token and are masked on export;
    // an error toast gets screenshotted into bug reports, so it must not leak one.
    it('masks the request URL Angular bakes into the error message', async () => {
      const issueService = TestBed.inject(IssueService) as jasmine.SpyObj<IssueService>;
      issueService.testConnection.and.rejectWith(
        new HttpErrorResponse({
          status: 0,
          statusText: 'Unknown Error',
          url: 'https://cal.example.com/private/SECRET-TOKEN/basic.ics',
        }),
      );

      await component.testConnection();

      expect(openedSnack().translateParams.errorMsg).not.toContain('SECRET-TOKEN');
    });
  });
});
