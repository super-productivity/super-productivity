const api = window.menuBarPanel;

const panelEl = document.getElementById('panel') as HTMLDivElement;
const todayLabelEl = document.getElementById('today-label') as HTMLParagraphElement;
const currentCardEl = document.getElementById('current-card') as HTMLElement;
const currentToggleEl = document.getElementById('current-toggle') as HTMLButtonElement;
const currentTitleEl = document.getElementById('current-title') as HTMLParagraphElement;
const currentTimeEl = document.getElementById('current-time') as HTMLSpanElement;
const taskListEl = document.getElementById('task-list') as HTMLElement;
const taskCountEl = document.getElementById('task-count') as HTMLSpanElement;
const emptyStateEl = document.getElementById('empty-state') as HTMLParagraphElement;
const addFormEl = document.getElementById('add-form') as HTMLFormElement;
const addInputEl = document.getElementById('add-input') as HTMLInputElement;
const addButtonEl = document.getElementById('add-button') as HTMLButtonElement;

const EMPTY_STATE: MenuBarPanelState = {
  todayTasks: [],
  currentTask: null,
  isRunning: false,
  isFocusModeEnabled: false,
  focusSessionTime: 0,
};

let state: MenuBarPanelState = { ...EMPTY_STATE };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

const toTask = (value: unknown): MenuBarPanelTask | null => {
  if (!isRecord(value)) return null;
  const { id, title, timeEstimate, timeSpent } = value;
  if (typeof id !== 'string' || typeof title !== 'string') return null;
  return {
    id,
    title,
    ...(typeof timeEstimate === 'number' ? { timeEstimate } : {}),
    ...(typeof timeSpent === 'number' ? { timeSpent } : {}),
  };
};

const parseState = (value: unknown): MenuBarPanelState => {
  if (!isRecord(value)) return { ...EMPTY_STATE };
  const todayTasks = Array.isArray(value.todayTasks)
    ? value.todayTasks
        .map(toTask)
        .filter((task): task is MenuBarPanelTask => task !== null)
    : [];
  return {
    todayTasks,
    currentTask: toTask(value.currentTask),
    isRunning: value.isRunning === true,
    isFocusModeEnabled: value.isFocusModeEnabled === true,
    focusSessionTime:
      typeof value.focusSessionTime === 'number' ? value.focusSessionTime : 0,
    ...(typeof value.focusModeMode === 'string'
      ? { focusModeMode: value.focusModeMode }
      : {}),
  };
};

const formatDuration = (ms?: number): string => {
  if (!ms || ms <= 0) return '';
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(totalMinutes, 1)}m`;
};

const applyTodayLabel = (): void => {
  todayLabelEl.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const renderCurrentTask = (): void => {
  const task = state.currentTask;
  if (!task) {
    currentCardEl.hidden = true;
    return;
  }
  currentCardEl.hidden = false;
  currentTitleEl.textContent = task.title;
  currentToggleEl.classList.toggle('is-paused', !state.isRunning);
  currentToggleEl.setAttribute(
    'aria-label',
    state.isRunning ? 'Pause current task' : 'Resume current task',
  );

  const elapsed =
    state.isFocusModeEnabled && state.focusSessionTime > 0
      ? state.focusSessionTime
      : task.timeSpent;
  currentTimeEl.textContent = formatDuration(elapsed);
};

const createTaskRow = (task: MenuBarPanelTask, isCurrent: boolean): HTMLElement => {
  const row = document.createElement('div');
  row.className = isCurrent ? 'task-row is-current' : 'task-row';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'task-main';
  main.title = isCurrent ? 'Pause task' : 'Start task';
  main.addEventListener('click', () => api.toggleTask(task.id));

  const status = document.createElement('span');
  status.className = 'task-status';
  status.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;

  const time = document.createElement('span');
  time.className = 'task-time';
  time.textContent = formatDuration(task.timeEstimate) || formatDuration(task.timeSpent);

  main.append(status, title, time);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'task-done';
  done.title = 'Mark as done';
  done.setAttribute('aria-label', `Mark "${task.title}" as done`);
  done.textContent = '✓';
  done.addEventListener('click', (event) => {
    event.stopPropagation();
    api.completeTask(task.id);
  });

  row.append(main, done);
  return row;
};

const renderTaskList = (): void => {
  const currentId = state.currentTask?.id ?? null;
  taskListEl.replaceChildren();

  for (const task of state.todayTasks) {
    taskListEl.append(createTaskRow(task, task.id === currentId));
  }

  const total = state.todayTasks.length;
  taskCountEl.textContent = total === 1 ? '1 task' : `${total} tasks`;
  emptyStateEl.hidden = total > 0;
  if (total === 0) {
    taskListEl.append(emptyStateEl);
  }
};

const render = (): void => {
  renderCurrentTask();
  renderTaskList();
};

const syncAddButton = (): void => {
  addButtonEl.disabled = addInputEl.value.trim().length === 0;
};

addInputEl.addEventListener('input', syncAddButton);

addFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = addInputEl.value.trim();
  if (!title) return;
  api.addTask(title);
  addInputEl.value = '';
  syncAddButton();
});

document.getElementById('open-app')?.addEventListener('click', () => api.showApp());
document.getElementById('open-hint')?.addEventListener('click', () => api.showApp());
currentToggleEl.addEventListener('click', () => {
  if (state.currentTask) api.toggleTask(state.currentTask.id);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    api.hide();
  }
});

window.addEventListener('focus', () => {
  if (document.activeElement !== addInputEl) {
    addInputEl.focus();
  }
});

panelEl.addEventListener('pointerdown', (event) => {
  if (event.target === panelEl) {
    addInputEl.blur();
  }
});

api.onState((nextState) => {
  state = parseState(nextState);
  render();
});

void api.getState().then((initialState) => {
  state = parseState(initialState);
  applyTodayLabel();
  render();
  syncAddButton();
});

applyTodayLabel();
syncAddButton();
