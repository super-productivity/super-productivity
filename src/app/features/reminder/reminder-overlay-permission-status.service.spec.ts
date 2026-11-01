import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  REMINDER_OVERLAY_PERMISSION_BRIDGE,
  REMINDER_OVERLAY_RECHECK_ON_RESUME,
  ReminderOverlayPermissionBridge,
  ReminderOverlayPermissionStatusService,
} from './reminder-overlay-permission-status.service';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';

describe('ReminderOverlayPermissionStatusService', () => {
  let service: ReminderOverlayPermissionStatusService;
  let bridge: jasmine.SpyObj<ReminderOverlayPermissionBridge>;
  let resume$: Subject<void>;

  beforeEach(() => {
    resume$ = new Subject<void>();
    bridge = jasmine.createSpyObj('ReminderOverlayPermissionBridge', [
      'canDrawOverlays',
      'openSettings',
    ]);
    bridge.canDrawOverlays.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        ReminderOverlayPermissionStatusService,
        { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: true },
        { provide: REMINDER_OVERLAY_PERMISSION_BRIDGE, useValue: bridge },
        { provide: REMINDER_OVERLAY_RECHECK_ON_RESUME, useValue: resume$ },
      ],
    });
    service = TestBed.inject(ReminderOverlayPermissionStatusService);
  });

  it('reports the permission state when a subscriber attaches', () => {
    const values: boolean[] = [];
    const sub = service.isDenied$.subscribe((value) => values.push(value));

    expect(values).toEqual([true]);
    expect(bridge.canDrawOverlays).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('rechecks the permission after returning from Android settings', () => {
    const values: boolean[] = [];
    const sub = service.isDenied$.subscribe((value) => values.push(value));

    bridge.canDrawOverlays.and.returnValue(true);
    resume$.next();

    expect(values).toEqual([true, false]);
    expect(bridge.canDrawOverlays).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('does not open settings unless the user activates the hint', () => {
    service.openSettings();

    expect(bridge.openSettings).toHaveBeenCalledTimes(1);
  });

  it('does not show an Android-only hint on other platforms', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ReminderOverlayPermissionStatusService,
        { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: false },
        { provide: REMINDER_OVERLAY_PERMISSION_BRIDGE, useValue: bridge },
        { provide: REMINDER_OVERLAY_RECHECK_ON_RESUME, useValue: resume$ },
      ],
    });
    const nonAndroidService = TestBed.inject(ReminderOverlayPermissionStatusService);
    const values: boolean[] = [];
    const sub = nonAndroidService.isDenied$.subscribe((value) => values.push(value));

    expect(values).toEqual([false]);
    expect(bridge.canDrawOverlays).not.toHaveBeenCalled();
    expect(bridge.openSettings).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
