import type { CardModel } from '../core/cards';
import type { NodeModel } from '../core/model';
import { el } from './dom';
import { BuildCtx, cardList, heading } from './render-card';

// Draws the render model and animates the change (FLIP): items keep their
// identity across redraws through data-flip keys and glide from where they
// were to where they are now. Interaction is delegated from the container
// (data-action attributes), so a redraw never needs to rebind handlers.

const ANIMATION_MS = 320;
const MAX_ANIMATIONS = 300;

const countTasks = (node: NodeModel | null, counts: Map<string, number>): void => {
  if (!node) return;
  const add = (cards: CardModel[]): void =>
    cards.forEach((c) => counts.set(c.id, (counts.get(c.id) ?? 0) + 1));
  if (node.kind === 'container') node.children.forEach((c) => countTasks(c, counts));
  if (node.kind === 'taskList') node.groups.forEach((g) => add(g.cards));
  if (node.kind === 'board') node.columns.forEach((c) => add(c.cards));
};

const header = (
  cid: string,
  title: string | undefined,
  problems: string[],
  ctx: BuildCtx,
): HTMLElement => {
  const head = el('div', 'c-head');
  const btn = el('button', 'c-title', title || ' ');
  btn.type = 'button';
  btn.dataset.action = 'select';
  btn.dataset.cid = cid;
  btn.title = 'Select to change just this part';
  btn.setAttribute('aria-pressed', String(ctx.selectedId === cid));
  head.appendChild(btn);
  if (problems.length) {
    head.appendChild(el('div', 'c-problems text-muted', problems.join(' · ')));
  }
  return head;
};

const build = (node: NodeModel, ctx: BuildCtx): HTMLElement => {
  const wrap = el('section', `c c-${node.kind}`);
  wrap.dataset.flip = `c:${node.cid}`;
  wrap.dataset.cid = node.cid;
  if (ctx.selectedId === node.cid) wrap.classList.add('is-selected');

  switch (node.kind) {
    case 'container': {
      wrap.classList.add(`layout-${node.layout}`);
      if (node.title) wrap.appendChild(header(node.cid, node.title, [], ctx));
      const inner = el('div', 'c-children');
      node.children.forEach((child) => inner.appendChild(build(child, ctx)));
      wrap.appendChild(inner);
      break;
    }
    case 'taskList': {
      wrap.appendChild(header(node.cid, node.title, node.problems, ctx));
      const total = node.groups.reduce((n, g) => n + g.cards.length, 0);
      if (!total) {
        wrap.appendChild(el('p', 'empty text-muted', node.emptyText));
      }
      node.groups.forEach((g) => {
        if (!g.cards.length) return;
        if (g.label) {
          wrap.appendChild(
            heading('h4', 'group-label', g.label, g.cards.length, g.estimate),
          );
        }
        wrap.appendChild(cardList(g.cards, node.cid, ctx, false));
      });
      break;
    }
    case 'board': {
      wrap.appendChild(header(node.cid, node.title, node.problems, ctx));
      const cols = el('div', 'board-cols');
      if (node.columnsPerRow) {
        cols.style.gridTemplateColumns = `repeat(${node.columnsPerRow}, minmax(0, 1fr))`;
        cols.classList.add('is-grid');
      }
      node.columns.forEach((col) => {
        const colEl = el('div', 'board-col');
        colEl.dataset.colId = col.id;
        colEl.dataset.boardCid = node.cid;
        colEl.dataset.flip = `col:${node.cid}:${col.id}`;
        colEl.appendChild(
          heading('h4', 'col-title', col.title, col.cards.length, col.estimate),
        );
        colEl.appendChild(cardList(col.cards, node.cid, ctx, true));
        cols.appendChild(colEl);
      });
      wrap.appendChild(cols);
      break;
    }
    case 'metric': {
      wrap.appendChild(el('div', 'metric-value', node.value));
      wrap.appendChild(header(node.cid, node.title, node.problems, ctx));
      break;
    }
    case 'text': {
      wrap.appendChild(el('p', 'text-block', node.text));
      break;
    }
    case 'placeholder': {
      wrap.appendChild(el('p', 'placeholder text-muted', node.message));
      break;
    }
  }
  return wrap;
};

const measure = (root: HTMLElement): Map<string, DOMRect> => {
  const rects = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>('[data-flip]').forEach((node) => {
    rects.set(node.dataset.flip!, node.getBoundingClientRect());
  });
  return rects;
};

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

const animate = (root: HTMLElement, before: Map<string, DOMRect>): void => {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'));
  const deltas = new Map<Element, { dx: number; dy: number }>();
  const isNew = new Set<Element>();
  const viewport = root.getBoundingClientRect();
  for (const node of nodes) {
    const prev = before.get(node.dataset.flip!);
    const now = node.getBoundingClientRect();
    if (!prev) {
      isNew.add(node);
      continue;
    }
    deltas.set(node, { dx: prev.left - now.left, dy: prev.top - now.top });
  }
  let count = 0;
  for (const node of nodes) {
    if (count >= MAX_ANIMATIONS) break;
    const rect = node.getBoundingClientRect();
    if (rect.bottom < viewport.top || rect.top > viewport.bottom) continue;
    const ancestor = node.parentElement?.closest('[data-flip]') ?? null;
    if (isNew.has(node)) {
      // Fade in only the outermost new element; its contents come with it.
      if (ancestor && isNew.has(ancestor)) continue;
      node.animate(
        [
          { opacity: 0, transform: 'scale(0.98)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: ANIMATION_MS, easing: 'ease-out' },
      );
      count++;
      continue;
    }
    // Transforms compound, so move each element only by the part of its
    // movement its nearest animated ancestor does not already cover.
    const own = deltas.get(node)!;
    const parent = ancestor ? deltas.get(ancestor) : undefined;
    const dx = own.dx - (parent?.dx ?? 0);
    const dy = own.dy - (parent?.dy ?? 0);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: ANIMATION_MS,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
    count++;
  }
};

export interface RenderOptions {
  selectedId: string | null;
  canTrack: boolean;
  animate: boolean;
}

export const renderView = (
  root: HTMLElement,
  model: NodeModel | null,
  opts: RenderOptions,
): void => {
  const before = opts.animate ? measure(root) : new Map<string, DOMRect>();
  const scrollTop = root.scrollTop;
  const taskCounts = new Map<string, number>();
  countTasks(model, taskCounts);
  const ctx: BuildCtx = {
    selectedId: opts.selectedId,
    taskCounts,
    canTrack: opts.canTrack,
  };
  const focused = document.activeElement as HTMLElement | null;
  const focusKey = focused && root.contains(focused) ? focusSignature(focused) : null;

  root.replaceChildren(...(model ? [build(model, ctx)] : []));
  root.scrollTop = scrollTop;
  if (focusKey) restoreFocus(root, focusKey);
  if (
    opts.animate &&
    !prefersReducedMotion() &&
    typeof Element.prototype.animate === 'function'
  ) {
    animate(root, before);
  }
};

// Focus survives a redraw: the same control on the same task or part.
const focusSignature = (node: HTMLElement): string => {
  const cardEl = node.closest<HTMLElement>('[data-tid]');
  return [
    cardEl?.dataset.tid ?? '',
    node.dataset.action ?? '',
    node.dataset.cid ?? '',
  ].join('|');
};

const restoreFocus = (root: HTMLElement, key: string): void => {
  const [tid, action, cid] = key.split('|');
  const cardEl = tid
    ? root.querySelector<HTMLElement>(`[data-tid="${CSS.escape(tid)}"]`)
    : null;
  const scope = cardEl ?? root;
  const target = action
    ? scope.querySelector<HTMLElement>(
        `[data-action="${action}"]${cid && !tid ? `[data-cid="${CSS.escape(cid)}"]` : ''}`,
      )
    : cardEl;
  (target ?? cardEl)?.focus({ preventScroll: true });
};
