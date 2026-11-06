// HERE YOU CAN PUT HELPFUL UTIL FUNCTIONS RELATED TO DOM ELEMENTS

/**
 * Checks if an event target is a link, or sits inside one. Click handlers that
 * preventDefault must bail on these, or the link never opens.
 *
 * Takes `Element`, not `HTMLElement`: an icon inside a link is an `SVGElement`,
 * and answering "no" for it would swallow the click on exactly the pixels a
 * user aims at.
 */
export const isLinkTarget = (target: EventTarget | null): boolean =>
  // closest() matches the element itself too, so an <a> target needs no
  // separate check.
  target instanceof Element && !!target.closest('a');

/** Checks if the element is an input (input, textarea, or contenteditable) */
export const isInputElement = (el: HTMLElement): boolean => {
  return !!(
    el.tagName.toUpperCase() === 'INPUT' ||
    el.tagName.toUpperCase() === 'TEXTAREA' ||
    el.isContentEditable
  );
};
