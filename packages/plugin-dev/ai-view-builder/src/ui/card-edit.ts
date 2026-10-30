import { formatDuration } from '../core/cards';
import { el } from './dom';

// Inline editors of a row: the title and the estimate. Both live in one input
// that takes the place of the text. Enter or leaving saves, Escape cancels.
// While one is focused the view is not redrawn (see render-gate.ts).

interface EditorOptions {
  value: string;
  label: string;
  className?: string;
  placeholder?: string;
  /** False keeps the editor open, marked invalid; only checked on Enter. */
  validate?: (text: string) => boolean;
  /** Called at most once, with the text as typed. */
  commit: (text: string) => void;
  /** Called once when the editor is gone, saved or not. */
  end: () => void;
}

const openEditor = (opts: EditorOptions): HTMLInputElement => {
  const input = el('input', `card-input ${opts.className ?? ''}`.trim());
  input.type = 'text';
  input.value = opts.value;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', opts.label);
  if (opts.placeholder) input.placeholder = opts.placeholder;
  let finished = false;
  const finish = (save: boolean): void => {
    if (finished) return;
    if (save && opts.validate && !opts.validate(input.value)) {
      input.classList.add('is-invalid');
      return;
    }
    // Set first: removing the focused input fires blur, which must not save again.
    finished = true;
    if (save) opts.commit(input.value);
    opts.end();
  };
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      // The document-level Escape clears the selected part; this one is ours.
      e.stopPropagation();
      finish(e.key === 'Enter');
    }
  });
  input.addEventListener('input', () => input.classList.remove('is-invalid'));
  input.addEventListener('blur', () => {
    const text = input.value;
    finish(!opts.validate || opts.validate(text));
  });
  return input;
};

const lineOf = (cardEl: HTMLElement): HTMLElement | null =>
  cardEl.querySelector(':scope > .card-line');

export interface EditCallbacks {
  commit: (text: string) => void;
  end: () => void;
}

const swapIn = (slot: HTMLElement, input: HTMLInputElement): void => {
  slot.replaceWith(input);
  input.focus();
  input.select();
};

const restore = (input: HTMLElement, original: HTMLElement | null): void => {
  if (!input.isConnected) return;
  if (original) input.replaceWith(original);
  else input.remove();
};

export const editTitle = (
  cardEl: HTMLElement,
  title: string,
  cb: EditCallbacks,
): void => {
  const slot = lineOf(cardEl)?.querySelector<HTMLElement>('.card-title');
  if (!slot) return;
  const input = openEditor({
    value: title,
    label: 'Task title',
    commit: cb.commit,
    end: () => {
      restore(input, slot);
      cb.end();
    },
  });
  swapIn(slot, input);
};

export const editEstimate = (
  cardEl: HTMLElement,
  estimateMs: number,
  options: EditCallbacks & { validate: (text: string) => boolean },
): void => {
  const line = lineOf(cardEl);
  const side = line?.querySelector<HTMLElement>(':scope > .card-side');
  if (!side) return;
  const slot = side.querySelector<HTMLElement>('.card-time');
  const input = openEditor({
    value: estimateMs ? formatDuration(estimateMs) : '',
    label: 'Estimate, for example 1h 30m',
    placeholder: '1h 30m',
    className: 'card-estimate-input',
    validate: options.validate,
    commit: options.commit,
    end: () => {
      restore(input, slot ?? null);
      options.end();
    },
  });
  if (slot) swapIn(slot, input);
  else {
    side.prepend(input);
    input.focus();
  }
};
