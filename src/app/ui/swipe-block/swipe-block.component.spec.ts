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
});
