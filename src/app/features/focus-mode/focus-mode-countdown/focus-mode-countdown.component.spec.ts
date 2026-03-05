import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { FocusModeCountdownComponent } from './focus-mode-countdown.component';

describe('FocusModeCountdownComponent', () => {
  let environmentInjector: EnvironmentInjector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [],
    });
    environmentInjector = TestBed.inject(EnvironmentInjector);
  });

  const createComponent = (showCountdown: boolean): FocusModeCountdownComponent => {
    let comp!: FocusModeCountdownComponent;
    runInInjectionContext(environmentInjector, () => {
      comp = new FocusModeCountdownComponent();
    });
    // Override the input signal getter for testing
    (comp as any).isShowCountdown = () => showCountdown;
    return comp;
  };

  describe('initialization', () => {
    it('should initialize countdownValue to 5', () => {
      const component = createComponent(false);
      expect(component.countdownValue()).toBe(5);
    });

    it('should initialize rocketState to pulse-5', () => {
      const component = createComponent(false);
      expect(component.rocketState()).toBe('pulse-5');
    });
  });

  describe('quick launch (default, no countdown)', () => {
    it('should immediately set rocketState to launch', fakeAsync(() => {
      const component = createComponent(false);
      component.ngOnInit();

      expect(component.rocketState()).toBe('launch');
      expect(component.countdownValue()).toBe(0);

      tick(900);
      discardPeriodicTasks();
    }));

    it('should emit countdownComplete after launch delay', fakeAsync(() => {
      const component = createComponent(false);
      const completeSpy = spyOn(component.countdownComplete, 'emit');
      component.ngOnInit();

      expect(completeSpy).not.toHaveBeenCalled();

      tick(900);
      expect(completeSpy).toHaveBeenCalled();

      discardPeriodicTasks();
    }));
  });

  describe('full countdown behavior (isShowCountdown = true)', () => {
    it('should decrement countdown value each second', fakeAsync(() => {
      const component = createComponent(true);
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
      const component = createComponent(true);
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
      const component = createComponent(true);
      component.ngOnInit();

      tick(5000);
      expect(component.rocketState()).toBe('launch');

      discardPeriodicTasks();
    }));

    it('should emit countdownComplete after launch delay', fakeAsync(() => {
      const component = createComponent(true);
      const completeSpy = spyOn(component.countdownComplete, 'emit');
      component.ngOnInit();

      tick(5000);
      expect(component.rocketState()).toBe('launch');

      tick(900);
      expect(completeSpy).toHaveBeenCalled();

      discardPeriodicTasks();
    }));
  });
});
