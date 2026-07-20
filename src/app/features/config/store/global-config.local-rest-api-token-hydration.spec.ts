import { TestBed } from '@angular/core/testing';
import { Store, StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { DateService } from '../../../core/date/date.service';
import { GlobalConfigEffects } from './global-config.effects';
import { CONFIG_FEATURE_NAME, globalConfigReducer } from './global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { GlobalConfigState, MiscConfig } from '../global-config.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { bulkApplyOperations } from '../../../op-log/apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../../../op-log/apply/bulk-hydration.meta-reducer';
import { ActionType, Operation, OpType } from '../../../op-log/core/operation.types';
import { LanguageService } from '../../../core/language/language.service';
import { SnackService } from '../../../core/snack/snack.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { KeyboardLayoutService } from '../../../core/keyboard-layout/keyboard-layout.service';
import { IS_ELECTRON_TOKEN } from '../../../app.constants';
import { IS_MAC_TOKEN } from '../../../util/is-mac';

describe('local REST API token Electron reconciliation', () => {
  const misc = (localRestApiToken?: string): MiscConfig => ({
    ...DEFAULT_GLOBAL_CONFIG.misc,
    isLocalRestApiEnabled: true,
    localRestApiToken,
  });

  const appDataWithMisc = (miscCfg: MiscConfig): AppDataComplete =>
    ({
      globalConfig: {
        ...DEFAULT_GLOBAL_CONFIG,
        misc: miscCfg,
      } as GlobalConfigState,
    }) as unknown as AppDataComplete;

  const configOp = (miscCfg: MiscConfig, clientId = 'client1'): Operation => ({
    id: `op-cfg-misc-${clientId}`,
    opType: OpType.Update,
    entityType: 'GLOBAL_CONFIG',
    entityId: 'misc',
    actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
    payload: {
      actionPayload: { sectionKey: 'misc', sectionCfg: miscCfg },
      entityChanges: [],
    },
    vectorClock: { [clientId]: 1 },
    clientId,
    timestamp: 1_700_000_000_000,
    schemaVersion: 1,
  });

  const fullStateOp = (miscCfg: MiscConfig, clientId = 'client2'): Operation => ({
    id: `op-full-state-${clientId}`,
    opType: OpType.SyncImport,
    entityType: 'ALL',
    actionType: ActionType.LOAD_ALL_DATA,
    payload: appDataWithMisc(miscCfg),
    vectorClock: { [clientId]: 1 },
    clientId,
    timestamp: 1_700_000_000_000,
    schemaVersion: 1,
  });

  let store: Store;
  let sendSettingsUpdateSpy: jasmine.Spy;

  beforeEach(() => {
    sendSettingsUpdateSpy = jasmine.createSpy('sendSettingsUpdate');
    (window as any).ea = {
      registerGlobalShortcuts: jasmine.createSpy('registerGlobalShortcuts'),
      sendSettingsUpdate: sendSettingsUpdateSpy,
    };

    TestBed.configureTestingModule({
      imports: [
        StoreModule.forRoot(
          {
            [CONFIG_FEATURE_NAME]: globalConfigReducer,
          },
          { metaReducers: [bulkOperationsMetaReducer] },
        ),
        EffectsModule.forRoot([GlobalConfigEffects]),
      ],
      providers: [
        {
          provide: DateService,
          useValue: {
            setStartOfNextDayDiff: (): void => undefined,
            todayStr: (): string => '2026-02-20',
            getStartOfNextDayDiffMs: (): number => 0,
          },
        },
        {
          provide: LanguageService,
          useValue: { setLng: (): void => undefined, tryAutoswitch: (): boolean => true },
        },
        { provide: SnackService, useValue: { open: (): void => undefined } },
        {
          provide: UserProfileService,
          useValue: { migrateOnFirstEnable: (): Promise<void> => Promise.resolve() },
        },
        { provide: KeyboardLayoutService, useValue: new KeyboardLayoutService() },
        { provide: IS_ELECTRON_TOKEN, useValue: true },
        { provide: IS_MAC_TOKEN, useValue: false },
      ],
    });

    store = TestBed.inject(Store);
  });

  afterEach(() => {
    delete (window as any).ea;
  });

  const lastSentConfig = (): GlobalConfigState =>
    sendSettingsUpdateSpy.calls.mostRecent().args[0] as GlobalConfigState;

  it('sends the replayed tail token to Electron after loadAllData minted a fallback token', () => {
    store.dispatch(loadAllData({ appDataComplete: appDataWithMisc(misc()) }));

    store.dispatch(
      bulkApplyOperations({
        operations: [configOp(misc('tail-token-a'))],
        localClientId: 'client1',
      }),
    );

    expect(lastSentConfig().misc.localRestApiToken).toBe('tail-token-a');
  });

  it('sends remotely synced token changes to Electron after bulk replay', () => {
    store.dispatch(loadAllData({ appDataComplete: appDataWithMisc(misc('old-token')) }));

    store.dispatch(
      bulkApplyOperations({
        operations: [configOp(misc('remote-token'), 'client2')],
        localClientId: 'client1',
      }),
    );

    expect(lastSentConfig().misc.localRestApiToken).toBe('remote-token');
  });

  it('sends full-state token changes to Electron after bulk replay', () => {
    store.dispatch(loadAllData({ appDataComplete: appDataWithMisc(misc('old-token')) }));

    store.dispatch(
      bulkApplyOperations({
        operations: [fullStateOp(misc('full-state-token'))],
        localClientId: 'client1',
      }),
    );

    expect(lastSentConfig().misc.localRestApiToken).toBe('full-state-token');
  });

  it('does not send settings for unrelated bulk operations', () => {
    store.dispatch(loadAllData({ appDataComplete: appDataWithMisc(misc('old-token')) }));
    sendSettingsUpdateSpy.calls.reset();

    store.dispatch(
      bulkApplyOperations({
        operations: [
          {
            ...configOp(misc('ignored-token')),
            id: 'op-cfg-sound-client2',
            entityId: 'sound',
            payload: {
              actionPayload: { sectionKey: 'sound', sectionCfg: {} },
              entityChanges: [],
            },
          },
        ],
        localClientId: 'client1',
      }),
    );

    expect(sendSettingsUpdateSpy).not.toHaveBeenCalled();
  });
});
