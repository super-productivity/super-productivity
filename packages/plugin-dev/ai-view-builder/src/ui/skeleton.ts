import { el } from './dom';

// Shown from the moment a new view is requested until its first part arrives,
// so the page answers at once instead of sitting empty for the model's first
// seconds. It only hints at a layout; it carries no text and no task data.
const CARDS_PER_COLUMN = [3, 2, 1];

export const skeleton = (): HTMLElement => {
  const root = el('div', 'skeleton');
  root.setAttribute('aria-hidden', 'true');
  root.appendChild(el('div', 'skeleton-title'));
  const columns = el('div', 'skeleton-cols');
  for (const cards of CARDS_PER_COLUMN) {
    const column = el('div', 'skeleton-col');
    for (let i = 0; i < cards; i++) column.appendChild(el('div', 'skeleton-card'));
    columns.appendChild(column);
  }
  root.appendChild(columns);
  return root;
};
