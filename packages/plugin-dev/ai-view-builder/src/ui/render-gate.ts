// A redraw replaces every row, which would throw away a title the user is
// typing (the tracked task redraws once a second). The gate holds redraws back
// while an inline editor is focused and runs one when it closes.

export interface RenderGate {
  /** True when the redraw must wait; it runs once the editor is gone. */
  holds(): boolean;
  /** An inline editor closed. */
  released(): void;
}

// An empty add input is just waiting for the next task, so it can be redrawn
// around (the new task appears while the input keeps its focus).
const isTyping = (root: HTMLElement): boolean => {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || !root.contains(active)) return false;
  if (active.classList.contains('card-input')) return true;
  return active.classList.contains('add-input') && active.value !== '';
};

export const createRenderGate = (root: HTMLElement, redraw: () => void): RenderGate => {
  let isWaiting = false;
  let isPointerDown = false;

  const flush = (): void => {
    if (!isWaiting || isTyping(root)) return;
    isWaiting = false;
    redraw();
  };

  // Leaving an editor with a click must not redraw between mouse down and up:
  // the click would find its target gone and be lost.
  document.addEventListener(
    'pointerdown',
    () => {
      isPointerDown = true;
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    () => {
      isPointerDown = false;
      window.setTimeout(flush, 0);
    },
    true,
  );
  // Focus has moved by the next tick, so isTyping sees the new element.
  root.addEventListener('focusout', () => window.setTimeout(flush, 0));

  return {
    holds: () => {
      if (!isTyping(root)) return false;
      isWaiting = true;
      return true;
    },
    released: () => {
      if (!isPointerDown) flush();
    },
  };
};
