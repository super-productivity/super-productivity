const widget = document.getElementById('widget') as HTMLDivElement;
const shape = document.getElementById('shape') as HTMLDivElement;
const timeBlock = document.querySelector('.rt') as HTMLButtonElement;
let lastTimeWidth = 0;

const THEME_VARIABLES = {
  surface: '--surface',
  text: '--text',
  textMuted: '--text-muted',
  border: '--border',
  primary: '--primary',
  focus: '--focus',
  warning: '--warning',
} as const;

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

// ── Buttons ──
document.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('[data-action]');
  const action = button?.dataset.action;
  if (action === 'toggle') {
    window.taskWidgetAPI.toggleTask();
  } else if (action === 'done') {
    window.taskWidgetAPI.markDone();
  } else if (action === 'open') {
    window.taskWidgetAPI.showMainWindow();
  } else if (action === 'details') {
    window.taskWidgetAPI.toggleDetails();
  }
});

// ── Width ──
// The window moves under the cursor while its left end is dragged, so positions
// measured in here lag behind. The main process reads the real cursor instead.
document.querySelectorAll<HTMLElement>('.resize').forEach((handle) => {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      handle.setPointerCapture(e.pointerId);
      window.taskWidgetAPI.startResize(handle.dataset.side as 'left' | 'right');
    }
  });
  handle.addEventListener('pointermove', (e) => {
    if (handle.hasPointerCapture(e.pointerId)) {
      window.taskWidgetAPI.resize();
    }
  });
  handle.addEventListener('lostpointercapture', () => {
    window.taskWidgetAPI.endResize();
  });
});

const setText = (name: string, text: string): void => {
  document.querySelectorAll(`[data-text="${name}"]`).forEach((el) => {
    if (el.textContent !== text) {
      el.textContent = text;
    }
  });
};

const setLabel = (action: string, label: string): void => {
  document.querySelectorAll(`[data-action="${action}"]`).forEach((el) => {
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
  });
};

// ── Content updates ──
// Elements update in place: rebuilding them on a click would drop the hover and
// keyboard focus the cursor is on.
window.taskWidgetAPI.onUpdateView((view) => {
  const state = view.isPaused ? 'paused' : view.mode;
  const isRunning = !view.isPaused && view.mode !== 'idle';

  widget.dataset.state = state;
  widget.dataset.base = view.mode;
  widget.dataset.theme = view.isDark ? 'dark' : 'light';
  widget.dataset.running = String(isRunning);
  widget.style.setProperty('--r', view.ratio.toFixed(4));
  widget.style.setProperty('--project', view.projectColor);
  (Object.keys(THEME_VARIABLES) as (keyof typeof THEME_VARIABLES)[]).forEach((key) => {
    if (view.theme[key]) {
      widget.style.setProperty(THEME_VARIABLES[key], view.theme[key]);
    }
  });

  setText('title', view.title);
  setText('projectTitle', view.projectTitle);
  setText('statusText', view.statusText);
  setText('time', view.time);
  setText('timeSign', view.timeSign);
  setText('timeTop', view.timeStack[0]);
  setText('timeBottom', view.timeStack[1]);
  const timeWidth = timeBlock.offsetWidth;
  if (timeWidth && timeWidth !== lastTimeWidth) {
    lastTimeWidth = timeWidth;
    widget.style.setProperty('--time-width', `${timeWidth}px`);
    window.taskWidgetAPI.reportTimeWidth(timeWidth);
  }

  setLabel('toggle', isRunning ? view.labels.pause : view.labels.start);
  setLabel('done', view.labels.done);
  setLabel('open', view.labels.openApp);
  setLabel('details', view.labels.details);

  document.querySelectorAll('[data-status-icon]').forEach((el) => {
    el.setAttribute('href', `#i-${state}`);
  });
});

// ── Layout updates ──
window.taskWidgetAPI.onUpdateLayout((layout) => {
  // The window just moved under the shape, so start from where the shape was
  // dropped and let it glide to its new place.
  if (layout.shift && (layout.shift.x || layout.shift.y)) {
    shape.style.transition = 'none';
    shape.style.transform = `translate(${layout.shift.x}px, ${layout.shift.y}px)`;
    shape.getBoundingClientRect();
    shape.style.transition = '';
    shape.style.transform = '';
  }
  widget.style.setProperty('--width', `${layout.width}px`);
  widget.dataset.dock = layout.dock ?? 'none';
  widget.dataset.open = String(layout.isOpen);
  widget.dataset.solid = String(layout.isSolid);
  widget.dataset.resizable = String(layout.canResize);
  widget.dataset.resizing = String(layout.isResizing);
});

// ── Drag toward a screen edge ──
window.taskWidgetAPI.onUpdateDockPreview((preview) => {
  widget.dataset.near = preview?.edge ?? 'none';
  widget.dataset.locked = String(preview?.progress === 1);
  widget.style.setProperty('--near', (preview?.progress ?? 0).toFixed(3));
});

// ── Opacity updates ──
window.taskWidgetAPI.onUpdateOpacity((opacity) => {
  document.body.style.setProperty('--opacity', opacity.toString());
});
