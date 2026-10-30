// Board drag and drop with pointer events, which work for mouse, pen and
// touch (HTML5 drag and drop does not work reliably in touch WebViews).
// A mouse drag starts after a small movement; touch needs a long press so the
// list still scrolls normally.

const MOUSE_THRESHOLD_PX = 6;
const TOUCH_HOLD_MS = 350;
const TOUCH_SLOP_PX = 8;

export const enableBoardDrag = (
  root: HTMLElement,
  onDrop: (taskId: string, boardCid: string, columnId: string) => void,
): void => {
  root.addEventListener('pointerdown', (down) => {
    const target = down.target as HTMLElement;
    const cardEl = target.closest<HTMLElement>('[data-draggable="true"]');
    if (!cardEl || down.button !== 0 || target.closest('button:not(.card-title)')) return;
    const sourceCol = cardEl.closest<HTMLElement>('.board-col');
    if (!sourceCol) return;

    const startX = down.clientX;
    const startY = down.clientY;
    let ghost: HTMLElement | null = null;
    let targetCol: HTMLElement | null = null;
    let holdTimer: number | undefined;
    const rect = cardEl.getBoundingClientRect();

    const start = (): void => {
      ghost = cardEl.cloneNode(true) as HTMLElement;
      ghost.classList.add('drag-ghost');
      ghost.style.width = `${rect.width}px`;
      document.body.appendChild(ghost);
      cardEl.classList.add('is-drag-source');
      move(startX, startY);
    };

    const move = (x: number, y: number): void => {
      if (!ghost) return;
      ghost.style.transform = `translate(${x - (startX - rect.left)}px, ${y - (startY - rect.top)}px)`;
      const under =
        document.elementFromPoint(x, y)?.closest<HTMLElement>('.board-col') ?? null;
      const valid =
        under && under.dataset.boardCid === sourceCol.dataset.boardCid ? under : null;
      if (valid !== targetCol) {
        targetCol?.classList.remove('is-drop-target');
        valid?.classList.add('is-drop-target');
        targetCol = valid;
      }
    };

    const onMove = (e: PointerEvent): void => {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (!ghost) {
        if (down.pointerType === 'touch') {
          if (dist > TOUCH_SLOP_PX) cleanup();
          return;
        }
        if (dist < MOUSE_THRESHOLD_PX) return;
        start();
      }
      e.preventDefault();
      move(e.clientX, e.clientY);
    };

    const onUp = (): void => {
      const dropped = ghost && targetCol && targetCol !== sourceCol ? targetCol : null;
      const wasDrag = !!ghost;
      cleanup();
      if (dropped) {
        onDrop(cardEl.dataset.tid!, dropped.dataset.boardCid!, dropped.dataset.colId!);
      }
      if (wasDrag) {
        // Swallow the click that follows a drag, so it does not open the task.
        const swallow = (e: MouseEvent): void => {
          e.stopPropagation();
          e.preventDefault();
        };
        window.addEventListener('click', swallow, true);
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
    };

    const blockTouchScroll = (e: TouchEvent): void => {
      if (ghost) e.preventDefault();
    };

    const cleanup = (): void => {
      window.clearTimeout(holdTimer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', cleanup);
      document.removeEventListener('touchmove', blockTouchScroll);
      ghost?.remove();
      ghost = null;
      cardEl.classList.remove('is-drag-source');
      targetCol?.classList.remove('is-drop-target');
    };

    if (down.pointerType === 'touch') {
      holdTimer = window.setTimeout(start, TOUCH_HOLD_MS);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', cleanup);
    document.addEventListener('touchmove', blockTouchScroll, { passive: false });
  });
};
