import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SwipePagerComponent, SwipePagerPageDirective } from './swipe-pager.component';
import { MAX_CLAIM_DELAY_MS } from './swipe-pager-gesture';
import { BodyClass } from '../../app.constants';

@Component({
  standalone: true,
  imports: [SwipePagerComponent, SwipePagerPageDirective],
  template: `
    <swipe-pager
      style="width: 400px"
      [prev]="current() > min() ? current() - 1 : null"
      [current]="current()"
      [next]="current() + 1"
      [isEnabled]="isEnabled()"
      [(isWarm)]="isWarm"
      (navigate)="onNavigate($event)"
    >
      <ng-template
        [swipePagerPage]="current()"
        let-page
        let-isCurrent="isCurrent"
      >
        <div
          class="test-page"
          [attr.data-page]="page"
          [class.isCurrent]="isCurrent"
        >
          <button class="next-btn">{{ page }}</button>
        </div>
      </ng-template>
    </swipe-pager>
  `,
})
class HostComponent {
  readonly pager = viewChild.required(SwipePagerComponent<number>);
  readonly current = signal(5);
  readonly min = signal(0);
  readonly isEnabled = signal(true);
  readonly isWarm = signal(false);
  readonly navigations: number[] = [];

  onNavigate(page: number): void {
    this.navigations.push(page);
    this.current.set(page);
  }
}

interface TouchPoint {
  x: number;
  y?: number;
  id?: number;
}

/**
 * Event time of touches fired without an explicit `timeStamp`. The pager reads
 * gesture timing (long-press delay, velocity) from event timestamps, so a
 * real clock lets a slow runner turn a pan into a long press.
 */
let eventTime = 0;

const fireTouch = (
  el: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend',
  points: TouchPoint | TouchPoint[],
  timeStamp = eventTime,
): TouchEvent => {
  const touches = (Array.isArray(points) ? points : [points]).map(
    (p) =>
      new Touch({
        identifier: p.id ?? 1,
        target: el,
        clientX: p.x,
        clientY: p.y ?? 100,
      }),
  );
  const ev = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === 'touchend' ? [] : touches,
    changedTouches: touches,
  });
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  el.dispatchEvent(ev);
  return ev;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('SwipePagerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let pagerEl: HTMLElement;
  let isReducedMotion: boolean;

  const pageNumbers = (): string[] =>
    Array.from(
      pagerEl.querySelectorAll<HTMLElement>('.test-page'),
      (el) => el.dataset.page ?? '',
    );
  const currentPage = (): string | undefined =>
    pagerEl.querySelector<HTMLElement>('.test-page.isCurrent')?.dataset.page;
  const trackTransform = (): string =>
    pagerEl.querySelector<HTMLElement>('.track')!.style.transform;

  /** Starts a touch, lets the neighbours render, then moves horizontally. */
  const pan = async (deltaX: number, deltaY = 0): Promise<void> => {
    fireTouch(pagerEl, 'touchstart', { x: 200 });
    await fixture.whenStable();
    // Past the claim threshold first, so the pan follows from there.
    const claimX = Math.sign(deltaX) * 20;
    eventTime += 16;
    fireTouch(pagerEl, 'touchmove', { x: 200 + claimX, y: 100 + deltaY });
    eventTime += 16;
    fireTouch(pagerEl, 'touchmove', { x: 200 + deltaX, y: 100 + deltaY });
  };

  beforeEach(async () => {
    eventTime = 1000;
    isReducedMotion = true;
    // Reduced motion: the pager settles synchronously unless a test opts out.
    spyOn(window, 'matchMedia').and.callFake(
      () => ({ matches: isReducedMotion }) as MediaQueryList,
    );
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
    pagerEl = fixture.nativeElement.querySelector('swipe-pager');
  });

  afterEach(() => {
    document.body.classList.remove(BodyClass.isDisableAnimations);
    fixture.destroy();
  });

  it('renders only the current page until touched', async () => {
    expect(pageNumbers()).toEqual(['5']);

    fireTouch(pagerEl, 'touchstart', { x: 200 });
    await fixture.whenStable();

    expect(host.isWarm()).toBeTrue();
    expect(pageNumbers()).toEqual(['4', '5', '6']);
    const neighbours = pagerEl.querySelectorAll<HTMLElement>('.page[inert]');
    expect(neighbours.length).toBe(2);
  });

  it('pages to the next page after a long enough pan', async () => {
    await pan(-150);
    expect(trackTransform()).toContain('-130px');

    fireTouch(pagerEl, 'touchend', { x: 50 });
    await fixture.whenStable();

    expect(host.navigations).toEqual([6]);
    expect(currentPage()).toBe('6');
    expect(trackTransform()).toBe('');
  });

  it('pages back after a pan to the right', async () => {
    await pan(150);
    fireTouch(pagerEl, 'touchend', { x: 350 });
    await fixture.whenStable();

    expect(host.navigations).toEqual([4]);
    expect(currentPage()).toBe('4');
  });

  it('snaps back after a short, slow pan', async () => {
    await pan(-60);
    // Hold still past the velocity window, so the release is not a fling.
    eventTime += 150;
    fireTouch(pagerEl, 'touchmove', { x: 140 });
    fireTouch(pagerEl, 'touchend', { x: 140 });
    await fixture.whenStable();

    expect(host.navigations).toEqual([]);
    expect(trackTransform()).toBe('');
  });

  it('leaves vertical moves to scrolling', async () => {
    fireTouch(pagerEl, 'touchstart', { x: 200 });
    await fixture.whenStable();
    const move = fireTouch(pagerEl, 'touchmove', { x: 205, y: 160 });
    fireTouch(pagerEl, 'touchend', { x: 205, y: 160 });
    await fixture.whenStable();

    expect(move.defaultPrevented).toBeFalse();
    expect(trackTransform()).toBe('');
    expect(host.navigations).toEqual([]);
  });

  it('resists and never pages towards a missing page', async () => {
    host.min.set(5);
    await fixture.whenStable();

    await pan(200);
    expect(trackTransform()).toContain('45px');
    fireTouch(pagerEl, 'touchend', { x: 400 });
    await fixture.whenStable();

    expect(host.navigations).toEqual([]);
  });

  it('leaves a move after a long press to drag and drop', async () => {
    const start = performance.now();
    fireTouch(pagerEl, 'touchstart', { x: 200 }, start);
    await fixture.whenStable();
    const move = fireTouch(
      pagerEl,
      'touchmove',
      { x: 50 },
      start + MAX_CLAIM_DELAY_MS + 50,
    );
    fireTouch(pagerEl, 'touchend', { x: 50 }, start + MAX_CLAIM_DELAY_MS + 60);
    await fixture.whenStable();

    expect(move.defaultPrevented).toBeFalse();
    expect(trackTransform()).toBe('');
    expect(host.navigations).toEqual([]);
  });

  it('measures the long-press delay from event times, not from when handled', async () => {
    // A janky main thread delivers the moves late; their own timestamps are early.
    const lateBy = MAX_CLAIM_DELAY_MS * 2;
    const start = performance.now() - lateBy;
    fireTouch(pagerEl, 'touchstart', { x: 200 }, start);
    await fixture.whenStable();
    fireTouch(pagerEl, 'touchmove', { x: 180 }, start + 50);
    fireTouch(pagerEl, 'touchmove', { x: 50 }, start + 100);
    fireTouch(pagerEl, 'touchend', { x: 50 }, start + 110);
    await fixture.whenStable();

    expect(host.navigations).toEqual([6]);
  });

  it('does not pan while disabled', async () => {
    host.isEnabled.set(false);
    await fixture.whenStable();

    await pan(-150);
    fireTouch(pagerEl, 'touchend', { x: 50 });
    await fixture.whenStable();

    expect(host.navigations).toEqual([]);
    expect(host.isWarm()).toBeFalse();
  });

  it('lets go of the page when disabled mid-pan', async () => {
    await pan(-150);
    host.isEnabled.set(false);
    await fixture.whenStable();
    fireTouch(pagerEl, 'touchmove', { x: 40 });
    fireTouch(pagerEl, 'touchend', { x: 40 });
    await fixture.whenStable();

    expect(host.navigations).toEqual([]);
    expect(trackTransform()).toBe('');
  });

  it('a second finger ends the pan without paging', async () => {
    await pan(-150);
    fireTouch(pagerEl, 'touchstart', [{ x: 50 }, { x: 300, id: 2 }]);
    fireTouch(pagerEl, 'touchend', [{ x: 50 }]);
    await fixture.whenStable();

    expect(host.navigations).toEqual([]);
    expect(trackTransform()).toBe('');

    // A fresh pan works normally afterwards.
    await pan(-150);
    fireTouch(pagerEl, 'touchend', { x: 50 });
    await fixture.whenStable();
    expect(host.navigations).toEqual([6]);
  });

  it('go() renders the neighbour first and then pages to it', async () => {
    host.pager().go(1);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(host.isWarm()).toBeTrue();
    expect(host.navigations).toEqual([6]);
    expect(currentPage()).toBe('6');
  });

  it('go() does nothing towards a missing page', async () => {
    host.min.set(5);
    await fixture.whenStable();

    host.pager().go(-1);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(host.navigations).toEqual([]);
  });

  it('keeps focus on the matching control of the new page', async () => {
    host.isWarm.set(true);
    await fixture.whenStable();
    pagerEl.querySelector<HTMLElement>('.test-page.isCurrent .next-btn')!.focus();

    host.pager().go(1);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(currentPage()).toBe('6');
    expect(document.activeElement?.textContent?.trim()).toBe('6');
  });

  it('skips the animation when animations are disabled in the app', async () => {
    isReducedMotion = false;
    document.body.classList.add(BodyClass.isDisableAnimations);
    host.isWarm.set(true);
    await fixture.whenStable();

    host.pager().go(1);
    await fixture.whenStable();

    expect(host.navigations).toEqual([6]);
  });

  describe('with animations', () => {
    /**
     * Ends the running settle as the browser does. Waiting out the transition
     * in real time instead made a slow runner hit the 2s spec timeout.
     */
    const endTransition = async (): Promise<void> => {
      pagerEl
        .querySelector<HTMLElement>('.track')!
        .dispatchEvent(
          new TransitionEvent('transitionend', { propertyName: 'transform' }),
        );
      await fixture.whenStable();
    };

    beforeEach(async () => {
      isReducedMotion = false;
      host.isWarm.set(true);
      await fixture.whenStable();
    });

    it('animates, then pages and resets the track', async () => {
      host.pager().go(1);
      expect(trackTransform()).toContain('-400px');
      expect(host.navigations).toEqual([]);

      await endTransition();

      expect(host.navigations).toEqual([6]);
      expect(trackTransform()).toBe('');
    });

    it('finishes the settle when transitionend never fires', async () => {
      // Registered before the pager's own listener: swallows the browser's real
      // transitionend, so only the fallback timer can finish the settle.
      pagerEl
        .querySelector<HTMLElement>('.track')!
        .addEventListener('transitionend', (ev) => ev.stopImmediatePropagation());
      host.pager().go(1);

      await wait(400);
      await fixture.whenStable();

      expect(host.navigations).toEqual([6]);
      expect(trackTransform()).toBe('');
    });

    it('plays button presses made during the animation afterwards', async () => {
      host.pager().go(1);
      host.pager().go(1);
      host.pager().go(1);

      for (let i = 0; i < 3; i++) {
        await endTransition();
      }

      expect(host.navigations).toEqual([6, 7, 8]);
    });

    it('drops the animation when the host changes the page during it', async () => {
      host.pager().go(1);
      host.current.set(9);
      await fixture.whenStable();
      await endTransition();

      expect(host.navigations).toEqual([]);
      expect(currentPage()).toBe('9');
      expect(trackTransform()).toBe('');
    });

    it('ignores a new touch until a settle has finished', async () => {
      await pan(-150);
      fireTouch(pagerEl, 'touchend', { x: 50 });
      // Immediately start another pan while the first one settles.
      await pan(-150);
      fireTouch(pagerEl, 'touchend', { x: 50 });

      await endTransition();

      expect(host.navigations).toEqual([6]);
      expect(trackTransform()).toBe('');
    });
  });
});
