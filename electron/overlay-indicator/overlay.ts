// Get elements
const showMainBtn = document.getElementById('show-main') as HTMLButtonElement;
const container = document.getElementById('overlay-container') as HTMLDivElement;
const taskTitle = document.getElementById('task-title') as HTMLDivElement;
const timeDisplay = document.getElementById('time-display') as HTMLDivElement;

// ── Right-click prevention ──
const blockRightClick = (e: MouseEvent): false | void => {
  if (e.type === 'contextmenu' || e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  }
};
document.addEventListener('contextmenu', blockRightClick, true);
document.addEventListener('mousedown', blockRightClick, true);
document.addEventListener('mouseup', blockRightClick, true);

// ── Show main button ──
showMainBtn.addEventListener('click', () => {
  window.overlayAPI.showMainWindow();
});

// ── Content updates ──
window.overlayAPI.onUpdateContent((data) => {
  container.classList.remove('mode-pomodoro', 'mode-focus', 'mode-task', 'mode-idle');
  if (data.mode) {
    container.classList.add(`mode-${data.mode}`);
  }
  taskTitle.textContent = data.title || 'No active task';
  timeDisplay.textContent = data.time || '--:--';
});

// ── Opacity updates ──
window.overlayAPI.onUpdateOpacity((opacity) => {
  document.body.style.setProperty('--opacity', opacity.toString());
});

// ── Responsive class + scale updates ──
const REFERENCE_HEIGHT = 80;
const BP_FULL = 80;

const updateResponsiveState = (): void => {
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;

  document.body.classList.remove('size-full', 'size-tiny');
  if (w >= BP_FULL) {
    document.body.classList.add('size-full');
  } else {
    document.body.classList.add('size-tiny');
  }

  const scale = Math.max(0.8, Math.min(2, h / REFERENCE_HEIGHT));
  document.body.style.setProperty('--scale', scale.toString());
};

const resizeObserver = new ResizeObserver(updateResponsiveState);
resizeObserver.observe(document.documentElement);
updateResponsiveState();
