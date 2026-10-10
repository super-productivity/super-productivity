/**
 * App Auto Track background script. Polls the foreground window (desktop, macOS and
 * Windows), maps it to a task via user rules or issue keys in the title, and after a
 * dwell time suggests tracking that task — or switches automatically when enabled.
 *
 * Window titles are user content: they stay in memory and are never logged or stored.
 */

import {
  PluginHooks,
  type CurrentTaskChangePayload,
  type PluginAPI,
  type PluginNodeScriptResult,
} from '@super-productivity/plugin-api';
import { decideAction } from './decide';
import { INITIAL_DWELL_STATE, stepDwell, type DwellState } from './dwell';
import { findTaskForWindow, parseRules } from './match';
import { buildProbeScript, parseProbeResult } from './probe';

declare const PluginAPI: PluginAPI;

const POLL_MS = 10_000;
const DWELL_MS = 90_000;
// Generous: the first Windows poll compiles a helper and the first macOS poll waits
// on the Automation permission prompt. Polls never overlap, so this only bounds hangs.
const PROBE_TIMEOUT_MS = 30_000;
// Denied permissions or a broken PowerShell fail every poll; back off instead of
// spawning two processes every 10s, but keep retrying so a later grant is picked up.
const MAX_BACKOFF_MS = 5 * 60_000;
const DWELL_TIMING = { dwellMs: DWELL_MS, maxGapMs: 3 * POLL_MS };
const LOG_PREFIX = '[app-auto-track]';

interface AutoTrackConfig {
  isAutoSwitch?: boolean;
  rules?: string;
}

const probeScript = buildProbeScript();

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isUnloaded = false;
let dwell: DwellState = INITIAL_DWELL_STATE;
let currentTaskId: string | null | undefined;
let autoStartedId: string | null = null;
let hasShownProbeError = false;
let failureCount = 0;

const t = (key: string, params?: Record<string, string | number>): string =>
  PluginAPI.translate(key, params);

const getErrorCode = (error: PluginNodeScriptResult['error']): string =>
  typeof error === 'object' ? error.code : 'EXEC_FAILED';

const startTask = (taskId: string, isAuto: boolean): void => {
  if (isUnloaded) return;
  // A task the user accepted via the snack is theirs; auto-switch must not replace it.
  if (isAuto) autoStartedId = taskId;
  PluginAPI.dispatchAction({ type: '[Task] SetCurrentTask', id: taskId });
};

const act = async (matchId: string, cfg: AutoTrackConfig): Promise<void> => {
  const action = decideAction({
    matchId,
    currentTaskId,
    autoStartedId,
    isAutoSwitch: !!cfg.isAutoSwitch,
  });
  if (action === 'switch') {
    startTask(matchId, true);
    return;
  }
  if (action === 'suggest') {
    const task = (await PluginAPI.getTasks()).find((tsk) => tsk.id === matchId);
    if (!task || isUnloaded) return;
    PluginAPI.showSnack({
      msg: t('SUGGEST', { title: task.title }),
      ico: 'timer',
      action: { label: t('TRACK'), onClick: () => startTask(matchId, false) },
    });
  }
};

const reportProbeError = (code: string): void => {
  // Only the error code: probe output may contain window titles.
  console.warn(`${LOG_PREFIX} probe failed: ${code}`);
  if (hasShownProbeError) return;
  hasShownProbeError = true;
  PluginAPI.showSnack({ msg: t('PROBE_ERROR'), type: 'WARNING' });
};

type TickResult = 'ok' | 'failed' | 'unsupported';

const tick = async (): Promise<TickResult> => {
  // Super Productivity itself in front is never a match (and needs no probe).
  if (PluginAPI.isWindowFocused()) return 'ok';

  const res = await PluginAPI.executeNodeScript!({
    script: probeScript,
    timeout: PROBE_TIMEOUT_MS,
  });
  const probe = res.success
    ? parseProbeResult(res.result)
    : ({ kind: 'error', code: getErrorCode(res.error) } as const);
  if (probe.kind === 'unsupported') return 'unsupported';
  if (probe.kind === 'error') {
    reportProbeError(probe.code);
    return 'failed';
  }

  const cfg = (await PluginAPI.getConfig<AutoTrackConfig>()) ?? {};
  // shortcut: full task list per poll (only while SP is unfocused) — cache it and
  // invalidate via task hooks if it ever shows up in profiles
  const match = findTaskForWindow(
    probe.sample,
    parseRules(cfg.rules),
    await PluginAPI.getTasks(),
  );
  if (isUnloaded) return 'ok';
  const step = stepDwell(
    dwell,
    { matchId: match?.id ?? null, now: Date.now() },
    DWELL_TIMING,
  );
  dwell = step.state;
  if (step.fireId) await act(step.fireId, cfg);
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
      reportProbeError(error instanceof Error ? error.name : 'UNKNOWN');
    }
    if (result === 'unsupported') return;
    failureCount = result === 'failed' ? Math.min(failureCount + 1, 10) : 0;
    schedule();
  }, delay);
};

PluginAPI.registerHook(PluginHooks.CURRENT_TASK_CHANGE, (payload) => {
  currentTaskId = (payload as CurrentTaskChangePayload).current?.id ?? null;
  // Any change not made by this plugin hands control back to the user.
  if (currentTaskId !== autoStartedId) autoStartedId = null;
});

PluginAPI.onUnload?.(() => {
  isUnloaded = true;
  if (pollTimer) clearTimeout(pollTimer);
});

PluginAPI.onReady?.(() => {
  // Web and mobile have no node bridge; the plugin stays inert there.
  if (!PluginAPI.executeNodeScript) return;
  schedule();
});
