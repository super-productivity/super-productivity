import {
  EDGE_SWIPE_OPEN_DISTANCE_PX,
  EDGE_SWIPE_ZONE_PX,
  EdgeSwipeOpenDetector,
  isEdgeSwipeExcludedTarget,
  isInHorizontalScroller,
} from './edge-swipe-open';
import { isTouchStartClaimedByEdgeSwipe } from '../../ui/swipe-gesture/edge-swipe-claim';

const WIDTH = 400;

interface FakeTouchOpts {
  id?: number;
  /** Fingers on the screen, the changed one last. Defaults to just this one. */
  others?: { id: number; x: number; y: number }[];
  target?: EventTarget | null;
}

const touchEvent = (x: number, y: number, opts: FakeTouchOpts = {}): TouchEvent => {
  const touch = { identifier: opts.id ?? 1, clientX: x, clientY: y } as Touch;
  const others = (opts.others ?? []).map(
    (o) => ({ identifier: o.id, clientX: o.x, clientY: o.y }) as Touch,
  );
  return {
    touches: [...others, touch] as unknown as TouchList,
    changedTouches: [touch] as unknown as TouchList,
    target: opts.target ?? null,
  } as unknown as TouchEvent;
};

describe('EdgeSwipeOpenDetector', () => {
  let now: number;
  let onOpen: jasmine.Spy;
  let isEnabled: jasmine.Spy;
  let detector: EdgeSwipeOpenDetector;

  beforeEach(() => {
    now = 1000;
    onOpen = jasmine.createSpy('onOpen');
    isEnabled = jasmine.createSpy('isEnabled').and.returnValue(true);
    detector = new EdgeSwipeOpenDetector({
      getViewportWidth: () => WIDTH,
      isEnabled,
      onOpen,
      now: () => now,
    });
  });

  const start = (x = WIDTH - 5, y = 300): TouchEvent => {
    const ev = touchEvent(x, y);
    detector.onTouchStart(ev);
    return ev;
  };
  const move = (x: number, y = 300): void => detector.onTouchMove(touchEvent(x, y));

  it('opens on a leftward swipe that starts in the right edge strip', () => {
    start();
    move(WIDTH - 20);
    expect(onOpen).not.toHaveBeenCalled();
    move(WIDTH - 5 - EDGE_SWIPE_OPEN_DISTANCE_PX);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('claims the touchstart so the task swipe-block below leaves it alone', () => {
    expect(isTouchStartClaimedByEdgeSwipe(start())).toBeTrue();
  });

  it('opens once per touch', () => {
    start();
    move(WIDTH - 60);
    move(WIDTH - 200);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores and does not claim touches outside the edge strip', () => {
    const ev = start(WIDTH - EDGE_SWIPE_ZONE_PX - 1);
    move(100);
    expect(isTouchStartClaimedByEdgeSwipe(ev)).toBeFalse();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores and does not claim touches while disabled', () => {
    isEnabled.and.returnValue(false);
    const ev = start();
    move(WIDTH - 100);
    expect(isTouchStartClaimedByEdgeSwipe(ev)).toBeFalse();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores touches on an excluded target', () => {
    const pager = document.createElement('swipe-pager');
    const ev = touchEvent(WIDTH - 5, 300, { target: pager });
    detector.onTouchStart(ev);
    move(WIDTH - 100);
    expect(isTouchStartClaimedByEdgeSwipe(ev)).toBeFalse();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('drops a vertical scroll', () => {
    start();
    move(WIDTH - 7, 320);
    move(WIDTH - 100, 330);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('drops a rightward move', () => {
    start(WIDTH - 15);
    move(WIDTH - 2);
    move(WIDTH - 100);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('drops a touch held long enough to be a drag before moving', () => {
    start();
    now += 450;
    move(WIDTH - 100);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not start on a multi-touch touchstart', () => {
    detector.onTouchStart(
      touchEvent(WIDTH - 5, 300, { id: 2, others: [{ id: 1, x: 100, y: 100 }] }),
    );
    detector.onTouchMove(touchEvent(WIDTH - 100, 300, { id: 2 }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps tracking, and claims, when a second finger joins', () => {
    start();
    const second = touchEvent(100, 100, {
      id: 2,
      others: [{ id: 1, x: WIDTH - 10, y: 300 }],
    });
    detector.onTouchStart(second);
    expect(isTouchStartClaimedByEdgeSwipe(second)).toBeTrue();
    move(WIDTH - 60);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores a touchend of another finger', () => {
    start();
    detector.onTouchEnd(touchEvent(100, 100, { id: 2 }));
    move(WIDTH - 60);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('starts fresh after touchend', () => {
    start();
    move(WIDTH - 20);
    detector.onTouchEnd(touchEvent(WIDTH - 20, 300));
    move(WIDTH - 100);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('starts fresh after touchcancel', () => {
    start();
    detector.onTouchCancel();
    move(WIDTH - 100);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('isEdgeSwipeExcludedTarget', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('excludes overlays, the schedule pager and the planner calendar', () => {
    host.innerHTML = `
      <div class="cdk-overlay-container"><span id="a"></span></div>
      <swipe-pager><span id="b"></span></swipe-pager>
      <planner-calendar-nav><span id="c"></span></planner-calendar-nav>
      <div><span id="d"></span></div>`;
    expect(isEdgeSwipeExcludedTarget(host.querySelector('#a'))).toBeTrue();
    expect(isEdgeSwipeExcludedTarget(host.querySelector('#b'))).toBeTrue();
    expect(isEdgeSwipeExcludedTarget(host.querySelector('#c'))).toBeTrue();
    expect(isEdgeSwipeExcludedTarget(host.querySelector('#d'))).toBeFalse();
  });

  it('is false for a null target', () => {
    expect(isEdgeSwipeExcludedTarget(null)).toBeFalse();
  });
});

describe('isInHorizontalScroller', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('is true inside an element that scrolls horizontally', () => {
    host.innerHTML =
      '<div style="width:100px;overflow-x:auto"><div style="width:300px"><span>x</span></div></div>';
    expect(isInHorizontalScroller(host.querySelector('span'))).toBeTrue();
  });

  it('is false when the overflow container has nothing to scroll', () => {
    host.innerHTML =
      '<div style="width:100px;overflow-x:auto"><div style="width:50px"><span>x</span></div></div>';
    expect(isInHorizontalScroller(host.querySelector('span'))).toBeFalse();
  });
});
