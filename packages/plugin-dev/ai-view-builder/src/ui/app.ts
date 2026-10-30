import {
  PluginHooks,
  type ActiveWorkContext,
  type PluginAPI,
  type PluginDayContext,
  type Project,
  type Tag,
  type Task,
} from '@super-productivity/plugin-api';
import { emptySpec, isReadOnlySpec, ViewSpec } from '../core/spec';
import { buildModel, ModelEnv, specNeedsArchive } from '../core/model';
import { dropWrite } from '../core/board';
import { EditError, MODELS, runEdit } from '../core/edit-loop';
import { matchViewByName, parseLocalCommand } from '../core/commands';
import { renderView } from './render';
import { enableBoardDrag } from './drag';
import { isOnDevice, isVoiceSupported, listen } from './voice';
import {
  deleteView,
  loadSettings,
  loadViews,
  newViewId,
  saveSettings,
  saveView,
  Settings,
  StoredView,
} from './store';

declare const PluginAPI: PluginAPI;

const SUGGESTIONS: { label: string; request: string }[] = [
  {
    label: 'Kanban board',
    request: 'A kanban board with To do, Doing and Done for what I have open.',
  },
  {
    label: 'Eisenhower matrix',
    request:
      'An Eisenhower matrix of my open tasks, using the tags Urgent and Important.',
  },
  {
    label: 'Today, by project',
    request:
      "Today's open tasks grouped by project, with how much time I tracked today at the top.",
  },
  {
    label: 'Weekly review',
    request:
      'A weekly review: time spent and tasks done this week at the top, then what I finished this week grouped by project, then what is overdue.',
  },
];

// ---------- DOM ----------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const ui = {
  viewSelect: $<HTMLSelectElement>('viewSelect'),
  newViewBtn: $<HTMLButtonElement>('newViewBtn'),
  undoBtn: $<HTMLButtonElement>('undoBtn'),
  redoBtn: $<HTMLButtonElement>('redoBtn'),
  settingsBtn: $<HTMLButtonElement>('settingsBtn'),
  settingsPanel: $('settingsPanel'),
  apiKeyInput: $<HTMLInputElement>('apiKeyInput'),
  saveKeyBtn: $<HTMLButtonElement>('saveKeyBtn'),
  clearKeyBtn: $<HTMLButtonElement>('clearKeyBtn'),
  keyStatus: $('keyStatus'),
  modelSelect: $<HTMLSelectElement>('modelSelect'),
  deleteViewBtn: $<HTMLButtonElement>('deleteViewBtn'),
  commandForm: $<HTMLFormElement>('commandForm'),
  micBtn: $<HTMLButtonElement>('micBtn'),
  commandInput: $<HTMLInputElement>('commandInput'),
  sendBtn: $<HTMLButtonElement>('sendBtn'),
  stopBtn: $<HTMLButtonElement>('stopBtn'),
  selectionChip: $('selectionChip'),
  hint: $('hint'),
  status: $('status'),
  suggestions: $('suggestions'),
  view: $('view'),
};

// ---------- state ----------

const state = {
  settings: { model: MODELS[0].id } as Settings,
  views: [] as StoredView[],
  current: null as StoredView | null,
  isDraft: false,
  preview: null as ViewSpec | null,
  selectedId: null as string | null,
  editing: null as AbortController | null,
  listening: null as { stop: () => void } | null,
  undo: new Map<string, ViewSpec[]>(),
  redo: new Map<string, ViewSpec[]>(),
  env: null as ModelEnv | null,
  archive: null as { tasks: Task[]; at: number } | null,
  lastRendered: '',
};

const canTrack = typeof PluginAPI.startTracking === 'function';

// ---------- status ----------

const setStatus = (text: string, isError = false): void => {
  ui.status.textContent = text;
  ui.status.classList.toggle('is-error', isError);
};

const setBusy = (busy: boolean): void => {
  ui.sendBtn.hidden = busy;
  ui.stopBtn.hidden = !busy;
  ui.commandInput.disabled = busy;
  ui.micBtn.disabled = busy;
  ui.newViewBtn.disabled = busy;
  ui.viewSelect.disabled = busy;
  ui.view.setAttribute('aria-busy', String(busy));
};

// ---------- data ----------

const fallbackDay = (): PluginDayContext => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    todayStr: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    startOfNextDayDiffMs: 0,
    firstDayOfWeek: 1,
  };
};

const activeSpec = (): ViewSpec | null => state.preview ?? state.current?.spec ?? null;

const loadEnv = async (): Promise<void> => {
  const [tasks, projects, tags, context, day, currentTaskId] = await Promise.all([
    PluginAPI.getTasks(),
    PluginAPI.getAllProjects() as Promise<Project[]>,
    PluginAPI.getAllTags() as Promise<Tag[]>,
    PluginAPI.getActiveWorkContext() as Promise<ActiveWorkContext | null>,
    PluginAPI.getDayContext ? PluginAPI.getDayContext() : Promise.resolve(fallbackDay()),
    PluginAPI.getCurrentTaskId ? PluginAPI.getCurrentTaskId() : Promise.resolve(null),
  ]);
  const spec = activeSpec();
  let archivedTasks: Task[] | undefined;
  if (spec && specNeedsArchive(spec)) {
    // The archive is large and changes only on Finish Day; reuse it for a minute.
    if (!state.archive || Date.now() - state.archive.at > 60_000) {
      state.archive = { tasks: await PluginAPI.getArchivedTasks(), at: Date.now() };
    }
    archivedTasks = state.archive.tasks;
  }
  state.env = { tasks, projects, tags, context, day, currentTaskId, archivedTasks };
};

// ---------- rendering ----------

const render = (animate: boolean, force = false): void => {
  const spec = activeSpec();
  ui.suggestions.hidden = !!spec?.root || !!state.editing;
  if (!spec || !state.env) {
    renderView(ui.view, null, { selectedId: null, canTrack, animate: false });
    state.lastRendered = '';
    return;
  }
  const model = buildModel(spec, state.env);
  // The tracked task updates once a second; skip redraws that change nothing.
  const signature = JSON.stringify([model, state.selectedId]);
  if (!force && signature === state.lastRendered) return;
  state.lastRendered = signature;
  renderView(ui.view, model, { selectedId: state.selectedId, canTrack, animate });
};

const renderChrome = (): void => {
  ui.viewSelect.textContent = '';
  if (state.isDraft || !state.current) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'New view';
    ui.viewSelect.appendChild(option);
  }
  for (const view of state.views) {
    const option = document.createElement('option');
    option.value = view.id;
    option.textContent = view.spec.title;
    ui.viewSelect.appendChild(option);
  }
  ui.viewSelect.value = state.isDraft || !state.current ? '' : state.current.id;
  const id = state.current?.id ?? '';
  ui.undoBtn.disabled = !state.undo.get(id)?.length;
  ui.redoBtn.disabled = !state.redo.get(id)?.length;
  ui.deleteViewBtn.disabled = state.isDraft || !state.current;
  const selected = state.selectedId && activeSpec()?.components[state.selectedId];
  ui.selectionChip.hidden = !selected;
  ui.selectionChip.textContent = selected
    ? `Changing: ${selected.title || state.selectedId} ✕`
    : '';
  const readOnly = !!state.current && isReadOnlySpec(state.current.spec);
  ui.commandInput.placeholder = readOnly
    ? 'This view needs a newer version of the plugin to change.'
    : state.current?.spec.root
      ? 'Say or type what to change…'
      : 'Describe the view you want…';
  ui.commandInput.disabled = readOnly || !!state.editing;
};

const showView = (view: StoredView | null, isDraft = false): void => {
  state.current = view;
  state.isDraft = isDraft;
  state.selectedId = null;
  try {
    if (view && !isDraft) localStorage.setItem('ai-view-builder:last', view.id);
  } catch {
    // Remembering the last view is a per-device convenience.
  }
  renderChrome();
  void loadEnv().then(() => render(false, true));
};

const startDraft = (): void => {
  showView({ id: newViewId(), spec: emptySpec(), requests: [], updatedAt: 0 }, true);
  ui.commandInput.focus();
};

// ---------- editing ----------

const getApiKey = async (): Promise<string | null> => {
  const result = (await sendToBackground({ type: 'getApiKey' }).catch(() => null)) as {
    apiKey?: string | null;
  } | null;
  return result?.apiKey ?? null;
};

const webFetch: typeof fetch = (input, init) => {
  // On mobile, CapacitorHttp replaces fetch with a native call that buffers
  // the whole response; CapacitorWebFetch is the WebView's own, which streams.
  const w = window as unknown as { CapacitorWebFetch?: typeof fetch };
  return (w.CapacitorWebFetch ?? window.fetch).call(window, input, init);
};

const pushHistory = (map: Map<string, ViewSpec[]>, id: string, spec: ViewSpec): void => {
  const list = map.get(id) ?? [];
  list.push(spec);
  map.set(id, list.slice(-30));
};

const commitSpec = async (spec: ViewSpec, request?: string): Promise<void> => {
  const view = state.current!;
  view.spec = spec;
  if (request) view.requests = [...view.requests, request];
  if (state.isDraft) {
    state.views = [...state.views, view].sort((a, b) =>
      a.spec.title.localeCompare(b.spec.title),
    );
    state.isDraft = false;
  }
  await saveView(view);
  try {
    localStorage.setItem('ai-view-builder:last', view.id);
  } catch {
    // Per-device convenience only.
  }
};

const runLocalCommand = async (text: string): Promise<boolean> => {
  const cmd = parseLocalCommand(text);
  if (!cmd) return false;
  ui.commandInput.value = '';
  if (cmd.kind === 'undo' || cmd.kind === 'redo') {
    await undoRedo(cmd.kind);
  } else if (cmd.kind === 'newView') {
    startDraft();
    setStatus('Describe the new view.');
  } else {
    const match = matchViewByName(
      state.views.map((v) => ({ ...v, title: v.spec.title })),
      cmd.name,
    );
    if (!match) return false;
    showView(state.views.find((v) => v.id === match.id) ?? null);
    setStatus(`Showing ${match.spec.title}.`);
  }
  return true;
};

const submit = async (raw: string): Promise<void> => {
  const text = raw.trim();
  if (!text || state.editing) return;
  if (await runLocalCommand(text)) return;
  const apiKey = await getApiKey();
  if (!apiKey) {
    ui.settingsPanel.hidden = false;
    setStatus('Add your Anthropic API key in Settings first.', true);
    return;
  }
  if (!state.current) startDraft();
  const base = state.current!.spec;
  const controller = new AbortController();
  state.editing = controller;
  setBusy(true);
  renderChrome();
  setStatus(base.root ? 'Changing the view…' : 'Building your view…');
  try {
    await loadEnv();
    const result = await runEdit({
      fetchFn: webFetch,
      apiKey,
      model: state.settings.model,
      spec: base,
      selectedId: state.selectedId,
      request: text,
      signal: controller.signal,
      onStep: ({ spec }) => {
        state.preview = spec;
        render(true);
      },
    });
    if (!result.spec.root) {
      throw new EditError(
        result.text || 'Nothing was built. Try describing the view differently.',
      );
    }
    pushHistory(state.undo, state.current!.id, base);
    state.redo.delete(state.current!.id);
    state.preview = null;
    await commitSpec(result.spec, text);
    if (state.selectedId && !result.spec.components[state.selectedId])
      state.selectedId = null;
    ui.commandInput.value = '';
    setStatus(result.say || result.text || 'Done.');
    await loadEnv();
    render(true, true);
  } catch (e) {
    state.preview = null;
    render(true, true);
    const aborted = (e as Error)?.name === 'AbortError';
    setStatus(
      aborted
        ? 'Stopped. The view is as it was.'
        : ((e as Error)?.message ?? 'Something went wrong.'),
      !aborted,
    );
  } finally {
    state.editing = null;
    setBusy(false);
    renderChrome();
  }
};

const undoRedo = async (kind: 'undo' | 'redo'): Promise<void> => {
  const view = state.current;
  if (!view || state.isDraft) return;
  const from = kind === 'undo' ? state.undo : state.redo;
  const to = kind === 'undo' ? state.redo : state.undo;
  const previous = from.get(view.id)?.pop();
  if (!previous) {
    setStatus(kind === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
    return;
  }
  pushHistory(to, view.id, view.spec);
  await commitSpec(previous);
  state.selectedId = null;
  setStatus(kind === 'undo' ? 'Undone.' : 'Redone.');
  renderChrome();
  await loadEnv();
  render(true, true);
};

// ---------- task actions (user gestures; the model never writes tasks) ----------

const patchTask = (id: string, changes: Partial<Task>): void => {
  if (!state.env) return;
  state.env = {
    ...state.env,
    tasks: state.env.tasks.map((t) => (t.id === id ? { ...t, ...changes } : t)),
  };
};

const withRollback = async (action: () => Promise<unknown>): Promise<void> => {
  try {
    await action();
  } catch (e) {
    setStatus((e as Error)?.message ?? 'That did not work.', true);
    await loadEnv();
    render(true);
  }
};

const toggleDone = (taskId: string): void => {
  const task = state.env?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  patchTask(taskId, { isDone: !task.isDone });
  render(true);
  void withRollback(() => PluginAPI.updateTask(taskId, { isDone: !task.isDone }));
};

const toggleTracking = (taskId: string): void => {
  if (!state.env || !canTrack) return;
  const isTracking = state.env.currentTaskId === taskId;
  state.env = { ...state.env, currentTaskId: isTracking ? null : taskId };
  render(true);
  void withRollback(() =>
    isTracking ? PluginAPI.stopTracking!() : PluginAPI.startTracking!(taskId),
  );
};

const dropInto = async (
  taskId: string,
  boardCid: string,
  columnId: string,
): Promise<void> => {
  const spec = activeSpec();
  const env = state.env;
  const board = spec?.components[boardCid];
  const column = board?.columns?.find((c) => c.id === columnId);
  const task = env?.tasks.find((t) => t.id === taskId);
  if (!env || !column || !task) return;
  if (task.parentId) {
    setStatus(
      'Subtasks follow their parent task and cannot be moved on their own.',
      true,
    );
    return;
  }
  let write = dropWrite(task, column, env.tags);
  if (!write) return;
  await withRollback(async () => {
    for (const title of write!.missingTags) {
      const id = await PluginAPI.addTag({ title });
      state.env!.tags = [
        ...state.env!.tags,
        { id, title, taskIds: [] } as unknown as Tag,
      ];
    }
    write = dropWrite(task, column, state.env!.tags);
    if (!write || !Object.keys(write.changes).length) return;
    patchTask(taskId, write.changes);
    render(true);
    await PluginAPI.updateTask(taskId, write.changes);
  });
};

const moveWithKeyboard = (cardEl: HTMLElement, direction: -1 | 1): void => {
  const colEl = cardEl.closest<HTMLElement>('.board-col');
  const boardCid = colEl?.dataset.boardCid;
  const columns = boardCid ? activeSpec()?.components[boardCid]?.columns : undefined;
  if (!colEl || !boardCid || !columns) return;
  const index = columns.findIndex((c) => c.id === colEl.dataset.colId);
  const next = columns[index + direction];
  if (next) {
    void dropInto(cardEl.dataset.tid!, boardCid, next.id).then(() => {
      ui.view
        .querySelector<HTMLElement>(`[data-tid="${CSS.escape(cardEl.dataset.tid!)}"]`)
        ?.focus();
    });
  }
};

// ---------- background messaging ----------

const sendToBackground = (message: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const messageId = `avb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent || event.data?.messageId !== messageId) return;
      cleanup();
      if (event.data.type === 'PLUGIN_MESSAGE_RESPONSE') resolve(event.data.result);
      else reject(new Error(event.data.error || 'Background error'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('The plugin background did not answer'));
    }, 10_000);
    const cleanup = (): void => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'PLUGIN_MESSAGE', messageId, message }, '*');
  });

const refreshKeyStatus = async (): Promise<boolean> => {
  const hasKey = !!(await getApiKey());
  ui.keyStatus.textContent = hasKey ? 'A key is saved on this device.' : 'No key saved.';
  ui.clearKeyBtn.disabled = !hasKey;
  return hasKey;
};

// ---------- voice ----------

const toggleListening = async (): Promise<void> => {
  if (state.listening) {
    state.listening.stop();
    return;
  }
  const lang = PluginAPI.getCurrentLanguage?.() || navigator.language || 'en';
  const onDevice = await isOnDevice(lang);
  if (!onDevice && !state.settings.voiceConsent) {
    const ok = window.confirm(
      'Your browser sends what you say to its speech service (for example Google for Chrome, Apple for Safari) to turn it into text. Continue?',
    );
    if (!ok) return;
    state.settings = { ...state.settings, voiceConsent: true };
    void saveSettings(state.settings);
  }
  ui.micBtn.classList.add('is-listening');
  ui.micBtn.setAttribute('aria-pressed', 'true');
  setStatus('Listening…');
  state.listening = listen(lang, onDevice, {
    onInterim: (text) => {
      ui.commandInput.value = text;
    },
    onFinal: (text) => {
      ui.commandInput.value = text;
      void submit(text);
    },
    onError: (message) => setStatus(message, true),
    onEnd: () => {
      state.listening = null;
      ui.micBtn.classList.remove('is-listening');
      ui.micBtn.setAttribute('aria-pressed', 'false');
      if (ui.status.textContent === 'Listening…') setStatus('');
    },
  });
};

// ---------- events ----------

ui.commandForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void submit(ui.commandInput.value);
});
ui.stopBtn.addEventListener('click', () => state.editing?.abort());
ui.micBtn.addEventListener('click', () => void toggleListening());
ui.newViewBtn.addEventListener('click', () => startDraft());
ui.undoBtn.addEventListener('click', () => void undoRedo('undo'));
ui.redoBtn.addEventListener('click', () => void undoRedo('redo'));
ui.settingsBtn.addEventListener('click', () => {
  ui.settingsPanel.hidden = !ui.settingsPanel.hidden;
});
ui.viewSelect.addEventListener('change', () => {
  const view = state.views.find((v) => v.id === ui.viewSelect.value);
  if (view) showView(view);
});
ui.selectionChip.addEventListener('click', () => {
  state.selectedId = null;
  renderChrome();
  render(false);
});
ui.saveKeyBtn.addEventListener('click', async () => {
  const apiKey = ui.apiKeyInput.value.trim();
  if (!apiKey) return;
  try {
    await sendToBackground({ type: 'setApiKey', apiKey });
    ui.apiKeyInput.value = '';
    await refreshKeyStatus();
    ui.settingsPanel.hidden = true;
    setStatus('Key saved. Describe the view you want.');
    ui.commandInput.focus();
  } catch (e) {
    ui.keyStatus.textContent = (e as Error).message;
  }
});
ui.clearKeyBtn.addEventListener('click', async () => {
  await sendToBackground({ type: 'clearApiKey' }).catch(() => null);
  await refreshKeyStatus();
});
ui.modelSelect.addEventListener('change', () => {
  state.settings = { ...state.settings, model: ui.modelSelect.value };
  void saveSettings(state.settings);
});
ui.deleteViewBtn.addEventListener('click', async () => {
  const view = state.current;
  if (!view || state.isDraft || !window.confirm(`Delete the view "${view.spec.title}"?`))
    return;
  await deleteView(view.id);
  state.views = state.views.filter((v) => v.id !== view.id);
  state.undo.delete(view.id);
  state.redo.delete(view.id);
  if (state.views[0]) showView(state.views[0]);
  else startDraft();
  ui.settingsPanel.hidden = true;
});

ui.view.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const taskId = target.closest<HTMLElement>('[data-tid]')?.dataset.tid;
  switch (target.dataset.action) {
    case 'done':
      if (taskId) toggleDone(taskId);
      break;
    case 'track':
      if (taskId) toggleTracking(taskId);
      break;
    case 'open':
      if (taskId) void PluginAPI.selectTask(taskId);
      break;
    case 'select': {
      const cid = target.dataset.cid ?? null;
      state.selectedId = state.selectedId === cid ? null : cid;
      renderChrome();
      render(false);
      if (state.selectedId) ui.commandInput.focus();
      break;
    }
  }
});

ui.view.addEventListener('keydown', (e) => {
  const cardEl = (e.target as HTMLElement).closest<HTMLElement>(
    '[data-draggable="true"]',
  );
  if (cardEl && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    moveWithKeyboard(cardEl, e.key === 'ArrowLeft' ? -1 : 1);
  }
});

document.addEventListener('keydown', (e) => {
  const inInput =
    e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (e.key === 'Escape' && state.selectedId) {
    state.selectedId = null;
    renderChrome();
    render(false);
  } else if (!inInput && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    void undoRedo(e.shiftKey ? 'redo' : 'undo');
  }
});

enableBoardDrag(ui.view, (taskId, boardCid, columnId) => {
  void dropInto(taskId, boardCid, columnId);
});

// ---------- hooks ----------

let refreshTimer: number | undefined;
const scheduleRefresh = (): void => {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(async () => {
    await loadEnv();
    render(true);
  }, 30);
};

const hostHooks = Object.values(PluginAPI.Hooks ?? {}) as string[];
if (hostHooks.includes(PluginHooks.DATA_CHANGED)) {
  PluginAPI.registerHook(PluginHooks.DATA_CHANGED, scheduleRefresh);
} else {
  // Older hosts: local task and project changes only.
  PluginAPI.registerHook(PluginHooks.ANY_TASK_UPDATE, scheduleRefresh);
  PluginAPI.registerHook(PluginHooks.PROJECT_LIST_UPDATE, scheduleRefresh);
}
if (hostHooks.includes(PluginHooks.DAY_CHANGE)) {
  PluginAPI.registerHook(PluginHooks.DAY_CHANGE, scheduleRefresh);
}
PluginAPI.registerHook(PluginHooks.WORK_CONTEXT_CHANGE, scheduleRefresh);
PluginAPI.registerHook(PluginHooks.CURRENT_TASK_CHANGE, (payload) => {
  if (!state.env) return;
  const current = (payload as { current?: { id?: string } | null })?.current;
  state.env = { ...state.env, currentTaskId: current?.id ?? null };
  render(true);
});
PluginAPI.registerHook(PluginHooks.PERSISTED_DATA_CHANGED, async () => {
  if (state.editing) return;
  const views = await loadViews();
  state.views = views;
  const fresh = state.current && views.find((v) => v.id === state.current!.id);
  if (
    fresh &&
    !state.isDraft &&
    JSON.stringify(fresh.spec) !== JSON.stringify(state.current!.spec)
  ) {
    state.current = fresh;
    render(true, true);
  } else if (state.current && !state.isDraft && !fresh) {
    if (views[0]) showView(views[0]);
    else startDraft();
  }
  renderChrome();
});

// ---------- start ----------

for (const s of SUGGESTIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = s.label;
  button.addEventListener('click', () => {
    ui.commandInput.value = s.request;
    void submit(s.request);
  });
  ui.suggestions.appendChild(button);
}
for (const m of MODELS) {
  const option = document.createElement('option');
  option.value = m.id;
  option.textContent = m.label;
  ui.modelSelect.appendChild(option);
}

const platform = PluginAPI.cfg?.platform ?? 'web';
ui.micBtn.hidden = !isVoiceSupported(platform);
if (ui.micBtn.hidden) {
  ui.hint.textContent =
    platform === 'desktop'
      ? "Tip: speak instead of typing with your system's dictation (macOS: press Fn twice; Windows: Win+H)."
      : platform === 'web'
        ? ''
        : 'Tip: use the microphone on your keyboard to speak instead of typing.';
}

void (async () => {
  const [settings, views, hasKey] = await Promise.all([
    loadSettings(),
    loadViews(),
    refreshKeyStatus(),
  ]);
  state.settings = settings;
  state.views = views;
  ui.modelSelect.value = settings.model;
  let lastId: string | null = null;
  try {
    lastId = localStorage.getItem('ai-view-builder:last');
  } catch {
    lastId = null;
  }
  const initial = views.find((v) => v.id === lastId) ?? views[0] ?? null;
  if (initial) showView(initial);
  else startDraft();
  if (!hasKey) {
    ui.settingsPanel.hidden = false;
    setStatus('Add your Anthropic API key in Settings to start.');
  }
})();
