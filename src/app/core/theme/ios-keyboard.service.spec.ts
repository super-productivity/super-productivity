import {
  ApplicationRef,
  EnvironmentInjector,
  signal,
  WritableSignal,
} from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { KeyboardInfo, KeyboardPlugin } from '@capacitor/keyboard';
import { PluginListenerHandle } from '@capacitor/core';
import { BodyClass } from '../../app.constants';
import { createOneShotSettle, OneShotSettle } from './ios-keyboard-settle.util';
import {
  IOS_KEYBOARD_RESIZE_GRACE_MS,
  IOS_KEYBOARD_SETTLE_FALLBACK_MS,
  IosKeyboardService,
} from './ios-keyboard.service';

describe('IosKeyboardService sequencing', () => {
  /**
   * Mirrors the service's private fields for an Object.create harness (field
   * initializers do not run there). A field added to the service and not here
   * is silently `undefined` in these tests.
   */
  interface IosKeyboardHarness {
    init(keyboard: KeyboardPlugin): void;
    _document: Document;
    _destroyRef: { onDestroy(cb: () => void): void };
    _keyboardListenerHandles: PluginListenerHandle[];
    _focusinListener: ((event: FocusEvent) => void) | null;
    _visualViewportResizeListener: (() => void) | null;
    _keyboardHeight: number;
    _viewportHeightBeforeKeyboard: number;
    _viewportChangeRaf: number | null;
    _keyboardFrameUnreliable: boolean;
    _isKeyboardSettled: boolean;
    _cssVarCache: Map<string, string>;
    _overlayContainer: { getContainerElement(): HTMLElement };
    _overlayVarTarget: HTMLElement;
    _showSettle: OneShotSettle;
    _hideSettle: OneShotSettle;
    _resizeGrace: OneShotSettle;
    shellHeight: WritableSignal<string | null>;
    keyboardOverlayOffset: WritableSignal<string | null>;
    _scrollActiveInputIntoView(): void;
    _environmentInjector: EnvironmentInjector;
  }

  type KeyboardHandler = (info: KeyboardInfo) => void;

  const BASE_HEIGHT = 800;
  const SETTLE_FALLBACK_MS = IOS_KEYBOARD_SETTLE_FALLBACK_MS;
  const RESIZE_GRACE_MS = IOS_KEYBOARD_RESIZE_GRACE_MS;
  const KEYBOARD_HEIGHT = 336;

  let harness: IosKeyboardHarness;
  let root: HTMLElement;
  let body: HTMLElement;
  let overlayContainer: HTMLElement;
  let handlers: Record<string, KeyboardHandler>;
  let visualViewport: { height: number; addEventListener: jasmine.Spy };
  let rootSetPropertySpy: jasmine.Spy;
  let overlaySetPropertySpy: jasmine.Spy;
  let resizeNotifications: number;
  let scrollIntoViewSpy: jasmine.Spy;
  let pendingFrame: FrameRequestCallback | null = null;
  let originalInnerHeight: PropertyDescriptor | undefined;
  let originalVisualViewport: PropertyDescriptor | undefined;

  /** Stubs the window geometry the service reads; restored in afterEach. */
  const setWindowHeights = (innerHeight: number, visualViewportHeight: number): void => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      get: () => innerHeight,
    });
    visualViewport.height = visualViewportHeight;
  };

  /** Set on the CDK overlay container, which every overlay inherits from. */
  const overlayVar = (name: string): string =>
    overlayContainer.style.getPropertyValue(name);

  const flushFrame = (): void => {
    const frame = pendingFrame;
    pendingFrame = null;
    frame?.(0);
  };

  const varWrites = (spy: jasmine.Spy, name: string): number =>
    spy.calls.allArgs().filter((args) => args[0] === name).length;

  /** The keyboard shrank the web view, i.e. Capacitor's `resize: 'native'`. */
  const shrinkViewport = (height: number): void => {
    visualViewport.height = height;
    harness._visualViewportResizeListener?.();
  };

  beforeEach(() => {
    root = document.createElement('div');
    body = document.createElement('div');
    overlayContainer = document.createElement('div');
    handlers = {};
    resizeNotifications = 0;
    scrollIntoViewSpy = jasmine.createSpy('_scrollActiveInputIntoView');
    rootSetPropertySpy = spyOn(root.style, 'setProperty').and.callThrough();
    overlaySetPropertySpy = spyOn(
      overlayContainer.style,
      'setProperty',
    ).and.callThrough();

    visualViewport = {
      height: BASE_HEIGHT,
      addEventListener: jasmine.createSpy('addEventListener'),
    };
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get: () => visualViewport,
    });
    setWindowHeights(BASE_HEIGHT, BASE_HEIGHT);

    // Hold the frame callback like the browser does — the service coalesces
    // notifications until it runs — and count the resize instead of dispatching
    // it, which would reach every listener in the karma page.
    spyOn(window, 'requestAnimationFrame').and.callFake((cb) => {
      pendingFrame = cb;
      return 1;
    });
    spyOn(window, 'dispatchEvent').and.callFake((event: Event) => {
      if (event.type === 'resize') {
        resizeNotifications++;
      }
      return true;
    });

    harness = Object.create(IosKeyboardService.prototype) as IosKeyboardHarness;
    harness._document = {
      documentElement: root,
      body,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as Document;
    harness._overlayContainer = { getContainerElement: () => overlayContainer };
    harness.shellHeight = signal<string | null>(null);
    harness.keyboardOverlayOffset = signal<string | null>(null);
    harness._destroyRef = { onDestroy: () => undefined };
    harness._keyboardListenerHandles = [];
    harness._focusinListener = null;
    harness._visualViewportResizeListener = null;
    harness._keyboardHeight = 0;
    harness._viewportHeightBeforeKeyboard = 0;
    harness._viewportChangeRaf = null;
    harness._keyboardFrameUnreliable = false;
    harness._isKeyboardSettled = false;
    harness._cssVarCache = new Map<string, string>();
    // Field initializers do not run on an Object.create harness.
    harness._showSettle = createOneShotSettle(SETTLE_FALLBACK_MS);
    harness._hideSettle = createOneShotSettle(SETTLE_FALLBACK_MS);
    harness._resizeGrace = createOneShotSettle(RESIZE_GRACE_MS);
    harness._scrollActiveInputIntoView = scrollIntoViewSpy;
    harness._environmentInjector = TestBed.inject(EnvironmentInjector);

    const keyboard = {
      setAccessoryBarVisible: () => Promise.resolve(),
      addListener: (eventName: string, listenerFunc: KeyboardHandler) => {
        handlers[eventName] = listenerFunc;
        return Promise.resolve({ remove: () => Promise.resolve() });
      },
    } as unknown as KeyboardPlugin;
    harness.init(keyboard);
    flushFrame();
    rootSetPropertySpy.calls.reset();
    overlaySetPropertySpy.calls.reset();
    resizeNotifications = 0;
  });

  afterEach(() => {
    const restore = (name: string, descriptor?: PropertyDescriptor): void => {
      if (descriptor) {
        Object.defineProperty(window, name, descriptor);
      } else {
        delete (window as unknown as Record<string, unknown>)[name];
      }
    };
    restore('innerHeight', originalInnerHeight);
    restore('visualViewport', originalVisualViewport);
  });

  const willShow = (keyboardHeight = KEYBOARD_HEIGHT): void =>
    handlers['keyboardWillShow']({ keyboardHeight } as KeyboardInfo);
  const didShow = (): void => handlers['keyboardDidShow']({} as KeyboardInfo);
  const didHide = (): void => handlers['keyboardDidHide']({} as KeyboardInfo);
  /** Runs the render pass the deferred scroll waits for. */
  const flushRender = (): void => TestBed.inject(ApplicationRef).tick();
  const willHide = (): void => handlers['keyboardWillHide']({} as KeyboardInfo);

  it('registers a listener per keyboard event', () => {
    expect(Object.keys(handlers).sort()).toEqual([
      'keyboardDidHide',
      'keyboardDidShow',
      'keyboardWillHide',
      'keyboardWillShow',
    ]);
  });

  // #9779: the reported frame arrives before the web view has resized, so acting
  // on it here lifts the fixed add-task bar a keyboard height and drops it back
  // a few frames later — the jump users see.
  it('does not move anything on the reported frame alone', () => {
    willShow();

    expect(body.classList.contains(BodyClass.isKeyboardVisible)).toBe(true);
    expect(overlayVar('--keyboard-height')).toBe(`${KEYBOARD_HEIGHT}px`);
    expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
    expect(overlayVar('--visual-viewport-height')).toBe(`${BASE_HEIGHT}px`);
    expect(harness.keyboardOverlayOffset()).toBe('0px');
    expect(harness.shellHeight()).toBe(`calc(${BASE_HEIGHT}px - var(--safe-area-top))`);
  });

  it('follows the web view once it shrinks around the keyboard', () => {
    willShow();
    shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);
    didShow();

    expect(overlayVar('--visual-viewport-height')).toBe(
      `${BASE_HEIGHT - KEYBOARD_HEIGHT}px`,
    );
    expect(harness.shellHeight()).toBe(
      `calc(${BASE_HEIGHT - KEYBOARD_HEIGHT}px - var(--safe-area-top))`,
    );
    // The shrunken web view already ends above the keyboard; offsetting the
    // fixed bar again would move it twice (#8778).
    expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
    expect(harness.keyboardOverlayOffset()).toBe('0px');
    flushRender();
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  // The shell height is a signal binding, so at didShow the shell is still its
  // pre-keyboard size. Scrolling there measures the old viewport, decides the
  // input is already visible, and leaves it under the keyboard (#9779).
  it('waits for the shell to be resized before scrolling the input into view', () => {
    willShow();
    shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);
    didShow();

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    flushRender();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  // Capacitor's `resize: 'native'` shrinks the web view on a timer set to the
  // animation duration plus 200ms, i.e. ~200ms AFTER keyboardDidShow. Acting on
  // the reported frame at didShow lifted the bar by a keyboard height and the
  // late resize dropped it back — the residual jump of #9779, at the cost of
  // two document-wide restyles.
  it('holds the frame-derived offset for a web view that shrinks after didShow', fakeAsync(() => {
    willShow();
    didShow();

    expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
    expect(harness.keyboardOverlayOffset()).toBe('0px');
    expect(harness.shellHeight()).toBe(`calc(${BASE_HEIGHT}px - var(--safe-area-top))`);

    tick(RESIZE_GRACE_MS / 2);
    shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);
    tick(RESIZE_GRACE_MS);
    flushRender();

    expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
    expect(varWrites(overlaySetPropertySpy, '--keyboard-overlay-offset')).toBe(0);
    expect(harness.shellHeight()).toBe(
      `calc(${BASE_HEIGHT - KEYBOARD_HEIGHT}px - var(--safe-area-top))`,
    );
    // Settled by the resize itself, not the grace timer: one scroll, once the
    // shell has the final size.
    expect(harness._isKeyboardSettled).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  }));

  it('offsets the overlay layer for a keyboard that never resized the web view', fakeAsync(() => {
    willShow();
    didShow();
    tick(RESIZE_GRACE_MS);

    expect(overlayVar('--keyboard-overlay-offset')).toBe(`${KEYBOARD_HEIGHT}px`);
    expect(harness.keyboardOverlayOffset()).toBe(`${KEYBOARD_HEIGHT}px`);
    expect(overlayVar('--visual-viewport-height')).toBe(
      `${BASE_HEIGHT - KEYBOARD_HEIGHT}px`,
    );
    flushRender();
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  }));

  // Switching to the emoji panel or a taller keyboard re-fires willShow while the
  // keyboard is already up. Nothing is appearing from zero here, so dropping the
  // offset until didShow arrives would flick the bar down behind the keyboard.
  it('keeps the overlay offset when the keyboard changes height while visible', fakeAsync(() => {
    willShow();
    didShow();
    tick(RESIZE_GRACE_MS);

    willShow(KEYBOARD_HEIGHT + 100);

    expect(overlayVar('--keyboard-overlay-offset')).toBe(`${KEYBOARD_HEIGHT + 100}px`);
    expect(overlayVar('--visual-viewport-height')).toBe(
      `${BASE_HEIGHT - KEYBOARD_HEIGHT - 100}px`,
    );
  }));

  it('measures the pre-keyboard height only while the keyboard is hidden', () => {
    willShow();
    // iOS reports the shrunken window once the keyboard is up; re-capturing it
    // as the base height would subtract the keyboard twice.
    setWindowHeights(BASE_HEIGHT - KEYBOARD_HEIGHT, BASE_HEIGHT - KEYBOARD_HEIGHT);
    willShow();
    didShow();

    expect(harness._viewportHeightBeforeKeyboard).toBe(BASE_HEIGHT);
    expect(overlayVar('--visual-viewport-height')).toBe(
      `${BASE_HEIGHT - KEYBOARD_HEIGHT}px`,
    );
  });

  it('restores the full viewport when the keyboard hides', () => {
    willShow();
    shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);
    didShow();

    willHide();
    shrinkViewport(BASE_HEIGHT);

    expect(body.classList.contains(BodyClass.isKeyboardVisible)).toBe(false);
    expect(overlayVar('--keyboard-height')).toBe('0px');
    expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
    expect(overlayVar('--visual-viewport-height')).toBe(`${BASE_HEIGHT}px`);
    // Handed back to the stylesheet, which sizes the shell and the bar without
    // a keyboard.
    expect(harness.shellHeight()).toBeNull();
    expect(harness.keyboardOverlayOffset()).toBeNull();
  });

  // The show animation fires a burst of visualViewport resizes, most of them on
  // a height already written. Each write costs a style recalc of the overlay
  // layer and each notification re-measures every autosizing textarea and CDK
  // overlay.
  it('writes and notifies only for values that actually changed', () => {
    willShow();
    flushFrame();
    const writesAfterShow = varWrites(overlaySetPropertySpy, '--visual-viewport-height');
    const notificationsAfterShow = resizeNotifications;

    for (let i = 0; i < 3; i++) {
      shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);
      flushFrame();
    }

    expect(varWrites(overlaySetPropertySpy, '--visual-viewport-height')).toBe(
      writesAfterShow + 1,
    );
    expect(resizeNotifications).toBe(notificationsAfterShow + 1);
  });

  it('corrects a bogus keyboard frame to the measured obscured area (#8778)', () => {
    willShow(BASE_HEIGHT - 10);
    shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);

    // Mid-shrink the clamped frame stands: the obscured area moves every frame,
    // and nothing needs the corrected value before the keyboard is up.
    expect(overlayVar('--keyboard-height')).toBe(`${BASE_HEIGHT * 0.6}px`);

    didShow();

    expect(overlayVar('--keyboard-height')).toBe(`${KEYBOARD_HEIGHT}px`);
    expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
  });

  it('does not rewrite the keyboard height per frame for a bogus frame either', () => {
    willShow(BASE_HEIGHT - 10);
    const writesAfterShow = varWrites(overlaySetPropertySpy, '--keyboard-height');

    for (let step = 60; step <= 300; step += 60) {
      shrinkViewport(BASE_HEIGHT - step);
      flushFrame();
    }

    expect(varWrites(overlaySetPropertySpy, '--keyboard-height')).toBe(writesAfterShow);
  });

  describe('when iOS drops keyboardDidShow', () => {
    // Everything frame-derived waits for didShow, so without a fallback the
    // fixed bar stays behind the keyboard for the rest of the session (#9779).
    it('settles on a timer instead', fakeAsync(() => {
      willShow();

      expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');

      tick(SETTLE_FALLBACK_MS);
      // The keyboard counts as up now, but the web view still gets its grace.
      expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');

      tick(RESIZE_GRACE_MS);
      flushRender();

      expect(overlayVar('--keyboard-overlay-offset')).toBe(`${KEYBOARD_HEIGHT}px`);
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    }));

    // The common `resize: 'native'` case with a flaky didShow: the web view did
    // shrink, so the fallback must settle on the measurement, without a grace.
    it('settles on the measured resize without a grace when didShow is dropped', fakeAsync(() => {
      willShow();
      shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);
      tick(SETTLE_FALLBACK_MS);
      flushRender();

      expect(harness._isKeyboardSettled).toBe(true);
      expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    }));

    it('does not settle twice when didShow does arrive', fakeAsync(() => {
      willShow();
      shrinkViewport(BASE_HEIGHT - KEYBOARD_HEIGHT);
      didShow();
      flushRender();
      tick(SETTLE_FALLBACK_MS + RESIZE_GRACE_MS);
      flushRender();

      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    }));

    it('drops the pending timer when the keyboard hides again', fakeAsync(() => {
      willShow();
      willHide();
      tick(SETTLE_FALLBACK_MS + RESIZE_GRACE_MS);
      flushRender();

      expect(harness._isKeyboardSettled).toBe(false);
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    }));
  });

  // A tap outside during the grace period: the keyboard is already on its way
  // out, so the frame-derived offset must not land on the bar behind it.
  it('drops the pending resize grace when the keyboard hides again', fakeAsync(() => {
    willShow();
    didShow();
    willHide();
    tick(RESIZE_GRACE_MS);
    flushRender();

    expect(overlayVar('--keyboard-overlay-offset')).toBe('0px');
    expect(harness._isKeyboardSettled).toBe(false);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  }));

  // Moving between two fields fires willHide then willShow while the web view is
  // still shrunken; re-measuring there subtracts the keyboard twice.
  it('keeps the pre-keyboard baseline when focus moves to another field', () => {
    willShow();
    didShow();
    willHide();
    // The web view has not grown back yet — this is what iOS reports meanwhile.
    setWindowHeights(BASE_HEIGHT - KEYBOARD_HEIGHT, BASE_HEIGHT - KEYBOARD_HEIGHT);
    willShow();
    didShow();

    // Re-measuring at the second willShow would clamp the keyboard against the
    // already-shrunken 464px and shrink the shell to 185.6px.
    expect(overlayVar('--keyboard-height')).toBe(`${KEYBOARD_HEIGHT}px`);
    expect(harness.shellHeight()).toBe(
      `calc(${BASE_HEIGHT - KEYBOARD_HEIGHT}px - var(--safe-area-top))`,
    );
  });

  // The mirror of the didShow fallback: without it a single dropped didHide
  // would strand a stale baseline for the rest of the session.
  it('takes a fresh baseline on the timer when keyboardDidHide is dropped', fakeAsync(() => {
    willShow();
    didShow();
    willHide();
    tick(SETTLE_FALLBACK_MS);
    setWindowHeights(600, 600);
    willShow();
    didShow();
    tick(RESIZE_GRACE_MS);
    flushRender();

    expect(harness.shellHeight()).toBe(
      `calc(${600 - KEYBOARD_HEIGHT}px - var(--safe-area-top))`,
    );
  }));

  it('does not scroll twice when didShow arrives after the fallback fired', fakeAsync(() => {
    willShow();
    tick(SETTLE_FALLBACK_MS + RESIZE_GRACE_MS);
    flushRender();

    didShow();
    flushRender();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  }));

  // A focus move between two fields: the willHide baseline reset must not fire
  // behind the keyboard that is already coming back.
  it('drops the pending baseline reset when focus moves to another field', fakeAsync(() => {
    willShow();
    didShow();
    willHide();
    setWindowHeights(BASE_HEIGHT - KEYBOARD_HEIGHT, BASE_HEIGHT - KEYBOARD_HEIGHT);
    willShow();
    tick(SETTLE_FALLBACK_MS);
    didShow();
    flushRender();

    expect(overlayVar('--keyboard-height')).toBe(`${KEYBOARD_HEIGHT}px`);
    expect(harness.shellHeight()).toBe(
      `calc(${BASE_HEIGHT - KEYBOARD_HEIGHT}px - var(--safe-area-top))`,
    );
  }));

  it('takes a fresh baseline once the web view has grown back', () => {
    willShow();
    didShow();
    willHide();
    didHide();
    // A rotation while the keyboard was down: the old baseline must not survive.
    setWindowHeights(600, 600);
    willShow();
    shrinkViewport(600 - KEYBOARD_HEIGHT);
    didShow();

    expect(harness.shellHeight()).toBe(
      `calc(${600 - KEYBOARD_HEIGHT}px - var(--safe-area-top))`,
    );
  });

  // The point of the split: a custom property on <html> is inherited by every
  // element, and WebKit restyles all of them on a write — the whole task list,
  // several times per keyboard open (#9779). So <html> gets nothing at all.
  it('never writes a CSS variable on <html>', () => {
    willShow();
    for (let step = 60; step <= 300; step += 60) {
      shrinkViewport(BASE_HEIGHT - step);
      flushFrame();
    }
    didShow();
    willHide();
    shrinkViewport(BASE_HEIGHT);

    expect(rootSetPropertySpy).not.toHaveBeenCalled();
    // One per distinct height: the five shrinks plus the restore on hide.
    expect(varWrites(overlaySetPropertySpy, '--visual-viewport-height')).toBe(6);
    expect(varWrites(overlaySetPropertySpy, '--keyboard-height')).toBe(2);
  });
});

/**
 * The guard on `_scrollActiveInputIntoView`, which runs once per iOS keyboard
 * open. Real elements in the document, because the decision reads computed
 * styles and scroll geometry.
 */
describe('IosKeyboardService scroll-into-view guard', () => {
  interface ScrollGuardHarness {
    _document: Document;
    _canScrollIntoView(el: HTMLElement): boolean;
    _scrollActiveInputIntoView(): void;
  }

  let harness: ScrollGuardHarness;
  let root: HTMLElement;

  const build = (html: string): HTMLElement => {
    root.innerHTML = html;
    return root.querySelector('input') as HTMLElement;
  };

  /**
   * Focuses the input for real and stubs the scroll call on it, so the assertion
   * covers `_scrollActiveInputIntoView` end to end rather than the predicate
   * alone — deleting the guard's call site has to fail a test.
   */
  const focusAndWatch = (input: HTMLElement): jasmine.Spy => {
    const spy = jasmine.createSpy('scrollIntoViewIfNeeded');
    // An own property, so the branch is taken on any browser karma runs in.
    (input as unknown as Record<string, unknown>).scrollIntoViewIfNeeded = spy;
    input.focus();
    expect(document.activeElement).toBe(input);
    return spy;
  };

  beforeEach(() => {
    harness = Object.create(IosKeyboardService.prototype) as ScrollGuardHarness;
    harness._document = document;
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => root.remove());

  it('scrolls an input that sits in a scrollable container', () => {
    const input = build(`
      <div style="height: 40px; overflow-y: auto">
        <div style="height: 400px"><input /></div>
      </div>
    `);

    expect(harness._canScrollIntoView(input)).toBe(true);
  });

  // The global add-task bar: scrolling it into view scrolls the list behind it
  // instead, which is what made the page jump while the keyboard opened (#9779).
  it('leaves an input in a fixed bar alone', () => {
    const input = build(`
      <div style="position: fixed; bottom: 0"><input /></div>
    `);

    expect(harness._canScrollIntoView(input)).toBe(false);
  });

  // #7388: a fullscreen dialog is fixed, but its body scrolls, so an input near
  // the bottom still has to be brought above the keyboard.
  it('scrolls an input in a scrollable region inside a fixed dialog', () => {
    const input = build(`
      <div style="position: fixed; inset: 0">
        <div style="height: 40px; overflow-y: auto">
          <div style="height: 400px"><input /></div>
        </div>
      </div>
    `);

    expect(harness._canScrollIntoView(input)).toBe(true);
  });

  it('scrolls an input with nothing special above it', () => {
    const input = build('<div><input /></div>');

    expect(harness._canScrollIntoView(input)).toBe(true);
  });

  describe('applied to the focused input', () => {
    it('does not scroll for an input in a fixed bar', () => {
      const spy = focusAndWatch(
        build('<div style="position: fixed; bottom: 0"><input /></div>'),
      );

      harness._scrollActiveInputIntoView();

      expect(spy).not.toHaveBeenCalled();
    });

    it('scrolls for an input inside a scrollable container', () => {
      const spy = focusAndWatch(
        build(`
          <div style="height: 40px; overflow-y: auto">
            <div style="height: 400px"><input /></div>
          </div>
        `),
      );

      harness._scrollActiveInputIntoView();

      expect(spy).toHaveBeenCalledWith(true);
    });
  });
});
