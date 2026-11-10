import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SwipeBlockComponent } from './swipe-block.component';
import { PanEvent } from '../swipe-gesture/pan.directive';

describe('SwipeBlockComponent', () => {
  for (const initiallyEnabled of [false, true]) {
    for (const deltaX of [-100, 100]) {
      it(`ignores disabled swipe gestures in direction ${deltaX} (initially enabled: ${initiallyEnabled})`, fakeAsync(() => {
        const fixture = TestBed.createComponent(SwipeBlockComponent);
        const component = fixture.componentInstance;
        spyOn(component, 'isTouchActive').and.returnValue(true);
        fixture.componentRef.setInput('canSwipe', initiallyEnabled);
        fixture.detectChanges();
        const left = jasmine.createSpy('swipeLeft');
        const right = jasmine.createSpy('swipeRight');
        component.swipeLeft.subscribe(left);
        component.swipeRight.subscribe(right);
        const event: PanEvent = {
          deltaX,
          deltaY: 0,
          deltaTime: 50,
          isFinal: false,
          eventType: 1,
          target: fixture.nativeElement,
          clientX: 150,
          clientY: 50,
          preventDefault: () => {},
        };

        component.onPanStart(event);
        fixture.detectChanges();
        component.handlePan({ ...event, eventType: 2 });
        fixture.componentRef.setInput('canSwipe', false);
        component.onPanEnd();
        tick(250);

        expect(left).not.toHaveBeenCalled();
        expect(right).not.toHaveBeenCalled();
        expect(component.isPreventPointerEventsWhilePanning()).toBeFalse();
        fixture.destroy();
      }));
    }
  }

  describe('haptic feedback', () => {
    const win = window as { SUPAndroid?: unknown };
    let original: unknown;
    let haptic: jasmine.Spy;

    beforeEach(() => {
      original = win.SUPAndroid;
      haptic = jasmine.createSpy('performHapticFeedback');
      win.SUPAndroid = { performHapticFeedback: haptic };
    });

    afterEach(() => {
      win.SUPAndroid = original;
    });

    // Host is 200px wide, so the action threshold (scale > 0.5) is |deltaX| > 50.
    const startPan = (): {
      touchSpy: jasmine.Spy;
      pan: (deltaX: number) => void;
      destroy: () => void;
    } => {
      const fixture = TestBed.createComponent(SwipeBlockComponent);
      const component = fixture.componentInstance;
      (fixture.nativeElement as HTMLElement).style.width = '200px';
      const touchSpy = spyOn(component, 'isTouchActive').and.returnValue(true);
      fixture.detectChanges();
      const event = (deltaX: number): PanEvent => ({
        deltaX,
        deltaY: 0,
        deltaTime: 50,
        isFinal: false,
        eventType: 2,
        target: fixture.nativeElement,
        clientX: 100 + deltaX,
        clientY: 20,
        preventDefault: () => {},
      });
      component.onPanStart({ ...event(10), eventType: 1 });
      fixture.detectChanges();
      return {
        touchSpy,
        pan: (deltaX) => component.handlePan(event(deltaX)),
        destroy: () => fixture.destroy(),
      };
    };

    for (const dir of [1, -1]) {
      it(`ticks once per threshold crossing (direction ${dir})`, () => {
        const { pan, destroy } = startPan();

        pan(dir * 30);
        expect(haptic).not.toHaveBeenCalled();

        // Holding past the threshold over several frames ticks only once.
        pan(dir * 60);
        pan(dir * 80);
        pan(dir * 120);
        expect(haptic).toHaveBeenCalledOnceWith('threshold');

        // Backing off and crossing again ticks again.
        pan(dir * 30);
        pan(dir * 70);
        expect(haptic).toHaveBeenCalledTimes(2);
        destroy();
      });
    }

    it('stays silent when the swipe is not a touch gesture', () => {
      const { touchSpy, pan, destroy } = startPan();
      touchSpy.and.returnValue(false);
      pan(120);
      pan(-120);
      expect(haptic).not.toHaveBeenCalled();
      destroy();
    });
  });
});
