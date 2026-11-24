// A "⋮" button with a small menu. Native popover: it sits in the top layer, so
// the scrolling result list can't clip it, and it closes on outside click or Esc.

import { button, el } from './dom';

export type MenuItem = [label: string, onClick: () => void];

const GAP = 4;

/** Below the button, right-aligned; above it when there is no room below. */
const place = (menu: HTMLElement, anchor: HTMLElement): void => {
  const r = anchor.getBoundingClientRect();
  const top =
    r.bottom + GAP + menu.offsetHeight > window.innerHeight
      ? r.top - GAP - menu.offsetHeight
      : r.bottom + GAP;
  menu.style.top = `${Math.max(GAP, top)}px`;
  menu.style.left = `${Math.max(GAP, r.right - menu.offsetWidth)}px`;
};

/** The button and its menu; append both. */
export const moreMenu = (items: MenuItem[]): HTMLElement[] => {
  const menu = el('div', 'menu');
  menu.popover = 'auto';
  menu.setAttribute('role', 'menu');
  // popoverTarget, not a click handler: a click on the open menu's button would
  // light-dismiss it on pointerdown and reopen it on click.
  const more = el('button', 'btn-icon');
  more.type = 'button';
  more.popoverTargetElement = menu;
  more.setAttribute('aria-label', 'More');
  more.setAttribute('aria-haspopup', 'menu');
  more.append(el('span', 'material-icons', 'more_vert'));
  menu.addEventListener('toggle', (e) => {
    more.setAttribute('aria-expanded', String(e.newState === 'open'));
    if (e.newState === 'open') place(menu, more);
  });
  items.forEach(([label, onClick]) => {
    const item = button(label, () => {
      menu.hidePopover();
      onClick();
    });
    item.setAttribute('role', 'menuitem');
    menu.append(item);
  });
  return [more, menu];
};
