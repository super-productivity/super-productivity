import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { SyncSafetyBannerService } from './sync-safety-banner.service';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId, Banner } from '../../core/banner/banner.model';
import { LS } from '../../core/persistence/storage-keys.const';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { OnboardingHintService } from '../../features/onboarding/onboarding-hint.service';
import { SyncConfig } from '../../features/config/global-config.model';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const UNCONFIGURED: Partial<SyncConfig> = { isEnabled: false, syncProvider: null };
const CONFIGURED: Partial<SyncConfig> = {
  isEnabled: true,
  syncProvider: SyncProviderId.Dropbox,
};

describe('SyncSafetyBannerService', () => {
  let service: SyncSafetyBannerService;
  let bannerService: jasmine.SpyObj<BannerService>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let syncSpy: jasmine.Spy;
  let selectSignalSpy: jasmine.Spy;
  let lsStore: Record<string, string>;
  let taskIds: string[];

  const lastBanner = (): Banner =>
    bannerService.open.calls.mostRecent().args[0] as Banner;

  const daysAgoTs = (n: number): string => {
    const offset = n * DAY_MS;
    return (NOW - offset).toString();
  };
  const manyTasks = (): string[] => Array.from({ length: 30 }, (_, i) => `t${i}`);

  // Defaults to a clearly-eligible user: first used 8 days ago, 30 tasks.
  const setEligible = (): void => {
    lsStore[LS.SYNC_SAFETY_FIRST_SEEN] = daysAgoTs(8);
    taskIds = manyTasks();
  };

  beforeEach(() => {
    lsStore = {};
    taskIds = [];
    spyOn(Date, 'now').and.returnValue(NOW);
    spyOn(localStorage, 'getItem').and.callFake((k) => lsStore[k] ?? null);
    spyOn(localStorage, 'setItem').and.callFake((k, v) => {
      lsStore[k] = v;
    });
    spyOn(OnboardingHintService, 'isOnboardingInProgress').and.returnValue(false);

    bannerService = jasmine.createSpyObj<BannerService>('BannerService', ['open']);
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    syncSpy = jasmine.createSpy('sync').and.returnValue(UNCONFIGURED);
    // Reads live `taskIds` so each test can vary the count before invoking.
    selectSignalSpy = jasmine
      .createSpy('selectSignal')
      .and.callFake(() => () => ({ ids: taskIds }));

    TestBed.configureTestingModule({
      providers: [
        SyncSafetyBannerService,
        { provide: BannerService, useValue: bannerService },
        { provide: MatDialog, useValue: matDialog },
        { provide: GlobalConfigService, useValue: { sync: syncSpy } },
        { provide: Store, useValue: { selectSignal: selectSignalSpy } },
      ],
    });
    service = TestBed.inject(SyncSafetyBannerService);
  });

  it('shows the banner once used for a while with real data and no sync', () => {
    setEligible();
    service.showReminderIfNeeded();
    expect(bannerService.open).toHaveBeenCalledTimes(1);
    expect(lastBanner().id).toBe(BannerId.SyncSafetyReminder);
    // Guards against accidentally swapping in a different task selector.
    expect(selectSignalSpy).toHaveBeenCalledWith(selectTaskFeatureState);
  });

  it('does not show while sync config is still unhydrated (undefined)', () => {
    setEligible();
    syncSpy.and.returnValue(undefined);
    service.showReminderIfNeeded();
    expect(bannerService.open).not.toHaveBeenCalled();
    // ...but the first-use clock is still seeded for next time.
    expect(lsStore[LS.SYNC_SAFETY_FIRST_SEEN]).toBe(daysAgoTs(8));
  });

  it('shows exactly at the thresholds (7 days, 20 tasks)', () => {
    lsStore[LS.SYNC_SAFETY_FIRST_SEEN] = daysAgoTs(7);
    taskIds = Array.from({ length: 20 }, (_, i) => `t${i}`);
    service.showReminderIfNeeded();
    expect(bannerService.open).toHaveBeenCalledTimes(1);
  });

  it('seeds the first-use timestamp on first run and does not show yet', () => {
    taskIds = manyTasks();
    service.showReminderIfNeeded();
    expect(lsStore[LS.SYNC_SAFETY_FIRST_SEEN]).toBe(NOW.toString());
    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('still seeds the first-use clock during onboarding (without showing)', () => {
    (OnboardingHintService.isOnboardingInProgress as jasmine.Spy).and.returnValue(true);
    taskIds = manyTasks();
    service.showReminderIfNeeded();
    expect(lsStore[LS.SYNC_SAFETY_FIRST_SEEN]).toBe(NOW.toString());
    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('does not show before the time threshold even with lots of data', () => {
    lsStore[LS.SYNC_SAFETY_FIRST_SEEN] = daysAgoTs(3);
    taskIds = manyTasks();
    service.showReminderIfNeeded();
    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('does not show with too little data even after the time threshold', () => {
    lsStore[LS.SYNC_SAFETY_FIRST_SEEN] = daysAgoTs(8);
    taskIds = ['a', 'b', 'c', 'd']; // example-task-sized
    service.showReminderIfNeeded();
    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('does not show again once dismissed', () => {
    setEligible();
    lsStore[LS.SYNC_SAFETY_NUDGE_DISMISSED] = 'true';
    service.showReminderIfNeeded();
    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('does not interrupt onboarding', () => {
    setEligible();
    (OnboardingHintService.isOnboardingInProgress as jasmine.Spy).and.returnValue(true);
    service.showReminderIfNeeded();
    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('does not show when sync is already configured', () => {
    setEligible();
    syncSpy.and.returnValue(CONFIGURED);
    service.showReminderIfNeeded();
    expect(bannerService.open).not.toHaveBeenCalled();
  });

  it('persists dismissal when the user clicks "Not now"', () => {
    setEligible();
    service.showReminderIfNeeded();
    lastBanner().action2!.fn();
    expect(lsStore[LS.SYNC_SAFETY_NUDGE_DISMISSED]).toBe('true');
  });

  it('persists dismissal and opens the sync dialog on "Set up sync"', () => {
    const openDialogSpy = spyOn(
      service as unknown as { _openSyncCfgDialog: () => Promise<void> },
      '_openSyncCfgDialog',
    ).and.resolveTo();
    setEligible();
    service.showReminderIfNeeded();
    lastBanner().action!.fn();
    expect(lsStore[LS.SYNC_SAFETY_NUDGE_DISMISSED]).toBe('true');
    expect(openDialogSpy).toHaveBeenCalledTimes(1);
  });
});
