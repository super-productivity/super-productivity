import type { MenuEntry, MenuView } from '../core/task-actions';
import { el } from './dom';
import { icon, isIconName } from './icons';

// The context menu of a card. It lives on <body>, outside the view, so a
// redraw of the view cannot remove it, and it opens at the pointer or at the
// card. Two levels: the actions, and the tags or projects behind them.

export interface MenuSource {
  entries(view: MenuView): MenuEntry[];
  /** Runs the entry. Called after the menu closed, unless it keeps the menu open. */
  pick(id: string): void;
}

export interface MenuOptions {
  source: MenuSource;
  view: MenuView;
  at: { x: number; y: number };
  label: string;
  /** Called once, whichever way the menu ended. `refocus` is false for an outside click. */
  onClose(refocus: boolean): void;
}

export interface OpenMenu {
  close(): void;
}

const MARGIN = 8;
const TITLES: Record<MenuView, string> = {
  main: 'Task actions',
  tags: 'Tags',
  project: 'Move to project',
};

// Tags toggle one at a time, so the menu stays open to show the new state.
const keepsOpen = (id: string): boolean => id.startsWith('tag:');

const itemEl = (e: MenuEntry): HTMLElement => {
  const btn = el('button', `menu-item${e.danger ? ' is-danger' : ''}`);
  btn.type = 'button';
  btn.tabIndex = -1;
  btn.dataset.id = e.id;
  const isChoice = e.checked !== undefined;
  btn.setAttribute('role', isChoice ? 'menuitemcheckbox' : 'menuitem');
  if (isChoice) btn.setAttribute('aria-checked', String(e.checked));
  if (e.hasSubMenu) {
    btn.classList.add('has-sub-menu');
    btn.setAttribute('aria-haspopup', 'menu');
  }
  btn.appendChild(icon(isIconName(e.icon) ? e.icon : 'list'));
  btn.appendChild(el('span', 'menu-label', e.label));
  if (e.hint) btn.appendChild(el('span', 'menu-hint', e.hint));
  if (e.checked) btn.appendChild(icon('check')).classList.add('menu-check');
  if (e.hasSubMenu) btn.appendChild(icon('chevron'));
  return btn;
};

const backEntry: MenuEntry = { id: 'back', icon: 'back', label: 'Back' };

const fill = (menu: HTMLElement, view: MenuView, entries: MenuEntry[]): void => {
  const nodes: HTMLElement[] = [];
  if (view !== 'main') nodes.push(itemEl(backEntry));
  for (const entry of entries) {
    if (entry.separatorBefore) nodes.push(sepEl());
    nodes.push(itemEl(entry));
  }
  menu.setAttribute('aria-label', TITLES[view]);
  menu.replaceChildren(...nodes);
};

const sepEl = (): HTMLElement => {
  const sep = el('div', 'menu-sep');
  sep.setAttribute('role', 'separator');
  return sep;
};

const items = (menu: HTMLElement): HTMLElement[] =>
  Array.from(menu.querySelectorAll<HTMLElement>('.menu-item'));

const place = (menu: HTMLElement, at: { x: number; y: number }): void => {
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.min(at.x, window.innerWidth - width - MARGIN);
  const top = Math.min(at.y, window.innerHeight - height - MARGIN);
  menu.style.left = `${Math.max(MARGIN, left)}px`;
  menu.style.top = `${Math.max(MARGIN, top)}px`;
};

const focusItem = (menu: HTMLElement, id?: string): void => {
  const list = items(menu);
  (list.find((i) => i.dataset.id === id) ?? list[0])?.focus({ preventScroll: true });
};

const step = (menu: HTMLElement, delta: number | 'first' | 'last'): void => {
  const list = items(menu);
  if (!list.length) return;
  const at = list.indexOf(document.activeElement as HTMLElement);
  const next = delta === 'first' ? 0 : delta === 'last' ? list.length - 1 : at + delta;
  list[(next + list.length) % list.length].focus({ preventScroll: true });
};

// Anything outside the menu that moves or is clicked ends it, without taking
// the focus back from wherever the user went.
const dismissOnLeave = (menu: HTMLElement, close: (refocus: boolean) => void) => {
  const away = (e: Event): void => {
    // The window listens in the capture phase, so it also sees every element
    // lose focus, including the card when the menu takes the focus.
    if (e.type === 'blur' && e.target !== window) return;
    // window events have no node to be inside the menu
    if (!(e.target instanceof Node && menu.contains(e.target))) close(false);
  };
  const events: [EventTarget, string][] = [
    [document, 'pointerdown'],
    [document, 'scroll'],
    [window, 'resize'],
    [window, 'blur'],
  ];
  events.forEach(([t, name]) => t.addEventListener(name, away, true));
  return (): void =>
    events.forEach(([t, name]) => t.removeEventListener(name, away, true));
};

interface MenuState {
  view: MenuView;
  show(view: MenuView, focusId?: string): void;
  close(refocus?: boolean): void;
  pick(item: HTMLElement): void;
}

const onKey = (menu: HTMLElement, st: MenuState, e: KeyboardEvent): void => {
  const back = (): void => {
    if (st.view !== 'main') st.show('main', st.view);
  };
  const keys: Record<string, () => void> = {
    ArrowDown: () => step(menu, 1),
    ArrowUp: () => step(menu, -1),
    Home: () => step(menu, 'first'),
    End: () => step(menu, 'last'),
    Escape: () => st.close(),
    Tab: () => st.close(),
    ArrowLeft: back,
    Backspace: back,
    ArrowRight: () => {
      const item = document.activeElement as HTMLElement;
      if (item.classList.contains('has-sub-menu')) st.pick(item);
    },
  };
  const run = keys[e.key];
  if (!run) return;
  e.preventDefault();
  // The card and the document listen for Escape and the arrows too.
  e.stopPropagation();
  run();
};

export const openCardMenu = (opts: MenuOptions): OpenMenu => {
  const menu = el('div', 'card-menu');
  menu.setAttribute('role', 'menu');
  let isClosed = false;
  const stopListening = dismissOnLeave(menu, (refocus) => st.close(refocus));

  const st: MenuState = {
    view: opts.view,
    show: (view, focusId) => {
      st.view = view;
      fill(menu, view, opts.source.entries(view));
      focusItem(menu, focusId);
    },
    close: (refocus = true) => {
      if (isClosed) return;
      isClosed = true;
      stopListening();
      menu.remove();
      opts.onClose(refocus);
    },
    pick: (item) => {
      const id = item.dataset.id!;
      if (id === 'back') return st.show('main', st.view);
      if (item.classList.contains('has-sub-menu')) return st.show(id as MenuView);
      if (keepsOpen(id)) {
        opts.source.pick(id);
        return st.show(st.view, id);
      }
      st.close();
      opts.source.pick(id);
    },
  };

  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
    if (item) st.pick(item);
  });
  menu.addEventListener('keydown', (e) => onKey(menu, st, e));
  fill(menu, opts.view, opts.source.entries(opts.view));
  document.body.appendChild(menu);
  place(menu, opts.at);
  focusItem(menu);
  return { close: () => st.close() };
};
