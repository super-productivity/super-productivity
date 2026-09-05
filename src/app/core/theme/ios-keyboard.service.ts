import {
  afterNextRender,
  DestroyRef,
  EnvironmentInjector,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Keyboard, KeyboardInfo, KeyboardPlugin } from '@capacitor/keyboard';
import { PluginListenerHandle } from '@capacitor/core';
import { BodyClass } from '../../app.constants';
import { Log } from '../log';
import { sanitizeIosKeyboardHeight } from './sanitize-ios-keyboard-height.util';
import {
  computeIosKeyboardViewportVars,
  isVisualViewportResizedForKeyboard,
} from './ios-keyboard-viewport-vars.util';
import { createOneShotSettle } from './ios-keyboard-settle.util';

/**
 * How long to wait for a `keyboardDid…` event before acting as if it arrived.
 *
 * Comfortably longer than the keyboard animation, which iOS runs at ~250ms.
 * See `createOneShotSettle` for why neither half of the pair may be trusted.
 */
export const IOS_KEYBOARD_SETTLE_FALLBACK_MS = 400;

/**
 * How long after the keyboard has finished appearing to keep waiting for the
 * web view to shrink around it before concluding that it never will.
 *
 * Capacitor's `resize: 'native'` applies the frame shrink `animationDuration +
 * 200ms` after `keyboardWillShow` (`Keyboard.m`, `onKeyboardWillShow`), i.e.
 * ~200ms *after* `keyboardDidShow`; acting on the reported frame at didShow was
 * the residual jump of #9779. Twice that delay as margin.
 */
export const IOS_KEYBOARD_RESIZE_GRACE_MS = 400;

import {
  CSS_VAR_KEYBOARD_HEIGHT,
  CSS_VAR_KEYBOARD_OVERLAY_OFFSET,
  CSS_VAR_VISUAL_VIEWPORT_HEIGHT,
} from './keyboard-css-vars.const';

/**
 * iOS keyboard geometry → layout, for the Capacitor iOS build.
 *
 * Publishes what the fixed and overlay layers need to stay clear of the
 * keyboard — and never onto `<html>`. A custom property there is inherited by
 * every element, and WebKit restyles each of them on a write: measured at
 * ~390ms per write on a 200-task list, which is the "insane lag" of #9779. So:
 *
 * - the CDK overlay container carries `--visual-viewport-height`,
 *   `--keyboard-height` and `--keyboard-overlay-offset` for dialogs, bottom
 *   sheets and connected overlays (they all inherit from it);
 * - the global add-task bar, the one consumer outside that layer, binds
 *   `--keyboard-overlay-offset` on its own host from {@link keyboardOverlayOffset};
 * - the app shell takes a plain `height` from {@link shellHeight}.
 *
 * The `:root` defaults in `_css-variables.scss` stay at 0 / 100vh for
 * everything else. Android and mobile web are handled by
 * GlobalThemeService's VisualViewport tracker, which writes `--keyboard-height`
 * on `<html>` once per open (not per frame) and has no iOS-style resize race.
 */
@Injectable({ providedIn: 'root' })
export class IosKeyboardService {
  private readonly _document = inject<Document>(DOCUMENT);
  private readonly _overlayContainer = inject(OverlayContainer);
  private readonly _environmentInjector = inject(EnvironmentInjector);
  private readonly _destroyRef = inject(DestroyRef);

  private _keyboardListenerHandles: PluginListenerHandle[] = [];
  private _focusinListener: ((event: FocusEvent) => void) | null = null;
  private _visualViewportResizeListener: (() => void) | null = null;
  private _keyboardHeight = 0;
  private _viewportHeightBeforeKeyboard = 0;
  private _viewportChangeRaf: number | null = null;
  // True only when the plugin reported an implausible keyboard frame (the clamp
  // had to correct it). Gates the measured-viewport override so well-behaved
  // keyboards keep their exact pre-existing behaviour (#8778).
  private _keyboardFrameUnreliable = false;
  // False until the keyboard is fully up AND the web view has had its chance to
  // resize around it, so nothing frame-derived acts on a guess (#9779).
  private _isKeyboardSettled = false;
  // iOS drops the `did` half of its keyboard animation pairs, so neither the
  // settle nor the baseline reset may hang on one alone (#9779).
  private readonly _showSettle = createOneShotSettle(IOS_KEYBOARD_SETTLE_FALLBACK_MS);
  private readonly _hideSettle = createOneShotSettle(IOS_KEYBOARD_SETTLE_FALLBACK_MS);
  // The web view resize trails `keyboardDidShow`; see IOS_KEYBOARD_RESIZE_GRACE_MS.
  private readonly _resizeGrace = createOneShotSettle(IOS_KEYBOARD_RESIZE_GRACE_MS);
  // Last value written per CSS variable, so a repeated write (the keyboard
  // animation fires many identical visualViewport resizes) costs nothing.
  private readonly _cssVarCache = new Map<string, string>();
  // Where the CSS variables go; assigned in init() before the first update and
  // before any listener is registered. Definitely assigned rather than
  // nullable: a fallback to <html> here would be cached by _setCssVar and
  // silently suppress the later write to the real target, leaving dialogs on
  // the 100vh fallback for the session.
  private _overlayVarTarget!: HTMLElement;

  /**
   * Height for the app shell while the keyboard is open, as a CSS value, or
   * null to leave the sizing to the stylesheet. Bound by app.component rather
   * than published as a custom property: the shell wraps the whole task list,
   * and a variable it inherits costs a document-wide style recalc on every
   * frame of the keyboard animation (#9779).
   */
  readonly shellHeight = signal<string | null>(null);

  /**
   * `--keyboard-overlay-offset` for the global add-task bar, as a CSS value, or
   * null while the keyboard is hidden (the bar then inherits the `:root`
   * default). Bound on the bar's own host for the same reason as
   * {@link shellHeight}: the bar sits outside the overlay container, and the
   * only other element above it in the tree is `<html>`.
   */
  readonly keyboardOverlayOffset = signal<string | null>(null);

  /**
   * Start tracking the Capacitor Keyboard plugin. Adds/removes body classes and
   * publishes the layout values described on the class.
   */
  init(keyboard: KeyboardPlugin = Keyboard): void {
    // Hide the native iOS accessory bar (prev/next/Done) — no multi-field forms
    // benefit from it, and Done is redundant with the system dismiss gesture.
    keyboard.setAccessoryBarVisible({ isVisible: false });
    // Resolved up front (this creates the container if CDK has not yet needed
    // it) so a dialog opened while the keyboard is already up finds the
    // variables in place.
    this._overlayVarTarget = this._overlayContainer.getContainerElement();
    this._updateViewportVars();

    if (window.visualViewport) {
      this._visualViewportResizeListener = (): void => {
        this._updateViewportVars();
        // The web view has shrunk around the keyboard: nothing left to wait for.
        if (this._isViewportResizedForKeyboard()) {
          this._resizeGrace.run();
        }
      };
      window.visualViewport.addEventListener(
        'resize',
        this._visualViewportResizeListener,
        { passive: true },
      );
    }

    keyboard
      .addListener('keyboardWillShow', (info: KeyboardInfo) => {
        Log.log('iOS keyboard will show', info);
        // Switching to the emoji panel or a taller third-party keyboard re-fires
        // this while the keyboard is already up, and iOS then reports the already
        // shrunken window — keeping the first measurement is what stops the
        // keyboard being subtracted twice.
        const wasKeyboardVisible = this._document.body.classList.contains(
          BodyClass.isKeyboardVisible,
        );
        // The keyboard is coming back, so the pending baseline reset from the
        // willHide that preceded a focus move must not fire behind it.
        this._hideSettle.cancel();
        // Also skipped while a baseline is still held: willHide clears the body
        // class but not the baseline, so a focus move between two fields lands
        // here with the web view still shrunken. Only keyboardDidHide clears it.
        if (!wasKeyboardVisible && !this._viewportHeightBeforeKeyboard) {
          this._viewportHeightBeforeKeyboard = window.innerHeight;
        }
        // Some third-party keyboards (e.g. Sogou) report a bogus near-full-screen
        // keyboard frame here; clamp it so it can't fling the fixed add-task bar
        // to the top of the screen (#8778).
        const referenceHeight = this._viewportHeightBeforeKeyboard || window.innerHeight;
        const keyboardHeight = sanitizeIosKeyboardHeight(
          info.keyboardHeight,
          referenceHeight,
        );
        // Only a frame the clamp had to correct opts into the measured-viewport
        // override in _updateViewportVars; well-behaved keyboards keep the exact
        // pre-existing behaviour, so this cannot regress them.
        this._keyboardFrameUnreliable = keyboardHeight !== info.keyboardHeight;
        this._keyboardHeight = keyboardHeight;
        // The show animation is only starting — nothing about the web view's new
        // size is known yet, see computeIosKeyboardViewportVars. A keyboard that
        // is already up is not appearing from zero, though: unsettling it there
        // would drop the fixed bar behind the keyboard until didShow arrives.
        if (!wasKeyboardVisible) {
          this._isKeyboardSettled = false;
          this._resizeGrace.cancel();
          this._showSettle.arm(() => this._onKeyboardShown());
        }
        this._document.body.classList.add(BodyClass.isKeyboardVisible);
        this._setCssVar(CSS_VAR_KEYBOARD_HEIGHT, `${keyboardHeight}px`);
        this._updateViewportVars();
      })
      .then((handle) => this._keyboardListenerHandles.push(handle));

    keyboard
      .addListener('keyboardDidShow', () => this._showSettle.run())
      .then((handle) => this._keyboardListenerHandles.push(handle));

    keyboard
      .addListener('keyboardWillHide', () => {
        Log.log('iOS keyboard will hide');
        this._keyboardHeight = 0;
        this._keyboardFrameUnreliable = false;
        this._isKeyboardSettled = false;
        this._showSettle.cancel();
        this._resizeGrace.cancel();
        // _viewportHeightBeforeKeyboard deliberately survives this event: moving
        // focus between two fields fires willHide then willShow with the web
        // view still shrunken, and re-snapshotting window.innerHeight there
        // would subtract the keyboard a second time. It is cleared once the web
        // view is actually back to full size instead.
        this._hideSettle.arm(() => this._clearBaseline());
        this._document.body.classList.remove(BodyClass.isKeyboardVisible);
        // _updateViewportVars only touches this one when correcting a bogus frame,
        // so the reset is explicit; the overlay offset it recomputes to 0 itself.
        this._setCssVar(CSS_VAR_KEYBOARD_HEIGHT, '0px');
        this._updateViewportVars();
      })
      .then((handle) => this._keyboardListenerHandles.push(handle));

    keyboard
      .addListener('keyboardDidHide', () => this._hideSettle.run())
      .then((handle) => this._keyboardListenerHandles.push(handle));

    // Also handle focus changes while keyboard is already visible
    this._focusinListener = (event: FocusEvent): void => {
      const target = event.target as HTMLElement;
      if (
        this._document.body.classList.contains(BodyClass.isKeyboardVisible) &&
        this._isInputElement(target)
      ) {
        // Small delay to let CSS padding apply, validate element is still focused
        setTimeout(() => {
          if (this._document.activeElement === target) {
            this._scrollActiveInputIntoView();
          }
        }, 50);
      }
    };
    this._document.addEventListener('focusin', this._focusinListener, { passive: true });

    this._destroyRef.onDestroy(() => {
      this._keyboardListenerHandles.forEach((handle) => handle.remove());
      if (this._visualViewportResizeListener && window.visualViewport) {
        window.visualViewport.removeEventListener(
          'resize',
          this._visualViewportResizeListener,
        );
      }
      if (this._viewportChangeRaf !== null) {
        window.cancelAnimationFrame(this._viewportChangeRaf);
      }
      this._showSettle.cancel();
      this._hideSettle.cancel();
      this._resizeGrace.cancel();
      if (this._focusinListener) {
        this._document.removeEventListener('focusin', this._focusinListener);
      }
    });
  }

  /**
   * The web view has finished growing back, so the next `keyboardWillShow` can
   * take a fresh baseline — and must, in case the device rotated meanwhile.
   */
  private _clearBaseline(): void {
    this._viewportHeightBeforeKeyboard = 0;
    this._updateViewportVars();
  }

  /**
   * The keyboard is fully up. Reached from `keyboardDidShow` or, if iOS drops
   * it, from the fallback timer armed in `keyboardWillShow`.
   *
   * Whether the web view has resized around it is a separate question: under
   * `resize: 'native'` the shrink lands ~200ms after this point (see
   * IOS_KEYBOARD_RESIZE_GRACE_MS), so an unshrunk viewport here means "not
   * yet", not "never". Settle at once if it has, else give it the grace period
   * — the visualViewport listener settles early the moment it shrinks.
   */
  private _onKeyboardShown(): void {
    if (this._isViewportResizedForKeyboard()) {
      this._settle();
      return;
    }
    this._resizeGrace.arm(() => this._settle());
  }

  /**
   * Everything frame-derived can act now: the web view has either resized
   * around the keyboard or had its chance to.
   */
  private _settle(): void {
    this._isKeyboardSettled = true;
    this._updateViewportVars();
    // The shell height is a signal binding, so the shell is still at its
    // pre-keyboard height until change detection runs. Measuring here would find
    // the input comfortably inside a viewport that is about to shrink, and skip
    // the scroll that keeps it off the keyboard (#9779).
    afterNextRender(() => this._scrollActiveInputIntoView(), {
      injector: this._environmentInjector,
    });
  }

  private _isViewportResizedForKeyboard(): boolean {
    return isVisualViewportResizedForKeyboard(
      this._keyboardHeight > 0,
      this._viewportHeightBeforeKeyboard || window.innerHeight,
      window.visualViewport?.height,
    );
  }

  private _updateViewportVars(): void {
    const vars = computeIosKeyboardViewportVars({
      keyboardHeight: this._keyboardHeight,
      baseHeight: this._viewportHeightBeforeKeyboard || window.innerHeight,
      visualViewportHeight: window.visualViewport?.height,
      isKeyboardSettled: this._isKeyboardSettled,
      isKeyboardFrameUnreliable: this._keyboardFrameUnreliable,
    });

    let hasChanged = this._setCssVar(
      CSS_VAR_VISUAL_VIEWPORT_HEIGHT,
      `${vars.visualViewportHeightPx}px`,
    );
    hasChanged =
      this._setCssVar(
        CSS_VAR_KEYBOARD_OVERLAY_OFFSET,
        `${vars.keyboardOverlayOffsetPx}px`,
      ) || hasChanged;
    if (vars.correctedKeyboardHeightPx !== null) {
      hasChanged =
        this._setCssVar(CSS_VAR_KEYBOARD_HEIGHT, `${vars.correctedKeyboardHeightPx}px`) ||
        hasChanged;
    }
    const isKeyboardVisible = this._keyboardHeight > 0;
    this.shellHeight.set(
      isKeyboardVisible
        ? `calc(${vars.visualViewportHeightPx}px - var(--safe-area-top))`
        : null,
    );
    this.keyboardOverlayOffset.set(
      isKeyboardVisible ? `${vars.keyboardOverlayOffsetPx}px` : null,
    );

    // Every notification costs a synthetic window resize, and each of those makes
    // CdkTextareaAutosize drop its caches and re-measure and every connected CDK
    // overlay reposition — app-wide layout work. The keyboard animation fires a
    // burst of visualViewport resize events, most of which land on values we have
    // already written, so only tell the app about the ones that moved something.
    if (hasChanged) {
      this._notifyViewportChange();
    }
  }

  /**
   * Writes a CSS variable on the overlay container, deduped; returns whether
   * the value actually changed.
   */
  private _setCssVar(name: string, value: string): boolean {
    if (this._cssVarCache.get(name) === value) {
      return false;
    }
    this._cssVarCache.set(name, value);
    this._overlayVarTarget.style.setProperty(name, value);
    return true;
  }

  private _notifyViewportChange(): void {
    if (this._viewportChangeRaf !== null) {
      return;
    }

    this._viewportChangeRaf = window.requestAnimationFrame(() => {
      this._viewportChangeRaf = null;
      // Connected CDK overlays listen to viewport resize events via ViewportRuler.
      window.dispatchEvent(new Event('resize'));
    });
  }

  private _isInputElement(el: HTMLElement): boolean {
    const tagName = el.tagName.toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      el.isContentEditable
    );
  }

  /**
   * Whether scrolling could bring this element into view at all.
   *
   * False only for an element sitting in a `position: fixed` container with no
   * scrollable box in between — the global add-task bar, say: it moves with the
   * viewport, so nothing can scroll it anywhere. An input inside a dialog keeps
   * returning true, because the dialog's own scroll container can still lift it
   * off the keyboard (#7388).
   */
  private _canScrollIntoView(el: HTMLElement): boolean {
    let node: HTMLElement | null = el.parentElement;
    while (node && node !== this._document.body) {
      const style = window.getComputedStyle(node);
      if (
        node.scrollHeight > node.clientHeight &&
        (style.overflowY === 'auto' || style.overflowY === 'scroll')
      ) {
        return true;
      }
      if (style.position === 'fixed') {
        return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  private _scrollActiveInputIntoView(): void {
    const activeEl = this._document.activeElement as HTMLElement;
    if (activeEl && this._isInputElement(activeEl)) {
      // Mid keyboard animation the fixed add-task bar can sit outside the
      // shrinking viewport just long enough for `scrollIntoViewIfNeeded` to
      // scroll the list behind it to an arbitrary offset — which is one of the
      // ways the bar appears to jump around (#9779). Scrolling cannot move a
      // fixed element anyway, so skip it there.
      if (!this._canScrollIntoView(activeEl)) {
        return;
      }
      // scrollIntoViewIfNeeded is non-standard but well-supported in iOS WebView
      const scrollable = activeEl as HTMLElement & {
        scrollIntoViewIfNeeded?: (centerIfNeeded: boolean) => void;
      };
      if (scrollable.scrollIntoViewIfNeeded) {
        scrollable.scrollIntoViewIfNeeded(true);
      } else {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}
