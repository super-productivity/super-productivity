type WidgetGoalValueType = 'count' | 'duration';

interface WidgetTask {
  id: string;
  title: string;
  timeEstimate?: number;
  timeSpent?: number;
  isDone?: boolean;
  projectId?: string | null;
  projectTitle?: string;
  dueDay?: string | null;
  dueWithTime?: number | null;
}

interface WidgetNote {
  id: string;
  content: string;
}

interface WidgetGoal {
  id: string;
  title: string;
  value: number;
  target: number;
  valueType: WidgetGoalValueType;
  isReached: boolean;
}

interface WidgetPlannerDay {
  dayDate: string;
  tasks: WidgetTask[];
}

interface WidgetProjectGroup {
  id: string;
  title: string;
  tasks: WidgetTask[];
}

interface WidgetOverview {
  todayTasks: WidgetTask[];
  overdueTasks: WidgetTask[];
  projectTaskGroups: WidgetProjectGroup[];
  timelineTasks: WidgetTask[];
  plannerDays: WidgetPlannerDay[];
  todayNotes: WidgetNote[];
  projectNotes: WidgetNote[];
  activeContextTitle: string;
  simpleCounterGoals: WidgetGoal[];
}

type WidgetMode = 'pomodoro' | 'focus' | 'task' | 'idle';
type WidgetEdge = 'left' | 'right' | 'top' | 'bottom';

interface WidgetContentData {
  title: string;
  time: string;
  mode: WidgetMode;
}

const container = document.getElementById('task-widget-container') as HTMLDivElement;
const handleLabel = document.querySelector('.handle-label') as HTMLDivElement;
const showMainBtn = document.getElementById('show-main') as HTMLButtonElement;
const taskTitle = document.getElementById('task-title') as HTMLDivElement;
const timeDisplay = document.getElementById('time-display') as HTMLDivElement;
const quickNoteSection = document.querySelector('.quick-note-section') as HTMLDivElement;
const quickNoteToggle = document.getElementById('quick-note-toggle') as HTMLButtonElement;
const quickNote = document.getElementById('quick-note') as HTMLTextAreaElement;
const saveNoteBtn = document.getElementById('save-note') as HTMLButtonElement;
const todayPlan = document.getElementById('today-plan') as HTMLDivElement;
const upcomingPlan = document.getElementById('upcoming-plan') as HTMLDivElement;
const projectPlan = document.getElementById('project-plan') as HTMLDivElement;
const dailyGoals = document.getElementById('daily-goals') as HTMLDivElement;
const todayNotes = document.getElementById('today-notes') as HTMLDivElement;
const projectNotes = document.getElementById('project-notes') as HTMLDivElement;
const timeline = document.getElementById('timeline') as HTMLDivElement;
let latestContent: WidgetContentData = {
  title: '',
  time: '',
  mode: 'idle',
};
let latestOverview: WidgetOverview | null = null;
let isQuickNoteOpen = false;

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

document.addEventListener('mouseenter', () => {
  window.taskWidgetAPI.setPointerInside(true);
});
document.addEventListener('mouseleave', () => {
  window.taskWidgetAPI.setPointerInside(false);
});

showMainBtn.addEventListener('click', () => {
  window.taskWidgetAPI.showMainWindow();
});

const saveQuickNote = (): void => {
  const content = quickNote.value.trim();
  if (!content) {
    setQuickNoteOpen(false);
    return;
  }
  window.taskWidgetAPI.addNote(content);
  quickNote.value = '';
  setQuickNoteOpen(false);
};

const setQuickNoteOpen = (isOpen: boolean): void => {
  isQuickNoteOpen = isOpen;
  quickNoteSection.classList.toggle('is-open', isOpen);
  quickNoteToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) {
    setTimeout(() => quickNote.focus(), 0);
  }
};

quickNoteToggle.addEventListener('click', () => {
  setQuickNoteOpen(!isQuickNoteOpen);
});

saveNoteBtn.addEventListener('click', saveQuickNote);
quickNote.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault();
    saveQuickNote();
  } else if (ev.key === 'Escape' && quickNote.value.trim().length === 0) {
    ev.preventDefault();
    setQuickNoteOpen(false);
  }
});

const countOpenTasks = (tasks: WidgetTask[] | undefined): number =>
  (tasks || []).filter((task) => !task.isDone).length;

const getCompactOverviewLabel = (): string => {
  const overdueCount = countOpenTasks(latestOverview?.overdueTasks);
  if (overdueCount > 0) {
    return overdueCount > 9 ? '!9+' : `!${overdueCount}`;
  }

  const todayCount = countOpenTasks(latestOverview?.todayTasks);
  if (todayCount > 0) {
    return todayCount > 9 ? '9+' : `${todayCount}`;
  }

  return '0';
};

const updateCompactHandle = (): void => {
  const label = getCompactOverviewLabel();
  handleLabel.textContent = label;
  handleLabel.title = latestContent.title || label;
};

window.taskWidgetAPI.onUpdateContent((data) => {
  latestContent = {
    title: data.title || '',
    time: data.time || '',
    mode: data.mode || 'idle',
  };
  container.classList.remove('mode-pomodoro', 'mode-focus', 'mode-task', 'mode-idle');
  if (data.mode) {
    container.classList.add(`mode-${data.mode}`);
  }
  taskTitle.textContent = data.title || 'No active task';
  timeDisplay.textContent = data.time || '--:--';
  updateCompactHandle();
});

window.taskWidgetAPI.onUpdateOverview((overview) => {
  renderOverview(overview);
});

window.taskWidgetAPI.onUpdateOpacity((opacity) => {
  document.body.style.setProperty('--opacity', opacity.toString());
});

window.taskWidgetAPI.onCollapsedState((state) => {
  document.body.style.setProperty('--collapsed-width', `${state.collapsedWidth || 26}px`);
  document.body.classList.toggle('is-collapsed', state.isCollapsed);
  (['left', 'right', 'top', 'bottom'] as WidgetEdge[]).forEach((edge) => {
    document.body.classList.toggle(`edge-${edge}`, state.edge === edge);
  });
  updateCompactHandle();
});

const clearElement = (el: HTMLElement): void => {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
};

const appendEmpty = (el: HTMLElement, text: string): void => {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = text;
  el.appendChild(empty);
};

const formatDuration = (value: number): string => {
  const totalMinutes = Math.floor(value / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }
  return `${minutes}m`;
};

const formatClock = (value: number): string =>
  new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDay = (value: string): string => {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });
};

const getTaskMeta = (task: WidgetTask): string => {
  if (task.dueWithTime) return formatClock(task.dueWithTime);
  if (task.timeEstimate || task.timeSpent) {
    return `${formatDuration(task.timeSpent || 0)}${
      task.timeEstimate ? ` / ${formatDuration(task.timeEstimate)}` : ''
    }`;
  }
  return '';
};

const renderOverview = (overview: WidgetOverview | null): void => {
  latestOverview = overview;
  updateCompactHandle();
  if (!overview) {
    renderTodayPlan([], []);
    renderPlannerDays([]);
    renderProjectGroups([]);
    renderGoals([]);
    renderNotes(todayNotes, [], 'No pinned notes');
    renderNotes(projectNotes, [], 'No project notes');
    renderTimeline([]);
    return;
  }

  renderTodayPlan(overview.overdueTasks || [], overview.todayTasks || []);
  renderPlannerDays(overview.plannerDays || []);
  renderProjectGroups(overview.projectTaskGroups || []);
  renderGoals(overview.simpleCounterGoals || []);
  renderNotes(todayNotes, overview.todayNotes || [], 'No pinned notes');
  renderNotes(projectNotes, overview.projectNotes || [], 'No project notes');
  renderTimeline(overview.timelineTasks || []);
};

const appendSubHeading = (el: HTMLElement, text: string): void => {
  const heading = document.createElement('div');
  heading.className = 'sub-heading';
  heading.textContent = text;
  el.appendChild(heading);
};

const appendTaskRows = (target: HTMLElement, tasks: WidgetTask[]): void => {
  tasks.forEach((task) => {
    target.appendChild(createTaskRow(task));
  });
};

const renderTodayPlan = (overdueTasks: WidgetTask[], todayTasks: WidgetTask[]): void => {
  clearElement(todayPlan);
  if (!overdueTasks.length && !todayTasks.length) {
    appendEmpty(todayPlan, 'No plan for today');
    return;
  }

  if (overdueTasks.length) {
    appendSubHeading(todayPlan, 'Overdue');
    appendTaskRows(todayPlan, overdueTasks);
  }

  if (todayTasks.length) {
    appendSubHeading(todayPlan, 'Today');
    appendTaskRows(todayPlan, todayTasks);
  }
};

const createTaskRow = (task: WidgetTask): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'task-row';
  row.classList.toggle('is-done', !!task.isDone);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!task.isDone;
  checkbox.addEventListener('change', () => {
    window.taskWidgetAPI.toggleTaskDone(task.id, checkbox.checked);
  });

  const title = document.createElement('button');
  title.className = 'task-title-button';
  title.type = 'button';
  title.textContent = task.title;
  title.addEventListener('click', () => window.taskWidgetAPI.switchTask(task.id));

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  meta.textContent = getTaskMeta(task);

  row.appendChild(checkbox);
  row.appendChild(title);
  row.appendChild(meta);
  return row;
};

const renderProjectGroups = (groups: WidgetProjectGroup[]): void => {
  clearElement(projectPlan);
  if (!groups.length) {
    appendEmpty(projectPlan, 'No project tasks');
    return;
  }

  groups.forEach((group) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'project-group';

    const title = document.createElement('h3');
    title.textContent = group.title;
    wrapper.appendChild(title);

    const list = document.createElement('div');
    list.className = 'task-list';
    group.tasks.forEach((task) => list.appendChild(createTaskRow(task)));
    wrapper.appendChild(list);

    projectPlan.appendChild(wrapper);
  });
};

const renderPlannerDays = (days: WidgetPlannerDay[]): void => {
  clearElement(upcomingPlan);
  const upcomingDays = days.slice(1).filter((day) => day.tasks.length > 0);
  if (!upcomingDays.length) {
    appendEmpty(upcomingPlan, 'No upcoming plan');
    return;
  }

  upcomingDays.forEach((day) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'planner-day-group';

    const title = document.createElement('h3');
    title.textContent = formatDay(day.dayDate);
    wrapper.appendChild(title);

    const list = document.createElement('div');
    list.className = 'task-list';
    day.tasks.forEach((task) => list.appendChild(createTaskRow(task)));
    wrapper.appendChild(list);

    upcomingPlan.appendChild(wrapper);
  });
};

const renderNotes = (
  target: HTMLElement,
  notes: WidgetNote[],
  emptyText: string,
): void => {
  clearElement(target);
  if (!notes.length) {
    appendEmpty(target, emptyText);
    return;
  }

  notes.forEach((note) => {
    const row = document.createElement('div');
    row.className = 'note-row';
    row.textContent = note.content;
    target.appendChild(row);
  });
};

const formatGoalValue = (goal: WidgetGoal): string => {
  if (goal.valueType === 'duration') {
    return `${formatDuration(goal.value)} / ${formatDuration(goal.target)}`;
  }
  return `${goal.value} / ${goal.target}`;
};

const renderGoals = (goals: WidgetGoal[]): void => {
  clearElement(dailyGoals);
  if (!goals.length) {
    appendEmpty(dailyGoals, 'No daily goals');
    return;
  }

  goals.forEach((goal) => {
    const row = document.createElement('div');
    row.className = 'goal-row';
    row.classList.toggle('is-done', goal.isReached);

    const title = document.createElement('div');
    title.className = 'goal-title';
    title.textContent = goal.title;

    const value = document.createElement('div');
    value.className = 'task-meta';
    value.textContent = formatGoalValue(goal);

    row.appendChild(title);
    row.appendChild(value);
    dailyGoals.appendChild(row);
  });
};

const renderTimeline = (tasks: WidgetTask[]): void => {
  clearElement(timeline);
  if (!tasks.length) {
    appendEmpty(timeline, 'No timed tasks today');
    return;
  }

  tasks.forEach((task) => {
    const row = document.createElement('div');
    row.className = 'timeline-row';

    const time = document.createElement('div');
    time.className = 'timeline-time';
    time.textContent = task.dueWithTime ? formatClock(task.dueWithTime) : '--:--';

    const title = document.createElement('button');
    title.className = 'timeline-title';
    title.type = 'button';
    title.textContent = task.title;
    title.addEventListener('click', () => window.taskWidgetAPI.switchTask(task.id));

    row.appendChild(time);
    row.appendChild(title);
    timeline.appendChild(row);
  });
};

renderOverview(null);
updateCompactHandle();
