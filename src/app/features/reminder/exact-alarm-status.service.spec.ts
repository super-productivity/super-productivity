import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CapacitorReminderService } from '../../core/platform/capacitor-reminder.service';
import {
  EXACT_ALARM_RECHECK_ON_RESUME,
  ExactAlarmStatusService,
} from './exact-alarm-status.service';

describe('ExactAlarmStatusService', () => {
  let service: ExactAlarmStatusService;
  let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
  let resume$: Subject<void>;

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    resume$ = new Subject<void>();
    reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
      'isExactAlarmGranted',
      'openExactAlarmSettings',
    ]);
    reminderServiceSpy.isExactAlarmGranted.and.resolveTo(false);
    reminderServiceSpy.openExactAlarmSettings.and.resolveTo(false);

    TestBed.configureTestingModule({
      providers: [
        ExactAlarmStatusService,
        { provide: CapacitorReminderService, useValue: reminderServiceSpy },
        { provide: EXACT_ALARM_RECHECK_ON_RESUME, useValue: resume$ },
      ],
    });
    service = TestBed.inject(ExactAlarmStatusService);
  });

  it('reports denied on subscribe without opening settings', async () => {
    const values: boolean[] = [];
    const sub = service.isDenied$.subscribe((v) => values.push(v));
    await flush();

    expect(values).toEqual([true]);
    expect(reminderServiceSpy.openExactAlarmSettings).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('reports not denied when exact alarms are granted', async () => {
    reminderServiceSpy.isExactAlarmGranted.and.resolveTo(true);
    const values: boolean[] = [];
    const sub = service.isDenied$.subscribe((v) => values.push(v));
    await flush();

    expect(values).toEqual([false]);
    sub.unsubscribe();
  });

  it('re-checks on app resume and picks up a grant made in system settings', async () => {
    const values: boolean[] = [];
    const sub = service.isDenied$.subscribe((v) => values.push(v));
    await flush();

    reminderServiceSpy.isExactAlarmGranted.and.resolveTo(true);
    resume$.next();
    await flush();

    expect(values).toEqual([true, false]);
    expect(reminderServiceSpy.isExactAlarmGranted).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('does not re-emit an unchanged state on resume', async () => {
    const values: boolean[] = [];
    const sub = service.isDenied$.subscribe((v) => values.push(v));
    await flush();

    resume$.next();
    await flush();

    expect(values).toEqual([true]);
    sub.unsubscribe();
  });

  it('re-checks after returning from the settings page opened by the user', async () => {
    const values: boolean[] = [];
    const sub = service.isDenied$.subscribe((v) => values.push(v));
    await flush();

    reminderServiceSpy.isExactAlarmGranted.and.resolveTo(true);
    await service.openSettings();
    await flush();

    expect(reminderServiceSpy.openExactAlarmSettings).toHaveBeenCalledTimes(1);
    expect(values).toEqual([true, false]);
    sub.unsubscribe();
  });
});
