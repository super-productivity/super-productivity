import {
  EDGE_SWIPE_OPEN_DISTANCE_PX,
  EDGE_SWIPE_ZONE_PX,
  EdgeSwipeOpenDetector,
  isInHorizontalScroller,
} from './edge-swipe-open';

const WIDTH = 400;

interface FakeTouchEvent {
  ev: TouchEvent;
  stopPropagation: jasmine.Spy;
}

const touchEvent = (
  x: number,
  y: number,
  opts: { id?: number; touchCount?: number; target?: EventTarget | null } = {},
): FakeTouchEvent => {
  const touch = { identifier: opts.id ?? 1, clientX: x, clientY: y } as Touch;
  const list = [touch] as unknown as TouchList;
  const touches = (
    opts.touchCount && opts.touchCount > 1
      ? Array.from({ length: opts.touchCount }, () => touch)
      : list
  ) as TouchList;
  const stopPropagation = jasmine.createSpy('stopPropagation');
  const ev = {
    touches,
    changedTouches: list,
    target: opts.target ?? null,
    stopPropagation,
  } as unknown as TouchEvent;
  return { ev, stopPropagation };
};

describe('EdgeSwipeOpenDetector', () => {
  let now: number;
  let onOpen: jasmine.Spy;
  let canStart: jasmine.Spy;
  let detector: EdgeSwipeOpenDetector;

  beforeEach(() => {
    now = 1000;
    onOpen = jasmine.createSpy('onOpen');
    canStart = jasmine.createSpy('canStart').and.returnValue(true);
    detector = new EdgeSwipeOpenDetector({
      getViewportWidth: () => WIDTH,
      canStart,
      onOpen,
      now: () => now,
    });
  });

  const start = (x = WIDTH - 5, y = 300): void =>
    detector.onTouchStart(touchEvent(x, y).ev);
  const move = (x: number, y = 300): FakeTouchEvent => {
    const e = touchEvent(x, y);
    detector.onTouchMove(e.ev);
    return e;
  };

  it('opens on a leftward swipe that starts in the right edge strip', () => {
    start();
    move(WIDTH - 20);
    expect(onOpen).not.toHaveBeenCalled();
    move(WIDTH - 5 - EDGE_SWIPE_OPEN_DISTANCE_PX);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('stops touchmove propagation while tracking, so the task below does not pan', () => {
    start();
    const first = move(WIDTH - 20);
    expect(first.stopPropagation).toHaveBeenCalled();
  });

  it('keeps the rest of the touch from the elements below after opening', () => {
    start();
    move(WIDTH - 60);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const later = move(WIDTH - 200);
    expect(later.stopPropagation).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores touches that start outside the edge strip', () => {
    start(WIDTH - EDGE_SWIPE_ZONE_PX - 1);
    const e = move(100);
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores touches canStart rejects', () => {
    canStart.and.returnValue(false);
    start();
    const e = move(WIDTH - 100);
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('releases a vertical scroll to the elements below', () => {
    start();
    move(WIDTH - 7, 320);
    const later = move(WIDTH - 100, 330);
    expect(later.stopPropagation).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('releases a touch held long enough to be a drag before moving', () => {
    start();
    now += 450;
    const e = move(WIDTH - 100);
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores multi-touch starts', () => {
    detector.onTouchStart(touchEvent(WIDTH - 5, 300, { touchCount: 2 }).ev);
    move(WIDTH - 100);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('starts fresh after touchend', () => {
    start();
    move(WIDTH - 20);
    detector.onTouchEnd(touchEvent(WIDTH - 20, 300).ev);
    const e = move(WIDTH - 100);
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
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
    expect(isInHorizontalScroller(host.querySelector('span'))).toBe(true);
  });

  it('is false when the overflow container has nothing to scroll', () => {
    host.innerHTML =
      '<div style="width:100px;overflow-x:auto"><div style="width:50px"><span>x</span></div></div>';
    expect(isInHorizontalScroller(host.querySelector('span'))).toBe(false);
  });

  it('is false for a null target', () => {
    expect(isInHorizontalScroller(null)).toBe(false);
  });
});
