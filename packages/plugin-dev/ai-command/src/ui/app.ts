// The AI Command panel: ask, review, apply. Views are re-rendered from
// `state`; nothing here is persisted except settings, via plugin.js.

import { PluginHooks } from '@super-productivity/plugin-api';
import { applyRows } from '../core/apply';
import { ask, type AskResult } from '../core/ask';
import { canApplyWithoutReview } from '../core/auto-apply';
import { errorMessage } from '../core/claude';
import { buildContext } from '../core/context';
import type { Settings } from '../core/settings';
import type { AppliedRow } from '../core/types';
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
  | { kind: 'result'; result: AskResult; ticked: Set<string> }
  | { kind: 'applied'; rows: AppliedRow[]; isWithoutReview: boolean; say: string | null };

const state: { view: View; host: HostState | null; token: number; isBusy: boolean } = {
  view: { kind: 'boot' },
  host: null,
  token: 0,
  isBusy: false,
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

const setView = (view: View): void => {
  state.view = view;
  render();
};

/** Ids of the selection on screen: the "these" of the next request. */
const selectionIds = (): string[] =>
  state.view.kind === 'result'
    ? (state.view.result.proposal.selection?.items.map((i) => i.taskId) ?? [])
    : [];

const selectionActions = {
  done: (id: string) => void host().updateTask(id, { isDone: true }).catch(showError),
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
    return applyAndShow(result, new Set(proposal.changes.map((r) => r.key)), true);
  }
  // Deletes start unticked (§ 3): the user opts into each one.
  const ticked = new Set(
    proposal.changes.filter((r) => r.kind !== 'delete').map((r) => r.key),
  );
  setView({ kind: 'result', result, ticked });
};

const submit = (): void => {
  const text = input.value.trim();
  if (!text || state.view.kind === 'loading') return;
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
  // The host request can't be aborted from the iframe; its answer is ignored.
  state.token++;
  setView({ kind: 'idle' });
};

const apply = (): void => {
  const view = state.view;
  if (view.kind !== 'result' || !view.ticked.size || state.isBusy) return;
  state.isBusy = true;
  render();
  applyAndShow(view.result, view.ticked, false)
    .catch(showError)
    .finally(() => {
      state.isBusy = false;
      render();
    });
};

const discard = (): void => setView({ kind: 'idle' });

const renderFooter = (): void => {
  const view = state.view;
  if (view.kind === 'loading') footer.append(button('Cancel', cancel));
  if (view.kind !== 'result') return;
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
    };
    renderResult(body, {
      ...view.result.ctx,
      proposal: view.result.proposal,
      ticked,
      onToggle,
      selection: selectionActions,
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
  $('settings-btn').hidden = view.kind === 'setup';
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

const boot = async (): Promise<void> => {
  $('hint').textContent = ['Enter to send', dictationHint(host().cfg?.platform)]
    .filter(Boolean)
    .join(' · ');
  $('settings-btn').addEventListener('click', () =>
    setView({ kind: 'setup', isFirstRun: false }),
  );
  document.addEventListener('keydown', onKey);
  host().registerHook(PluginHooks.DAY_CHANGE, () => {
    // A day plan made for yesterday must not be applied today (§ 6.6).
    if (state.view.kind === 'result' && state.view.result.proposal.isDayPlan) {
      setView({
        kind: 'idle',
        note: 'The day changed, so the plan was discarded. Ask again.',
      });
    }
  });
  state.host = await getHostState();
  const isReady = state.host.hasApiKey && state.host.settings.isNoticeAccepted;
  setView(isReady ? { kind: 'idle' } : { kind: 'setup', isFirstRun: true });
  if (isReady) input.focus();
};

boot().catch(showError);
