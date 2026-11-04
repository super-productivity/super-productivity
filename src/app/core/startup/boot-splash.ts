/** Id of the boot splash in `src/index.html`; a sibling of `<app-root>`. */
export const BOOT_SPLASH_ID = 'app-splash';
/** Starts the splash fade-out (styles live in `src/index.html`). */
export const BOOT_SPLASH_HIDING_CLASS = 'is-hiding';
/** On phones, shrinks the splash to the content area, uncovering the bottom bar. */
export const BOOT_SPLASH_SHELL_SHOWN_CLASS = 'is-shell-shown';

/**
 * Marks the shell as rendered before data is loaded. On phones (styles in
 * `src/index.html`) the splash then covers only the content area, so the
 * bottom bar slides up early; on desktop it keeps covering the whole window
 * until it fades out.
 */
export const showShellUnderBootSplash = (doc: Document = document): void => {
  doc.getElementById(BOOT_SPLASH_ID)?.classList.add(BOOT_SPLASH_SHELL_SHOWN_CLASS);
};

/**
 * Fades the static boot splash out and removes it once its fade has played.
 *
 * Removal waits on the splash's own animations, so it needs no timer that
 * mirrors the CSS duration, and happens at once when animations are disabled
 * (reduced motion, `isDisableAnimations`). Removing the element (rather than
 * leaving it invisible) also drops its Electron drag region.
 */
export const fadeOutBootSplash = (doc: Document = document): void => {
  const splash = doc.getElementById(BOOT_SPLASH_ID);
  if (!splash || splash.classList.contains(BOOT_SPLASH_HIDING_CLASS)) {
    return;
  }
  splash.classList.add(BOOT_SPLASH_HIDING_CLASS);
  void whenAnimationsSettle(splash).then(() => splash.remove());
};

/**
 * Resolves once the element's own finite animations and transitions (not its
 * descendants') have finished or been cancelled; at once if none run, e.g.
 * with animations off. Infinite ones are ignored: they never finish.
 */
export const whenAnimationsSettle = async (el: Element): Promise<void> => {
  const animations = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
  const finite = animations.filter(
    (a) => a.effect?.getComputedTiming().endTime !== Infinity,
  );
  // `finished` rejects when an animation is cancelled; that still counts as settled.
  await Promise.allSettled(finite.map((a) => a.finished));
};
