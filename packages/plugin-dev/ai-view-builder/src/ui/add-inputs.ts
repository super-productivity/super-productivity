import { el } from './dom';
import { icon } from './icons';

// "Add" inputs (a sub-task under a row, later a task in a lane or day). Their
// state is data, not DOM: a redraw from a data refresh rebuilds the input with
// the same draft and focus, so adding several in a row is not interrupted.

export interface AddInputs {
  isOpen(key: string): boolean;
  draft(key: string): string;
  open(key: string): void;
  close(key: string): void;
  set(key: string, text: string): void;
}

export const createAddInputs = (): AddInputs => {
  const drafts = new Map<string, string>();
  return {
    isOpen: (key) => drafts.has(key),
    draft: (key) => drafts.get(key) ?? '',
    open: (key) => {
      if (!drafts.has(key)) drafts.set(key, '');
    },
    close: (key) => void drafts.delete(key),
    set: (key, text) => void drafts.set(key, text),
  };
};

export interface AddRowOptions {
  key: string;
  /** Names the input for assistive tech. */
  label: string;
  /** The closed state is a button with this text; without it a closed row is removed. */
  buttonText?: string;
}

const inputEl = (key: string, label: string, draft: string): HTMLInputElement => {
  const input = el('input', 'add-input');
  input.type = 'text';
  input.value = draft;
  input.autocomplete = 'off';
  input.placeholder = label;
  input.setAttribute('aria-label', label);
  input.dataset.addInput = key;
  input.dataset.focusId = `add:${key}`;
  return input;
};

const buttonEl = (key: string, text: string): HTMLButtonElement => {
  const btn = el('button', 'add-btn');
  btn.type = 'button';
  btn.dataset.action = 'add-open';
  btn.dataset.addKey = key;
  btn.dataset.focusId = `add:${key}`;
  btn.appendChild(icon('add'));
  btn.appendChild(el('span', undefined, text));
  return btn;
};

const paint = (row: HTMLElement, adds: AddInputs): void => {
  const { addKey, addLabel, addButton } = row.dataset;
  if (!addKey || !addLabel) return;
  if (adds.isOpen(addKey)) {
    row.replaceChildren(inputEl(addKey, addLabel, adds.draft(addKey)));
  } else if (addButton) {
    row.replaceChildren(buttonEl(addKey, addButton));
  } else {
    row.remove();
  }
};

export const addRow = (opts: AddRowOptions, adds: AddInputs, cls = ''): HTMLElement => {
  const row = el('div', `add-row ${cls}`.trim());
  row.dataset.addKey = opts.key;
  row.dataset.addLabel = opts.label;
  if (opts.buttonText) row.dataset.addButton = opts.buttonText;
  paint(row, adds);
  return row;
};

const rowOf = (target: EventTarget | null): HTMLElement | null =>
  (target as HTMLElement | null)?.closest<HTMLElement>('.add-row') ?? null;

const focusInput = (row: HTMLElement): void => {
  const input = row.querySelector<HTMLInputElement>('.add-input');
  input?.focus();
};

/** Moves the focus into the input of an add row, after the view was drawn. */
export const focusAddInput = (root: HTMLElement, key: string): void => {
  root.querySelector<HTMLInputElement>(`[data-add-input="${CSS.escape(key)}"]`)?.focus();
};

/** Opens the input of the row a button belongs to, without redrawing the view. */
export const openAddRow = (button: HTMLElement, adds: AddInputs): void => {
  const row = rowOf(button);
  if (!row?.dataset.addKey) return;
  adds.open(row.dataset.addKey);
  paint(row, adds);
  focusInput(row);
};

export interface AddHandlers {
  /** One Enter, one call. */
  onAdd(key: string, text: string): void;
}

/** Typing, Enter, Escape and leaving, for every add input under `root`. */
export const wireAddInputs = (
  root: HTMLElement,
  adds: AddInputs,
  handlers: AddHandlers,
): void => {
  const keyOf = (e: Event): string | undefined =>
    (e.target as HTMLElement).dataset?.addInput;
  root.addEventListener('input', (e) => {
    const key = keyOf(e);
    if (key) adds.set(key, (e.target as HTMLInputElement).value);
  });
  root.addEventListener('keydown', (e) => {
    const key = keyOf(e);
    if (!key || e.isComposing) return;
    const input = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      adds.set(key, '');
      handlers.onAdd(key, text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // The document-level Escape clears the selected part; this one is ours.
      e.stopPropagation();
      const row = rowOf(input);
      adds.close(key);
      if (row) paint(row, adds);
    }
  });
  root.addEventListener('focusout', (e) => {
    const key = keyOf(e);
    const input = e.target as HTMLInputElement;
    // A draft stays open and visible; only an empty input goes away on leaving.
    // Removing a focused input blurs it again, so a closed row is not closed twice.
    if (!key || input.value.trim() || !input.isConnected || !adds.isOpen(key)) return;
    const row = rowOf(input);
    adds.close(key);
    if (row) paint(row, adds);
  });
};
