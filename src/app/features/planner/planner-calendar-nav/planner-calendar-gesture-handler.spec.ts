import {
  CalendarGestureHandler,
  CalendarGestureCallbacks,
  ROW_HEIGHT,
  MAX_HEIGHT,
  MIN_HEIGHT,
} from './planner-calendar-gesture-handler';

// Snap/slide durations must match the source constants
const SNAP_DURATION = 200;
const SLIDE_DURATION = 150;

/**
 * Monotonically increasing id for Touch objects so each one is unique.
 */
let touchIdCounter = 0;

/**
 * Helper: create a TouchEvent with real Touch objects.
 * The event bubbles so that dispatching on a child (e.g. handle) propagates to
 * the parent where the handler's listeners are registered.
 */
const makeTouchEvent = (type: string, clientX: number, clientY: number): TouchEvent => {
  const touch = new Touch({
    identifier: ++touchIdCounter,
    target: document.body,
    clientX,
    clientY,
  });
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === 'touchend' ? [] : [touch],
    changedTouches: [touch],
  });
};

/**
 * Helper: create a mock element tree that mirrors what the production code
 * expects -- a weeks element that contains a first-child inner element.
 */
const createMockWeeksEl = (): HTMLElement => {
  const weeksEl = document.createElement('div');
  const innerEl = document.createElement('div');
  weeksEl.appendChild(innerEl);
  return weeksEl;
};

const createMockCallbacks = (): jasmine.SpyObj<CalendarGestureCallbacks> =>
  jasmine.createSpyObj<CalendarGestureCallbacks>('callbacks', [
    'getActiveWeekIndex',
    'getIsExpanded',
    'onExpandChanged',
    'onVerticalSwipe',
    'onHorizontalSwipe',
    'detectChanges',
  ]);

describe('CalendarGestureHandler', () => {
  let el: HTMLElement;
  let weeksEl: HTMLElement;
  let cb: jasmine.SpyObj<CalendarGestureCallbacks>;
  let handler: CalendarGestureHandler;

  beforeEach(() => {
    jasmine.clock().install();
    // Mock Date.now() so jasmine.clock().tick() advances it correctly
    jasmine.clock().mockDate(new Date(2020, 0, 1));

    el = document.createElement('div');
    weeksEl = createMockWeeksEl();
    cb = createMockCallbacks();
    cb.getActiveWeekIndex.and.returnValue(0);
    cb.getIsExpanded.and.returnValue(false);

    handler = new CalendarGestureHandler(el, () => weeksEl, cb);
  });

  afterEach(() => {
    handler.destroy();
    jasmine.clock().uninstall();
  });

  // -----------------------------------------------------------------------
  // 1. Constructor / destroy
  // -----------------------------------------------------------------------
  describe('constructor and destroy', () => {
    it('should register touch event listeners on the element', () => {
      spyOn(el, 'removeEventListener').and.callThrough();
      handler.destroy();

      expect(el.removeEventListener).toHaveBeenCalledWith(
        'touchstart',
        jasmine.any(Function),
      );
      expect(el.removeEventListener).toHaveBeenCalledWith(
        'touchmove',
        jasmine.any(Function),
      );
      expect(el.removeEventListener).toHaveBeenCalledWith(
        'touchend',
        jasmine.any(Function),
      );
    });

    it('should respond to touch events after construction', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).toHaveBeenCalled();
    });

    it('should not respond to touch events after destroy', () => {
      handler.destroy();

      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 2. _onTouchStart sets up tracking (verified via side effects)
  // -----------------------------------------------------------------------
  describe('touch start tracking', () => {
    it('should reset gesture state so a new swipe can be detected', () => {
      // First gesture: vertical
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 100, 250));
      el.dispatchEvent(makeTouchEvent('touchend', 100, 250));

      // Second gesture: horizontal -- must work independently
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onVerticalSwipe).toHaveBeenCalledTimes(1);
      expect(cb.onHorizontalSwipe).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Horizontal swipe detection
  // -----------------------------------------------------------------------
  describe('horizontal swipe detection', () => {
    it('should call onHorizontalSwipe with 1 when swiping left', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 200, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 100, 100));

      expect(cb.onHorizontalSwipe).toHaveBeenCalledWith(1);
    });

    it('should call onHorizontalSwipe with -1 when swiping right', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).toHaveBeenCalledWith(-1);
    });

    it('should not call onHorizontalSwipe for small slow movements', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 110, 100));
      // Advance clock so velocity = 10px / 500ms = 0.02 (below 0.3 threshold)
      // and |deltaX| = 10 < 50 (below distance threshold)
      jasmine.clock().tick(500);
      el.dispatchEvent(makeTouchEvent('touchend', 110, 100));

      expect(cb.onHorizontalSwipe).not.toHaveBeenCalled();
    });

    it('should not call onVerticalSwipe when swiping horizontally', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onVerticalSwipe).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Vertical swipe detection
  // -----------------------------------------------------------------------
  describe('vertical swipe detection', () => {
    it('should call onVerticalSwipe with true when swiping down', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 100, 250));
      el.dispatchEvent(makeTouchEvent('touchend', 100, 250));

      expect(cb.onVerticalSwipe).toHaveBeenCalledWith(true);
    });

    it('should call onVerticalSwipe with false when swiping up', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 250));
      el.dispatchEvent(makeTouchEvent('touchmove', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 100, 100));

      expect(cb.onVerticalSwipe).toHaveBeenCalledWith(false);
    });

    it('should not call onVerticalSwipe for small slow movements', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 100, 110));
      // Advance clock so velocity = 10px / 500ms = 0.02 (below 0.3 threshold)
      // and |deltaY| = 10 < 50 (below distance threshold)
      jasmine.clock().tick(500);
      el.dispatchEvent(makeTouchEvent('touchend', 100, 110));

      expect(cb.onVerticalSwipe).not.toHaveBeenCalled();
    });

    it('should not call onHorizontalSwipe when swiping vertically', () => {
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 100, 250));
      el.dispatchEvent(makeTouchEvent('touchend', 100, 250));

      expect(cb.onHorizontalSwipe).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 5. snapTo() method
  // -----------------------------------------------------------------------
  describe('snapTo', () => {
    it('should apply CSS transition to weeks element when expanding', () => {
      handler.snapTo(true);

      expect(weeksEl.style.transition).toContain('max-height');
      expect(weeksEl.style.maxHeight).toBe(MAX_HEIGHT + 'px');
    });

    it('should apply CSS transition to weeks element when collapsing', () => {
      handler.snapTo(false);

      expect(weeksEl.style.maxHeight).toBe(MIN_HEIGHT + 'px');
    });

    it('should apply inner element transform for collapsed state with activeIdx', () => {
      handler.snapTo(false, 2);

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      expect(innerEl.style.transform).toBe(`translateY(${-2 * ROW_HEIGHT}px)`);
    });

    it('should apply zero offset for expanded state', () => {
      handler.snapTo(true, 2);

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      expect(innerEl.style.transform).toBe('translateY(0px)');
    });

    it('should call onExpandChanged after SNAP_DURATION timeout', () => {
      handler.snapTo(true);

      expect(cb.onExpandChanged).not.toHaveBeenCalled();
      jasmine.clock().tick(SNAP_DURATION + 15);
      expect(cb.onExpandChanged).toHaveBeenCalledWith(true);
    });

    it('should call detectChanges after SNAP_DURATION timeout', () => {
      handler.snapTo(false);

      jasmine.clock().tick(SNAP_DURATION + 15);
      expect(cb.detectChanges).toHaveBeenCalled();
    });

    it('should clear CSS transitions after SNAP_DURATION timeout', () => {
      handler.snapTo(true);
      jasmine.clock().tick(SNAP_DURATION + 15);

      expect(weeksEl.style.transition).toBe('');
      expect(weeksEl.style.maxHeight).toBe('');
    });

    it('should clear inner element styles after SNAP_DURATION timeout', () => {
      handler.snapTo(true);
      jasmine.clock().tick(SNAP_DURATION + 15);

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      expect(innerEl.style.transition).toBe('');
      expect(innerEl.style.transform).toBe('');
    });

    it('should do nothing when weeks element is not available', () => {
      const handlerNoEl = new CalendarGestureHandler(el, () => undefined, cb);
      handlerNoEl.snapTo(true);

      jasmine.clock().tick(SNAP_DURATION + 15);
      expect(cb.onExpandChanged).not.toHaveBeenCalled();
      handlerNoEl.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 6. slideContent() method
  // -----------------------------------------------------------------------
  describe('slideContent', () => {
    let onUpdateSpy: jasmine.Spy;

    beforeEach(() => {
      onUpdateSpy = jasmine.createSpy('onUpdate');
    });

    it('should apply slide-out CSS transition on inner element for x axis', () => {
      handler.slideContent(1, onUpdateSpy, 'x');

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      expect(innerEl.style.transition).toContain('translate');
      // direction=1, axis=x => sign = -1 => "-100% 0"
      // Browser may normalize the zero component away
      expect(innerEl.style.translate).toContain('-100%');
    });

    it('should apply slide-out CSS transition for negative x direction', () => {
      handler.slideContent(-1, onUpdateSpy, 'x');

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      // direction=-1, axis=x => sign = 1 => "100% 0"
      expect(innerEl.style.translate).toContain('100%');
      expect(innerEl.style.translate).not.toContain('-');
    });

    it('should apply slide-out CSS transition on inner element for y axis', () => {
      handler.slideContent(1, onUpdateSpy, 'y');

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      // direction=1, axis=y => sign = 1 => "0 100%"
      expect(innerEl.style.translate).toContain('100%');
      expect(innerEl.style.translate).not.toContain('-');
    });

    it('should apply slide-out for negative y direction', () => {
      handler.slideContent(-1, onUpdateSpy, 'y');

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      // direction=-1, axis=y => sign = -1 => "0 -100%"
      expect(innerEl.style.translate).toContain('-100%');
    });

    it('should call onUpdate after the first SLIDE_DURATION timeout', () => {
      handler.slideContent(1, onUpdateSpy, 'x');

      expect(onUpdateSpy).not.toHaveBeenCalled();
      jasmine.clock().tick(SLIDE_DURATION + 15);
      expect(onUpdateSpy).toHaveBeenCalled();
    });

    it('should call detectChanges after the first SLIDE_DURATION timeout', () => {
      handler.slideContent(1, onUpdateSpy, 'x');

      jasmine.clock().tick(SLIDE_DURATION + 15);
      expect(cb.detectChanges).toHaveBeenCalled();
    });

    it('should clear all transition styles after full animation completes', () => {
      handler.slideContent(1, onUpdateSpy, 'x');

      // Tick past both timeouts
      jasmine.clock().tick(SLIDE_DURATION + 15);
      jasmine.clock().tick(SLIDE_DURATION + 15);

      const innerEl = weeksEl.firstElementChild as HTMLElement;
      expect(innerEl.style.transition).toBe('');
      expect(innerEl.style.translate).toBe('');
    });

    it('should do nothing when weeks element is not available', () => {
      const handlerNoEl = new CalendarGestureHandler(el, () => undefined, cb);
      handlerNoEl.slideContent(1, onUpdateSpy, 'x');

      jasmine.clock().tick(SLIDE_DURATION * 3);
      expect(onUpdateSpy).not.toHaveBeenCalled();
      handlerNoEl.destroy();
    });

    it('should do nothing when inner element is not available', () => {
      const emptyWeeksEl = document.createElement('div');
      const handlerEmptyEl = new CalendarGestureHandler(el, () => emptyWeeksEl, cb);
      handlerEmptyEl.slideContent(1, onUpdateSpy, 'x');

      jasmine.clock().tick(SLIDE_DURATION * 3);
      expect(onUpdateSpy).not.toHaveBeenCalled();
      handlerEmptyEl.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Gestures blocked during snapping
  // -----------------------------------------------------------------------
  describe('gestures blocked during snapping', () => {
    it('should ignore touch events while snapTo animation is in progress', () => {
      handler.snapTo(true);

      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).not.toHaveBeenCalled();

      // Let the snap complete
      jasmine.clock().tick(SNAP_DURATION + 15);

      // Now gestures should work again
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).toHaveBeenCalledTimes(1);
    });

    it('should ignore touch events while slideContent animation is in progress', () => {
      handler.slideContent(1, () => {}, 'x');

      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 100, 250));
      el.dispatchEvent(makeTouchEvent('touchend', 100, 250));

      expect(cb.onVerticalSwipe).not.toHaveBeenCalled();
    });

    it('should recover _isSnapping when snapTo callback throws', () => {
      cb.onExpandChanged.and.throwError('test error');

      expect(() => {
        handler.snapTo(true);
        jasmine.clock().tick(SNAP_DURATION + 15);
      }).toThrowError('test error');

      // _isSnapping should be reset despite the error
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).toHaveBeenCalledTimes(1);
    });

    it('should recover _isSnapping when slideContent callback throws', () => {
      const throwingUpdate = jasmine.createSpy('onUpdate').and.throwError('test error');

      expect(() => {
        handler.slideContent(1, throwingUpdate, 'x');
        jasmine.clock().tick(SLIDE_DURATION + 15);
      }).toThrowError('test error');

      // _isSnapping should be reset despite the error
      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).toHaveBeenCalledTimes(1);
    });

    it('should allow gestures after slideContent animation completes', () => {
      handler.slideContent(1, () => {}, 'x');

      // Tick past both nested timeouts
      jasmine.clock().tick(SLIDE_DURATION + 15);
      jasmine.clock().tick(SLIDE_DURATION + 15);

      el.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      el.dispatchEvent(makeTouchEvent('touchmove', 250, 100));
      el.dispatchEvent(makeTouchEvent('touchend', 250, 100));

      expect(cb.onHorizontalSwipe).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Handle drag with velocity-based snapping
  // -----------------------------------------------------------------------
  describe('handle drag', () => {
    let handleEl: HTMLElement;

    beforeEach(() => {
      handleEl = document.createElement('div');
      handleEl.classList.add('handle');
      el.appendChild(handleEl);
    });

    it('should preventDefault on handle touchmove before drag threshold', () => {
      handleEl.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      const moveEvent = makeTouchEvent('touchmove', 100, 102);
      spyOn(moveEvent, 'preventDefault');
      handleEl.dispatchEvent(moveEvent);

      expect(moveEvent.preventDefault).toHaveBeenCalled();
    });

    it('should not throw on non-cancelable touchmove', () => {
      handleEl.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      const nonCancelable = new TouchEvent('touchmove', {
        bubbles: true,
        cancelable: false,
        touches: [
          new Touch({
            identifier: ++touchIdCounter,
            target: document.body,
            clientX: 100,
            clientY: 200,
          }),
        ],
        changedTouches: [
          new Touch({
            identifier: touchIdCounter,
            target: document.body,
            clientX: 100,
            clientY: 200,
          }),
        ],
      });

      expect(() => handleEl.dispatchEvent(nonCancelable)).not.toThrow();
    });

    it('should snap to expanded when dragging down past midpoint from collapsed', () => {
      cb.getIsExpanded.and.returnValue(false);
      cb.getActiveWeekIndex.and.returnValue(0);

      handleEl.dispatchEvent(makeTouchEvent('touchstart', 100, 100));
      // Move more than 5px to trigger drag mode, then advance time to keep
      // velocity low so the midpoint check is used rather than velocity
      handleEl.dispatchEvent(makeTouchEvent('touchmove', 100, 200));
      jasmine.clock().tick(1000);
      // End drag with enough delta to be past midpoint
      handleEl.dispatchEvent(makeTouchEvent('touchend', 100, 200));

      jasmine.clock().tick(SNAP_DURATION + 15);

      expect(cb.onExpandChanged).toHaveBeenCalledWith(true);
    });
  });
});
