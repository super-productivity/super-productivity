// The AI Command panel: ask, review, apply. Views are re-rendered from
// `state`. Settings persist via plugin.js; the view is only kept there in
// memory, so closing and reopening the panel shows it again.

import { PluginHooks } from '@super-productivity/plugin-api';
import { applyRows } from '../core/apply';
import { canAddToToday } from '../core/day';
import { ask, type AskResult } from '../core/ask';
import { canApplyWithoutReview } from '../core/auto-apply';
import { errorMessage } from '../core/claude';
import { buildContext } from '../core/context';
import type { Settings } from '../core/settings';
import type { AppliedRow, TaskLike } from '../core/types';
import {
  getApiKey,
  getHostState,
  host,
  readSnapshot,
  requestFn,
  sendToBackground,
  writeApi,
  type HostState,
} from './bridge';
import { button, el } from './dom';
import { renderApplied } from './render-applied';
import { renderResult } from './render-result';
import { renderSetup } from './render-setup';
import { dictationHint } from './dictation';

type View =
  | { kind: 'boot' }
  | { kind: 'setup'; isFirstRun: boolean }
  | { kind: 'idle'; note?: string }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; result: AskResult; ticked: Set<string>; picked: Set<string> }
  | { kind: 'applied'; rows: AppliedRow[]; isWithoutReview: boolean; say: string | null };

const state: {
  view: View;
  host: HostState | null;
  token: number;
  isBusy: boolean;
  /** Current tasks, re-read after a row action so the rows show its effect. */
  live: Map<string, TaskLike>;
} = {
  view: { kind: 'boot' },
  host: null,
  token: 0,
  isBusy: false,
  live: new Map(),
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('input');
const body = $<HTMLElement>('body');
const footer = $<HTMLElement>('footer');

const showError = (err: unknown): void => {
  host().showSnack({
    msg: err instanceof Error ? err.message : String(err),
    type: 'ERROR',
  });
};

/** Views shown again on reopen. Loading can't resume in a new panel; after an
 * error the kept text is enough to retry. */
const isKept = (view: View): boolean =>
  // Mid-apply, a kept result could be applied twice after a reopen.
  (view.kind === 'result' && !state.isBusy) ||
  view.kind === 'applied' ||
  (view.kind === 'idle' && !!view.note);

// postMessage clones structurally, so the Sets and Maps in a result survive.
const savePanel = (patch: { view?: View | null; text?: string }): void => {
  sendToBackground({ type: 'savePanel', panel: patch }).catch((err: unknown) =>
    // Losing the kept view only costs a reopen; a snack would be noise.
    console.warn('AI Command: could not keep the panel state', err),
  );
};

const saveView = (): void =>
  savePanel({ view: isKept(state.view) ? state.view : null, text: input.value });

const setView = (view: View): void => {
  state.view = view;
  render();
  saveView();
};

/** Ids of the selection on screen: the "these" of the next request. Picked rows narrow it. */
const selectionIds = (): string[] => {
  const view = state.view;
  if (view.kind !== 'result') return [];
  const all = view.result.proposal.selection?.items.map((i) => i.taskId) ?? [];
  const picked = all.filter((id) => view.picked.has(id));
  return picked.length ? picked : all;
};

const readLive = async (): Promise<Map<string, TaskLike>> =>
  new Map((await writeApi.getTasks()).map((t) => [t.id, t]));

const refreshLive = async (): Promise<void> => {
  state.live = await readLive();
  render();
};

/** Writes each task in turn, then unpicks them and shows their new state. */
const actOn = (ids: string[], write: (id: string) => Promise<unknown>): void => {
  const written: string[] = [];
  const writeAll = async (): Promise<void> => {
    for (const id of ids) {
      await write(id);
      written.push(id);
    }
  };
  writeAll()
    .catch(showError)
    .finally(() => {
      // After a failure the unwritten tasks stay picked, ready for a retry.
      const view = state.view;
      if (view.kind === 'result') written.forEach((id) => view.picked.delete(id));
      saveView();
      refreshLive().catch(showError);
    });
};

const selectionActions = {
  addToToday: (ids: string[]): void => {
    const view = state.view;
    if (view.kind !== 'result') return;
    const today = view.result.ctx.snapshot.day.todayStr;
    actOn(ids, (id) => host().updateTask(id, { dueDay: today }));
  },
  done: (ids: string[]): void =>
    actOn(ids, (id) => host().updateTask(id, { isDone: true })),
  start: (id: string) => void host().startTracking?.(id).catch(showError),
  open: (id: string) => void host().selectTask(id).catch(showError),
  canStart: typeof host().startTracking === 'function',
};

const applyAndShow = async (
  result: AskResult,
  keys: Set<string>,
  isWithoutReview: boolean,
): Promise<void> => {
  const rows = result.proposal.changes.filter((r) => keys.has(r.key));
  const applied = await applyRows(writeApi, rows, result.ctx.snapshot);
  input.value = '';
  setView({ kind: 'applied', rows: applied, isWithoutReview, say: result.proposal.say });
};

const runAsk = async (
  text: string,
  token: number,
  selection: string[],
): Promise<void> => {
  const hostState = await getHostState();
  state.host = hostState;
  const apiKey = await getApiKey();
  if (!apiKey) return setView({ kind: 'setup', isFirstRun: true });
  const snapshot = await readSnapshot(selection, hostState.currentTaskId);
  const deps = { request: requestFn, apiKey, model: hostState.settings.model };
  const result = await ask(deps, snapshot, text);
  if (token !== state.token) return; // cancelled or superseded
  const { proposal } = result;
  if (
    hostState.settings.isApplyWithoutReview &&
    canApplyWithoutReview(proposal, result.ctx)
  ) {
    // Busy blocks Cancel and a new request until the writes are done.
    state.isBusy = true;
    return applyAndShow(
      result,
      new Set(proposal.changes.map((r) => r.key)),
      true,
    ).finally(() => {
      state.isBusy = false;
    });
  }
  // Deletes start unticked (§ 3): the user opts into each one.
  const ticked = new Set(
    proposal.changes.filter((r) => r.kind !== 'delete').map((r) => r.key),
  );
  state.live = new Map(snapshot.tasks.map((t) => [t.id, t]));
  setView({ kind: 'result', result, ticked, picked: new Set() });
};

const submit = (): void => {
  const text = input.value.trim();
  // While an apply runs, a new answer would replace its result with a stale proposal.
  if (!text || state.view.kind === 'loading' || state.isBusy) return;
  const token = ++state.token;
  // Read before the loading view replaces the result that holds the selection.
  const selection = selectionIds();
  setView({ kind: 'loading' });
  runAsk(text, token, selection).catch((err: unknown) => {
    if (token !== state.token) return;
    setView({ kind: 'error', message: errorMessage(err, navigator.onLine) });
  });
};

const cancel = (): void => {
  if (state.isBusy) return; // writes have started; their result is shown
  // The host request can't be aborted from the iframe; its answer is ignored.
  state.token++;
  setView({ kind: 'idle' });
};

const apply = (): void => {
  const view = state.view;
  // While rows are picked their footer replaces Apply; Ctrl+Enter must not apply unseen.
  if (view.kind !== 'result' || !view.ticked.size || view.picked.size || state.isBusy) {
    return;
  }
  state.isBusy = true;
  render();
  saveView();
  applyAndShow(view.result, view.ticked, false)
    .catch(showError)
    .finally(() => {
      state.isBusy = false;
      render();
      // A failed apply leaves the result on screen; keep it for a reopen again.
      saveView();
    });
};

const discard = (): void => setView({ kind: 'idle' });

/** Bulk actions on the picked selection rows. */
const renderPickedFooter = (
  picked: string[],
  snapshot: AskResult['ctx']['snapshot'],
): void => {
  const live = (id: string): TaskLike | undefined => state.live.get(id);
  const toDo = picked.filter((id) => live(id) && !live(id)?.isDone);
  const toToday = picked.filter((id) => canAddToToday(live(id), snapshot.day));
  const doneBtn = button(`Mark ${toDo.length} done`, () => selectionActions.done(toDo));
  doneBtn.disabled = !toDo.length;
  const todayBtn = button(
    `Add ${toToday.length} to today`,
    () => selectionActions.addToToday(toToday),
    'btn-primary',
  );
  todayBtn.disabled = !toToday.length;
  footer.append(el('span', 'count muted', `${picked.length} picked`), doneBtn, todayBtn);
};

const renderFooter = (): void => {
  const view = state.view;
  if (view.kind === 'loading') footer.append(button('Cancel', cancel));
  if (view.kind !== 'result') return;
  // Picks come first: change rows rarely share a result with a selection.
  if (view.picked.size) {
    return renderPickedFooter([...view.picked], view.result.ctx.snapshot);
  }
  const total = view.result.proposal.changes.length;
  if (!total) return void footer.append(button('Clear', discard));
  footer.append(
    el('span', 'count muted', `${view.ticked.size} of ${total} selected`),
    button('Discard', discard),
  );
  const applyBtn = button(state.isBusy ? 'Applying…' : 'Apply', apply, 'btn-primary');
  applyBtn.disabled = !view.ticked.size || state.isBusy;
  footer.append(applyBtn);
};

const renderBody = (): void => {
  const view = state.view;
  if (view.kind === 'idle' && view.note) body.append(el('p', 'say', view.note));
  if (view.kind === 'loading') {
    const box = el('div', 'loading');
    box.append(el('div', 'spin'), el('p', undefined, 'Asking…'));
    body.append(box);
  }
  if (view.kind === 'error')
    body.append(el('p', 'msg warn', `${view.message} Nothing was changed.`));
  if (view.kind === 'result') {
    const ticked = view.ticked;
    const onToggle = (key: string, isOn: boolean): void => {
      if (isOn) ticked.add(key);
      else ticked.delete(key);
      footer.replaceChildren();
      renderFooter();
      saveView();
    };
    const onPick = (taskId: string, isOn: boolean): void => {
      if (isOn) view.picked.add(taskId);
      else view.picked.delete(taskId);
      footer.replaceChildren();
      renderFooter();
      saveView();
    };
    renderResult(body, {
      ...view.result.ctx,
      proposal: view.result.proposal,
      ticked,
      onToggle,
      selection: selectionActions,
      picked: view.picked,
      onPick,
      live: state.live,
    });
  }
  if (view.kind === 'applied')
    renderApplied(body, { ...view, open: selectionActions.open });
};

const saveSetup = async (apiKey: string, settings: Settings): Promise<void> => {
  if (apiKey) await sendToBackground({ type: 'setApiKey', apiKey });
  await sendToBackground({ type: 'saveSettings', settings });
  state.host = await getHostState();
  setView({ kind: 'idle' });
  input.focus();
};

const setupActions = {
  save: saveSetup,
  clearKey: async (): Promise<void> => {
    await sendToBackground({ type: 'clearApiKey' });
    state.host = await getHostState();
    setView({ kind: 'setup', isFirstRun: true });
  },
  preview: async (): Promise<string> => {
    const snapshot = await readSnapshot(
      selectionIds(),
      state.host?.currentTaskId ?? null,
    );
    // With text in the box this is the exact next request, word matches included.
    const request = input.value.trim();
    const ctx = buildContext(snapshot, request);
    return JSON.stringify(
      { request: request || '(your request)', context: ctx.sent },
      null,
      2,
    );
  },
  close: (): void => setView({ kind: 'idle' }),
};

function render(): void {
  const view = state.view;
  body.replaceChildren();
  footer.replaceChildren();
  $('ask').hidden = view.kind === 'setup' || view.kind === 'boot';
  // Without host state the settings form has nothing to show.
  $('settings-btn').hidden = view.kind === 'setup' || !state.host;
  if (view.kind === 'setup' && state.host) {
    const { hasApiKey, settings } = state.host;
    return renderSetup(
      body,
      { hasApiKey, settings, isFirstRun: view.isFirstRun },
      setupActions,
    );
  }
  renderBody();
  renderFooter();
}

const onKey = (e: KeyboardEvent): void => {
  const kind = state.view.kind;
  // Esc on an open row menu only closes the menu, not the whole result.
  if (e.key === 'Escape' && document.querySelector(':popover-open')) return;
  if (e.key === 'Escape' && kind === 'loading') return cancel();
  if (e.key === 'Escape' && kind === 'result') return discard();
  if (e.key !== 'Enter' || e.isComposing) return;
  if ((e.ctrlKey || e.metaKey) && kind === 'result') {
    e.preventDefault();
    return apply();
  }
  if (e.target === input && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
};

const DAY_CHANGED = 'The day changed, so the answer was discarded. Ask again.';

/** What the panel showed before it was closed, or idle. */
const keptView = async (): Promise<View> => {
  const kept = (await sendToBackground({ type: 'getPanel' })) as {
    view?: View | null;
    text?: string;
  } | null;
  input.value = kept?.text ?? '';
  const view = kept?.view;
  if (!view) return { kind: 'idle' };
  if (view.kind !== 'result') return view;
  // The day-change hook can't fire while the panel is closed.
  const day = await host().getDayContext?.();
  if (day?.todayStr !== view.result.ctx.snapshot.day.todayStr) {
    return { kind: 'idle', note: DAY_CHANGED };
  }
  state.live = await readLive();
  return view;
};

const boot = async (): Promise<void> => {
  $('hint').textContent = ['Enter to send', dictationHint(host().cfg?.platform)]
    .filter(Boolean)
    .join(' · ');
  $('settings-btn').addEventListener('click', () =>
    setView({ kind: 'setup', isFirstRun: false }),
  );
  document.addEventListener('keydown', onKey);
  host().registerHook(PluginHooks.DAY_CHANGE, () => {
    // Days in a proposal were resolved against yesterday (§ 6.6), plans or not.
    const kind = state.view.kind;
    if ((kind === 'result' || kind === 'loading') && !state.isBusy) {
      state.token++;
      setView({ kind: 'idle', note: DAY_CHANGED });
    }
  });
  input.addEventListener('input', () => savePanel({ text: input.value }));
  state.host = await getHostState();
  const isReady = state.host.hasApiKey && state.host.settings.isNoticeAccepted;
  const restored = isReady
    ? await keptView().catch((err: unknown): View => {
        // Restoring is a convenience: without it the panel still works.
        console.warn('AI Command: could not restore the panel', err);
        return { kind: 'idle' };
      })
    : null;
  setView(restored ?? { kind: 'setup', isFirstRun: true });
  if (isReady) input.focus();
};

boot().catch((err: unknown) => {
  // A blank panel would look stuck; the error view keeps the ask box, which retries.
  const reason = (err instanceof Error ? err.message : String(err)).replace(/\.$/, '');
  setView({
    kind: 'error',
    message: `AI Command could not start (${reason}). Send a request to try again.`,
  });
});
