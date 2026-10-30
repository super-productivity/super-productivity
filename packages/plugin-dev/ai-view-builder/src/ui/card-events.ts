import { commandForKey } from '../core/card-keys';
import type { CardActions } from './card-actions';
import type { CardController, Point } from './card-controller';
import { hoverControls } from './card-parts';

// The DOM events of the cards, delegated from the view's container so a
// redraw never needs to rebind anything and 500 cards carry no listeners.

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 8;
const CLICK_AFTER_PRESS_MS = 400;

export interface EventDeps {
  root: HTMLElement;
  controller: CardController;
  actions: CardActions;
  canTrack: boolean;
}

export interface CardEvents {
  /** The pointer may rest on a new row after a redraw; mount its controls again. */
  remountHover(): void;
}

const isTouch = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

const pointOf = (el: HTMLElement): Point => {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
};

const cardOf = (target: EventTarget | null): HTMLElement | null =>
  (target as HTMLElement | null)?.closest<HTMLElement>('.card') ?? null;

// Typing in an editor or an add row is not a gesture on the card around it.
const inEditor = (target: EventTarget | null): boolean =>
  !!(target as HTMLElement | null)?.closest('.card-input, .add-row');

type ClickHandler = (cardEl: HTMLElement, from: HTMLElement) => void;

const clickHandlers = ({
  actions,
  controller,
}: EventDeps): Record<string, ClickHandler> => ({
  done: (c) => actions.toggleDone(c.dataset.tid!),
  track: (c) => actions.toggleTrack(c.dataset.tid!),
  open: (c) => actions.open(c.dataset.tid!),
  estimate: (c) => controller.run('editEstimate', c),
  // A touch has no hover to tell a tap to open from a tap to edit; open wins.
  title: (c) =>
    isTouch() ? actions.open(c.dataset.tid!) : controller.run('editTitle', c),
  menu: (c, from) => controller.openMenu(c, 'main', pointOf(from)),
  collapse: (c) => controller.toggleCollapse(c),
});

const wireClicks = (deps: EventDeps, isSuppressed: () => boolean): void => {
  const handlers = clickHandlers(deps);
  deps.root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const cardEl = cardOf(target);
    if (!cardEl || isSuppressed() || inEditor(target)) return;
    const from = target.closest<HTMLElement>('[data-action]');
    const handler = from?.dataset.action ? handlers[from.dataset.action] : undefined;
    if (handler) return handler(cardEl, from!);
    // Anywhere else on the row opens it, as a row does in the task list.
    if (!from && target.closest('.card-line')) deps.actions.open(cardEl.dataset.tid!);
  });
};

// Calls onPress when a touch stays down and still; any movement is a scroll.
const watchLongPress = (down: PointerEvent, onPress: () => void): void => {
  const stop = (): void => {
    window.clearTimeout(timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', stop);
    document.removeEventListener('pointercancel', stop);
  };
  const onMove = (e: PointerEvent): void => {
    const moved = Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY);
    if (moved > LONG_PRESS_SLOP_PX) stop();
  };
  const timer = window.setTimeout(() => {
    stop();
    onPress();
  }, LONG_PRESS_MS);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', stop);
  document.addEventListener('pointercancel', stop);
};

const wireMenuGestures = ({ root, controller }: EventDeps): (() => boolean) => {
  let pressedAt = 0;
  root.addEventListener('contextmenu', (e) => {
    const cardEl = cardOf(e.target);
    if (!cardEl || inEditor(e.target)) return;
    e.preventDefault();
    controller.openMenu(cardEl, 'main', { x: e.clientX, y: e.clientY });
  });
  // Touch browsers differ on whether a long press sends contextmenu.
  root.addEventListener('pointerdown', (down) => {
    const target = down.target as HTMLElement;
    const cardEl = cardOf(target);
    if (down.pointerType !== 'touch' || !cardEl || !target.closest('.card-line')) return;
    if (inEditor(target) || target.closest('button')) return;
    watchLongPress(down, () => {
      // A board card that began a drag belongs to the drag.
      if (document.querySelector('.drag-ghost')) return;
      pressedAt = Date.now();
      controller.openMenu(cardEl, 'main', { x: down.clientX, y: down.clientY });
    });
  });
  // Lifting the finger after a long press is not a tap.
  return () => Date.now() - pressedAt < CLICK_AFTER_PRESS_MS;
};

const wireKeys = ({ root, controller }: EventDeps): void => {
  root.addEventListener('keydown', (e) => {
    // Keys on the card itself only; a focused button or input keeps its own.
    if (!(e.target as HTMLElement).classList?.contains('card') || e.isComposing) return;
    const cmd = commandForKey(e);
    if (!cmd) return;
    e.preventDefault();
    controller.command(cmd, e.target as HTMLElement);
  });
};

// The controls are built when the pointer arrives, not with every row.
const wireHover = ({ root, canTrack }: EventDeps): (() => void) => {
  let hovered: HTMLElement | null = null;
  const unmount = (): void => {
    hovered?.querySelector(':scope > .hover-controls')?.remove();
    hovered = null;
  };
  const mount = (line: HTMLElement): void => {
    if (line === hovered) return;
    unmount();
    const cardEl = line.parentElement!;
    if (line.querySelector('.card-input')) return;
    hovered = line;
    line.appendChild(
      hoverControls(
        {
          isDone: cardEl.classList.contains('is-done'),
          isTracking: cardEl.classList.contains('is-tracking'),
        },
        canTrack,
      ),
    );
  };
  if (isTouch()) return () => undefined;
  root.addEventListener('mouseover', (e) => {
    const line = (e.target as HTMLElement).closest<HTMLElement>('.card-line');
    if (line) mount(line);
    else unmount();
  });
  root.addEventListener('mouseleave', unmount);
  return () => {
    hovered = null;
    const line = root.querySelector<HTMLElement>('.card-line:hover');
    if (line) mount(line);
  };
};

export const wireCardEvents = (deps: EventDeps): CardEvents => {
  const isSuppressed = wireMenuGestures(deps);
  wireClicks(deps, isSuppressed);
  wireKeys(deps);
  return { remountHover: wireHover(deps) };
};
