import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { DateService } from 'src/app/core/date/date.service';
import { BannerService } from '../../../core/banner/banner.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { SimpleCounterService } from '../simple-counter.service';
import { SimpleCounterButtonComponent } from './simple-counter-button.component';

describe('SimpleCounterButtonComponent', () => {
  let fixture: ComponentFixture<SimpleCounterButtonComponent>;
  let tick$: Subject<{ duration: number; date: string }>;
  let simpleCounterService: jasmine.SpyObj<
    Pick<
      SimpleCounterService,
      | 'clearCountdownRemaining'
      | 'getCountdownRemaining'
      | 'hasStartedCountdown'
      | 'increaseCounterToday'
      | 'setCountdownRemaining'
      | 'startCountdown'
      | 'toggleCounter'
    >
  >;

  const TODAY = '2026-04-22';
  let countdownRemaining: Map<string, number>;
  let startedCountdowns: Set<string>;

  beforeEach(async () => {
    tick$ = new Subject<{ duration: number; date: string }>();
    countdownRemaining = new Map<string, number>();
    startedCountdowns = new Set<string>();

    simpleCounterService = jasmine.createSpyObj('SimpleCounterService', [
      'clearCountdownRemaining',
      'getCountdownRemaining',
      'hasStartedCountdown',
      'increaseCounterToday',
      'setCountdownRemaining',
      'startCountdown',
      'toggleCounter',
    ]);
    simpleCounterService.getCountdownRemaining.and.callFake((id: string) =>
      countdownRemaining.get(id),
    );
    simpleCounterService.hasStartedCountdown.and.callFake((id: string) =>
      startedCountdowns.has(id),
    );
    simpleCounterService.setCountdownRemaining.and.callFake(
      (id: string, remaining: number) => {
        countdownRemaining.set(id, remaining);
      },
    );
    simpleCounterService.startCountdown.and.callFake((id: string, remaining: number) => {
      startedCountdowns.add(id);
      countdownRemaining.set(id, remaining);
    });
    simpleCounterService.clearCountdownRemaining.and.callFake((id: string) => {
      startedCountdowns.delete(id);
      countdownRemaining.delete(id);
    });

    await TestBed.configureTestingModule({
      imports: [SimpleCounterButtonComponent, NoopAnimationsModule],
      providers: [
        { provide: SimpleCounterService, useValue: simpleCounterService },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: GlobalTrackingIntervalService,
          useValue: {
            todayDateStr$: of(TODAY),
            tick$,
          },
        },
        {
          provide: DateService,
          useValue: {
            todayStr: (): string => TODAY,
          },
        },
        {
          provide: BannerService,
          useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SimpleCounterButtonComponent);
  });

  it('shows countdown time while a repeated countdown is running', () => {
    setSimpleCounterInput({ isOn: true });

    expect(getExtraLabelText()).toBe('2:00');
  });

  it('keeps countdown time visible when paused before the first tick after start', () => {
    simpleCounterService.startCountdown('counter1', 120000);
    setSimpleCounterInput({ isOn: false });

    expect(getExtraLabelText()).toBe('2:00');
  });

  it('does not show countdown time before a repeated countdown has started', () => {
    setSimpleCounterInput({ isOn: false });
    emitTick();
    emitTick();

    expect(getExtraLabelText()).toBeNull();
    expect(simpleCounterService.setCountdownRemaining).not.toHaveBeenCalled();
  });

  it('starts a repeated countdown with initial remaining time', () => {
    setSimpleCounterInput({ isOn: false });

    fixture.componentInstance.toggleStopwatch();

    expect(simpleCounterService.startCountdown).toHaveBeenCalledWith('counter1', 120000);
    expect(simpleCounterService.toggleCounter).toHaveBeenCalledWith('counter1');
  });

  it('keeps restarted countdowns visible when paused again after completion', () => {
    simpleCounterService.startCountdown('counter1', 0);
    setSimpleCounterInput({ isOn: true });
    simpleCounterService.startCountdown.calls.reset();
    simpleCounterService.clearCountdownRemaining.calls.reset();

    fixture.componentInstance.isTimeUp.set(true);
    fixture.componentInstance.countUpAndNextRepeatCountdownSession();
    setSimpleCounterInput({ isOn: false });

    expect(simpleCounterService.clearCountdownRemaining).toHaveBeenCalledWith('counter1');
    expect(simpleCounterService.startCountdown).toHaveBeenCalledWith('counter1', 120000);
    expect(getExtraLabelText()).toBe('2:00');
  });

  const emitTick = (duration = 0): void => {
    tick$.next({ duration, date: TODAY });
    fixture.detectChanges();
  };

  const getExtraLabelText = (): string | null => {
    fixture.detectChanges();
    return (
      fixture.nativeElement.querySelector('.extra-label')?.textContent?.trim() || null
    );
  };

  const setSimpleCounterInput = (overrides: Partial<SimpleCounter>): void => {
    const simpleCounter: SimpleCounter = {
      ...EMPTY_SIMPLE_COUNTER,
      id: 'counter1',
      title: 'Stretch',
      isEnabled: true,
      type: SimpleCounterType.RepeatedCountdownReminder,
      countdownDuration: 120000,
      countOnDay: {},
      ...overrides,
    };

    fixture.componentRef.setInput('simpleCounter', simpleCounter);
    fixture.detectChanges();
  };
});
