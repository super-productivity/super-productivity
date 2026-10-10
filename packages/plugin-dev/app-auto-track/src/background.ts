/**
 * App Auto Track background script. Polls the foreground window (desktop, macOS and
 * Windows), maps it to a task via user rules or issue keys in the title, and after a
 * dwell time suggests tracking that task. It never starts or stops tracking itself.
 *
 * Window titles are user content: they stay in memory and are never logged or stored.
 */

import {
  PluginHooks,
  type CurrentTaskChangePayload,
  type PluginAPI,
  type PluginNodeScriptResult,
  type Task,
} from '@super-productivity/plugin-api';
import {
  INITIAL_DWELL_STATE,
  isRecentCandidate,
  stepDwell,
  type DwellState,
} from './dwell';
import { escapeHtml } from './html';
import {
  findTaskForWindow,
  hasMatchCandidate,
  parseRules,
  type WindowSample,
} from './match';
import { buildProbeScript, parseProbeResult, type ProbeResult } from './probe';

declare const PluginAPI: PluginAPI;

// shortcut: each unfocused poll spawns a node child plus osascript/powershell — a
// long-lived helper process or a main-process foreground-window IPC if CPU or battery
// cost shows up
const POLL_MS = 10_000;
const DWELL_MS = 90_000;
// Generous: the first Windows poll compiles a helper and the first macOS poll waits
// on the Automation permission prompt. Polls never overlap, so this only bounds hangs.
const PROBE_TIMEOUT_MS = 30_000;
// Denied permissions or a broken PowerShell fail every poll; back off instead of
// spawning two processes every 10s, but keep retrying so a later grant is picked up.
const MAX_BACKOFF_MS = 5 * 60_000;
// Samples are POLL_MS plus the probe's run time apart: 4x tolerates two missed polls
// (a glance at chat or at SP itself) even with slow probes.
const DWELL_TIMING = { dwellMs: DWELL_MS, maxGapMs: 4 * POLL_MS };
// A suggestion waits until SP is focused; after this long without the window it
// points at, it is no longer what the user is working on.
const SUGGESTION_MAX_AGE_MS = 10 * 60_000;
const LOG_PREFIX = '[app-auto-track]';

interface AutoTrackConfig {
  rules?: string;
}

const probeScript = buildProbeScript();

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isUnloaded = false;
let dwell: DwellState = INITIAL_DWELL_STATE;
let currentTaskId: string | null = null;
let pendingSuggestionId: string | null = null;
let configPromise: Promise<AutoTrackConfig> | null = null;
let hasShownProbeError = false;
let failureCount = 0;

const t = (key: string, params?: Record<string, string | number>): string =>
  PluginAPI.translate(key, params);

const getErrorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'UNKNOWN';

const getErrorCode = (error: PluginNodeScriptResult['error']): string =>
  typeof error === 'object' ? error.code : 'EXEC_FAILED';

// Re-read after SP loses focus, where config is edited, instead of every 10s poll
// (getConfig logs each call). A change synced from another device waits for that.
const getConfig = (): Promise<AutoTrackConfig> =>
  (configPromise ??= PluginAPI.getConfig<AutoTrackConfig>().then(
    (cfg) => cfg ?? {},
    (error: unknown) => {
      configPromise = null;
      throw error;
    },
  ));

const startTask = (taskId: string): void => {
  if (isUnloaded) return;
  PluginAPI.dispatchAction({ type: '[Task] SetCurrentTask', id: taskId });
};

const suggest = async (matchId: string): Promise<void> => {
  // Polls only run while SP is in the background, where a snack would go unseen; SP
  // may have gained focus during this poll's probe, though.
  pendingSuggestionId = matchId;
  if (PluginAPI.isWindowFocused()) await showPendingSuggestion();
};

const showPendingSuggestion = async (): Promise<void> => {
  const id = pendingSuggestionId;
  pendingSuggestionId = null;
  if (!id || id === currentTaskId) return;
  if (
    !isRecentCandidate(dwell, id, { now: Date.now(), maxAgeMs: SUGGESTION_MAX_AGE_MS })
  ) {
    return;
  }
  const task = (await PluginAPI.getTasks()).find((tsk) => tsk.id === id && !tsk.isDone);
  if (!task || isUnloaded) return;
  PluginAPI.showSnack({
    msg: t('SUGGEST', { title: escapeHtml(task.title) }),
    ico: 'timer',
    action: { label: t('TRACK'), onClick: () => startTask(id) },
  });
};

const reportProbeError = (code: string): void => {
  if (isUnloaded) return;
  // Only the error code: probe output may contain window titles.
  console.warn(`${LOG_PREFIX} probe failed: ${code}`);
  if (hasShownProbeError) return;
  hasShownProbeError = true;
  PluginAPI.showSnack({ msg: t('PROBE_ERROR'), type: 'WARNING' });
};

const runProbe = async (): Promise<ProbeResult> => {
  const res = await PluginAPI.executeNodeScript!({
    script: probeScript,
    timeout: PROBE_TIMEOUT_MS,
  });
  return res.success
    ? parseProbeResult(res.result)
    : { kind: 'error', code: getErrorCode(res.error) };
};

const findMatch = async (sample: WindowSample): Promise<Task | null> => {
  const rules = parseRules((await getConfig()).rules);
  // Most windows cannot match; skip the full task fetch (and its log line) for them.
  if (!hasMatchCandidate(sample, rules)) return null;
  // shortcut: full task list per candidate poll — cache it and invalidate via task
  // hooks if it ever shows up in profiles
  return findTaskForWindow(sample, rules, await PluginAPI.getTasks());
};

type TickResult = 'ok' | 'failed' | 'skipped' | 'unsupported';

const tick = async (): Promise<TickResult> => {
  // Super Productivity itself in front is never a match (and needs no probe).
  if (PluginAPI.isWindowFocused()) return 'skipped';

  const probe = await runProbe();
  if (probe.kind === 'unsupported') return 'unsupported';
  if (probe.kind === 'error') {
    reportProbeError(probe.code);
    return 'failed';
  }

  const match = await findMatch(probe.sample);
  if (isUnloaded) return 'ok';
  const step = stepDwell(
    dwell,
    { matchId: match?.id ?? null, now: Date.now() },
    DWELL_TIMING,
  );
  dwell = step.state;
  if (step.fireId) await suggest(step.fireId);
  return 'ok';
};

const schedule = (): void => {
  if (isUnloaded) return;
  const delay = Math.min(POLL_MS * 2 ** failureCount, MAX_BACKOFF_MS);
  pollTimer = setTimeout(async () => {
    let result: TickResult = 'failed';
    try {
      result = await tick();
    } catch (error) {
      reportProbeError(getErrorName(error));
    }
    if (result === 'unsupported') return;
    // A focused SP says nothing about the probe, so it keeps the current backoff.
    if (result !== 'skipped') {
      failureCount = result === 'failed' ? Math.min(failureCount + 1, 10) : 0;
    }
    schedule();
  }, delay);
};

const onFocusChange = (isFocused: boolean): void => {
  if (isUnloaded) return;
  if (!isFocused) {
    configPromise = null;
    return;
  }
  showPendingSuggestion().catch((error: unknown) =>
    console.warn(`${LOG_PREFIX} suggestion failed: ${getErrorName(error)}`),
  );
};

PluginAPI.registerHook(PluginHooks.CURRENT_TASK_CHANGE, (payload) => {
  // Known only after the first change: the plugin may load while a task runs.
  currentTaskId = (payload as CurrentTaskChangePayload).current?.id ?? null;
});

PluginAPI.onUnload?.(() => {
  isUnloaded = true;
  if (pollTimer) clearTimeout(pollTimer);
});

PluginAPI.onReady?.(() => {
  // Web and mobile have no node bridge (the method exists there but always fails),
  // and the enabled flag syncs from desktop: stay inert off-desktop.
  if (PluginAPI.cfg.platform !== 'desktop' || !PluginAPI.executeNodeScript) return;
  PluginAPI.onWindowFocusChange?.(onFocusChange);
  schedule();
});
