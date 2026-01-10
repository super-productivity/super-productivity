import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { FocusModeCountdownComponent } from './focus-mode-countdown.component';

describe('FocusModeCountdownComponent', () => {
  let component: FocusModeCountdownComponent;
  let environmentInjector: EnvironmentInjector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);

    runInInjectionContext(environmentInjector, () => {
      component = new FocusModeCountdownComponent();
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should initialize countdownValue to 5', () => {
      expect(component.countdownValue()).toBe(5);
    });

    it('should initialize rocketState to pulse-5', () => {
      expect(component.rocketState()).toBe('pulse-5');
    });

    it('should expose T translations', () => {
      expect(component.T).toBeDefined();
    });

    it('should have countdownComplete output', () => {
      expect(component.countdownComplete).toBeDefined();
    });
  });

  describe('countdown behavior', () => {
    it('should decrement countdown value each second', fakeAsync(() => {
      component.ngOnInit();

      expect(component.countdownValue()).toBe(5);

      tick(1000);
      expect(component.countdownValue()).toBe(4);

      tick(1000);
      expect(component.countdownValue()).toBe(3);

      tick(1000);
      expect(component.countdownValue()).toBe(2);

      tick(1000);
      expect(component.countdownValue()).toBe(1);

      tick(1000);
      expect(component.countdownValue()).toBe(0);

      discardPeriodicTasks();
    }));

    it('should update rocketState with each countdown tick', fakeAsync(() => {
      component.ngOnInit();

      expect(component.rocketState()).toBe('pulse-5');

      tick(1000);
      expect(component.rocketState()).toBe('pulse-4');

      tick(1000);
      expect(component.rocketState()).toBe('pulse-3');

      tick(1000);
      expect(component.rocketState()).toBe('pulse-2');

      tick(1000);
      expect(component.rocketState()).toBe('pulse-1');

      discardPeriodicTasks();
    }));

    it('should set rocketState to launch when countdown reaches 0', fakeAsync(() => {
      component.ngOnInit();

      tick(5000);
      expect(component.rocketState()).toBe('launch');

      discardPeriodicTasks();
    }));

    it('should emit countdownComplete after launch delay', fakeAsync(() => {
      const completeSpy = spyOn(component.countdownComplete, 'emit');
      component.ngOnInit();

      tick(5000); // Countdown completes
      expect(component.rocketState()).toBe('launch');

      tick(900); // Launch animation delay
      expect(completeSpy).toHaveBeenCalled();

      discardPeriodicTasks();
    }));
  });
});
