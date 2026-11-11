/**
 * CI-only harness for the iOS Simulator reminder check. Never shipped: run.sh
 * copies it into the built web bundle of a throwaway Simulator build.
 *
 * run.sh picks the phase through Documents/sim-harness/cmd.json; without that
 * file this script does nothing. Each phase seeds synthetic tasks through the
 * real store, so the app's own scheduling code arms the notifications, then
 * writes what iOS reports as pending and delivered to
 * Documents/sim-harness/report-<phase>.json for assert.js.
 */
(() => {
  'use strict';

  const DIR = 'sim-harness';
  const DAY = 24 * 60 * 60 * 1000;
  // Both are more than the 64 pending notifications iOS keeps per app.
  const PROBE_COUNT = 80;
  const SEED_COUNT = 70;
  const PROBE_ID_BASE = 900000;
  // Long enough for run.sh to terminate the app before the reminder is due.
  const NEAR_LEAD_MS = 120 * 1000;
  const PROJECT_ID = 'INBOX_PROJECT';

  const report = { log: [] };
  let phase = 'none';

  // The app's own schedule/cancel calls to iOS, counted by watchBridge().
  const appCalls = { schedule: 0, cancel: 0, inFlight: 0, lastAt: 0 };
  let bridge = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const native = (plugin, method, options) =>
    (bridge || window.Capacitor.nativePromise)(plugin, method, options || {});
  const notif = (method, options) => native('LocalNotifications', method, options);
  const log = (msg) => report.log.push(`${new Date().toISOString()} ${msg}`);

  const save = () =>
    native('Filesystem', 'writeFile', {
      path: `${DIR}/report-${phase}.json`,
      data: JSON.stringify(report, null, 1),
      directory: 'DOCUMENTS',
      encoding: 'utf8',
      recursive: true,
    });

  const brief = (n) => ({
    id: n.id,
    at: n.schedule && n.schedule.at ? Date.parse(n.schedule.at) : null,
    reminderId: (n.extra && n.extra.reminderId) || null,
  });
  const getPending = async () => (await notif('getPending')).notifications.map(brief);
  const getDelivered = async () =>
    (await notif('getDeliveredNotifications')).notifications.map(brief);

  const waitFor = async (label, fn, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await fn();
      if (value) {
        return value;
      }
      await sleep(500);
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  /**
   * Wraps the bridge the app's plugin proxies call, so the harness can tell
   * when the app stopped talking to iOS. The harness's own calls bypass it.
   */
  const watchBridge = () => {
    bridge = window.Capacitor.nativePromise;
    window.Capacitor.nativePromise = (plugin, method, options) => {
      const isCounted =
        plugin === 'LocalNotifications' && (method === 'schedule' || method === 'cancel');
      if (!isCounted) {
        return bridge(plugin, method, options);
      }
      appCalls[method]++;
      appCalls.inFlight++;
      appCalls.lastAt = Date.now();
      const settle = () => {
        appCalls.inFlight--;
        appCalls.lastAt = Date.now();
      };
      const result = bridge(plugin, method, options);
      result.then(settle, settle);
      return result;
    };
  };

  /** Resolves true once the app made no schedule/cancel call for `quietMs`. */
  const appQuiet = async (quietMs, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (appCalls.inFlight === 0 && Date.now() - appCalls.lastAt >= quietMs) {
        return true;
      }
      await sleep(500);
    }
    log(`the app was still arming after ${timeoutMs / 1000}s`);
    return false;
  };

  /** Pending list once its size stopped changing for `quietMs`. */
  const pendingWhenStable = async (quietMs) => {
    let last = await getPending();
    let stableSince = Date.now();
    const deadline = Date.now() + 120000;
    while (Date.now() - stableSince < quietMs && Date.now() < deadline) {
      await sleep(1000);
      const next = await getPending();
      if (next.length !== last.length) {
        stableSince = Date.now();
      }
      last = next;
    }
    return last;
  };

  const getState = (store) => {
    let state;
    store.subscribe((s) => (state = s)).unsubscribe();
    return state;
  };

  /** The store, once the app loaded its data and the scheduling effects run. */
  const getReadyStore = async () => {
    const store = await waitFor(
      'the app store',
      () => window.__e2eTestHelpers && window.__e2eTestHelpers.store,
      300000,
    );
    await waitFor(
      'the inbox project',
      () => {
        const projects = getState(store).projects;
        return projects && projects.entities && projects.entities[PROJECT_ID];
      },
      120000,
    );
    // The effects start 5s after launch (DELAY_SCHEDULE); leave them room.
    await sleep(10000);
    log('store ready');
    return store;
  };

  const newTask = (id) => ({
    id,
    title: `sim ${id}`,
    projectId: PROJECT_ID,
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    tagIds: [],
    created: Date.now(),
    attachments: [],
  });

  const addTask = (store, id) => {
    const task = newTask(id);
    store.dispatch({
      type: '[Task Shared] addTask',
      task,
      workContextId: PROJECT_ID,
      workContextType: 'PROJECT',
      isAddToBacklog: false,
      isAddToBottom: true,
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'CRT' },
    });
    return task;
  };

  /** Same two actions the app dispatches when a user adds a task and sets a reminder. */
  const addTaskWithReminder = (store, id, remindAt) => {
    const task = addTask(store, id);
    store.dispatch({
      type: '[Task Shared] scheduleTaskWithTime',
      task,
      dueWithTime: remindAt,
      remindAt,
      isMoveToBacklog: false,
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
  };

  const addDailyRepeat = (store, cfgId) => {
    const taskId = `${cfgId}Task`;
    addTask(store, taskId);
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    store.dispatch({
      type: '[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task',
      taskId,
      startTime: '12:00',
      remindAt: 'AtStart',
      taskRepeatCfg: {
        id: cfgId,
        title: `sim ${cfgId}`,
        projectId: PROJECT_ID,
        lastTaskCreation: Date.now(),
        lastTaskCreationDay: today,
        startDate: today,
        startTime: '12:00',
        remindAt: 'AtStart',
        repeatEvery: 1,
        isPaused: false,
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatFromCompletionDate: false,
        waitForCompletion: false,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: true,
        tagIds: [],
        order: 0,
        shouldInheritSubtasks: false,
        disableAutoUpdateSubtasks: false,
        skipOverdue: false,
      },
      meta: {
        isPersistent: true,
        entityType: 'TASK_REPEAT_CFG',
        entityId: cfgId,
        opType: 'CRT',
      },
    });
  };

  /** Arms a reminder NEAR_LEAD_MS ahead and reports whether iOS holds it. */
  const armNear = async (store, id) => {
    const wantAt = Date.now() + NEAR_LEAD_MS;
    addTaskWithReminder(store, id, wantAt);
    let armed = null;
    try {
      armed = await waitFor(
        `pending ${id}`,
        async () => (await getPending()).find((n) => n.reminderId === id),
        60000,
      );
    } catch (e) {
      log(String(e));
    }
    return { id, wantAt, isArmed: !!armed, pendingAt: armed ? armed.at : null };
  };

  /**
   * Asks iOS itself, bypassing the app: schedule more than the cap and see
   * which requests it keeps. `isFarFirst` decides the order of the calls, so
   * two runs tell "keeps the soonest" apart from "keeps the first/last added".
   */
  const probeOsCap = async (isFarFirst) => {
    const now = Date.now();
    const errors = [];
    for (let i = 1; i <= PROBE_COUNT; i++) {
      // daysAhead doubles as the id suffix: 1 fires soonest.
      const daysAhead = isFarFirst ? PROBE_COUNT + 1 - i : i;
      try {
        await notif('schedule', {
          notifications: [
            {
              id: PROBE_ID_BASE + daysAhead,
              title: 'sim probe',
              body: 'sim probe',
              schedule: { at: new Date(now + daysAhead * DAY) },
            },
          ],
        });
      } catch (e) {
        errors.push(`${daysAhead}: ${e}`);
      }
    }
    const pending = (await pendingWhenStable(4000)).filter((n) => n.id > PROBE_ID_BASE);
    const keptDaysAhead = pending.map((n) => n.id - PROBE_ID_BASE).sort((a, b) => a - b);
    const all = Array.from({ length: PROBE_COUNT }, (_, i) => ({
      id: PROBE_ID_BASE + i + 1,
    }));
    await notif('cancel', { notifications: all });
    await sleep(2000);
    return {
      isFarFirst,
      errors,
      keptDaysAhead,
      pendingAfterCancel: (await getPending()).length,
    };
  };

  const phases = {
    // The XCUITest in AllowTap.swift taps "Allow" on the system alert.
    permission: async () => {
      const before = await notif('checkPermissions');
      const after = await notif('requestPermissions');
      report.permission = { before: before.display, after: after.display };
    },

    baseline: async () => {
      report.permission = (await notif('checkPermissions')).display;
      report.osCapFarFirst = await probeOsCap(true);
      await save();
      report.osCapNearFirst = await probeOsCap(false);
      await save();
      const store = await getReadyStore();
      report.near = await armNear(store, 'simBaseline');
    },

    cap: async () => {
      const store = await getReadyStore();
      const seededAt = Date.now();

      addDailyRepeat(store, 'simRepeat');
      // The repeat effect debounces for 1s before it arms anything.
      await sleep(3000);
      await appQuiet(5000, 120000);
      const repeatAts = (await getPending())
        .filter((n) => n.reminderId && n.reminderId.startsWith('rpt_simRepeat_'))
        .map((n) => n.at);
      report.repeat = {
        count: repeatAts.length,
        daysCovered: repeatAts.length ? (Math.max(...repeatAts) - seededAt) / DAY : 0,
      };
      await save();

      // Far ones first, so the soonest reminders are the last the app arms.
      report.wanted = [];
      const callsBeforeSeed = appCalls.schedule;
      for (let i = 1; i <= SEED_COUNT; i++) {
        const daysAhead = SEED_COUNT + 1 - i;
        const id = `simCap${String(daysAhead).padStart(2, '0')}`;
        const at = seededAt + daysAhead * DAY;
        addTaskWithReminder(store, id, at);
        report.wanted.push({ reminderId: id, at });
      }
      const isDrained = await appQuiet(10000, 20 * 60 * 1000);
      report.seeding = { scheduleCalls: appCalls.schedule - callsBeforeSeed, isDrained };
      report.pendingOverCap = await getPending();
      await save();

      // A change that touches no reminder should not make the app re-arm any.
      const callsBeforeNoop = appCalls.schedule;
      addTask(store, 'simNoReminder');
      await sleep(3000);
      await appQuiet(5000, 5 * 60 * 1000);
      report.rearm = { scheduleCalls: appCalls.schedule - callsBeforeNoop };
      await save();

      report.near = await armNear(store, 'simNearUnderCap');
      report.pendingAtEnd = await getPending();
    },

    // Only the launch snapshot matters here.
    final: async () => undefined,
  };

  const run = async () => {
    await waitFor(
      'the native bridge',
      () => window.Capacitor && window.Capacitor.nativePromise,
      10000,
    );
    let cmd;
    try {
      const file = await native('Filesystem', 'readFile', {
        path: `${DIR}/cmd.json`,
        directory: 'DOCUMENTS',
        encoding: 'utf8',
      });
      cmd = JSON.parse(file.data);
    } catch (e) {
      // No command file: a normal launch, stay inert.
      return;
    }
    phase = cmd.phase;
    watchBridge();
    try {
      // Taken before the app's own code runs, so `delivered` shows what iOS
      // did while the app was terminated.
      report.atLaunch = {
        at: Date.now(),
        pending: await getPending(),
        delivered: await getDelivered(),
      };
      log(`phase ${phase} started`);
      await save();
      await phases[phase]();
      report.isDone = true;
    } catch (e) {
      report.error = String((e && e.stack) || e);
    }
    log(`phase ${phase} ended`);
    await save();
  };

  run();
})();
