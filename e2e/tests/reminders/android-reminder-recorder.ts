import { type Page } from '@playwright/test';
import { test as base } from '../../fixtures/test.fixture';
import { installAndroidTimerBridge } from '../focus-mode/android-timer-bridge';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';
import { installDevErrorDialogHandler } from '../../utils/runtime-errors';

/**
 * Runs the app as an Android WebView whose native alarm bridge only records
 * calls. Tests see what the app arms and cancels, not whether Android delivers.
 */
export type ReminderCall = {
  op: 'schedule' | 'cancel';
  id: number;
  reminderId?: string;
  triggerAtMs?: number;
};

type StoreState = {
  tasks: { ids: string[] };
  globalConfig: { reminder: Record<string, unknown> };
};

export type ReminderWindow = Window & {
  __reminderCalls: ReminderCall[];
  __e2eTestHelpers: {
    store: {
      dispatch: (action: { type: string; [key: string]: unknown }) => void;
      subscribe: (fn: (state: StoreState) => void) => { unsubscribe: () => void };
    };
  };
};

const installReminderRecorder = (): void => {
  if (window !== window.top) return;
  const calls: ReminderCall[] = [];
  const win = window as unknown as ReminderWindow & {
    SUPAndroid: Record<string, unknown>;
  };
  Object.assign(win.SUPAndroid, {
    scheduleNativeReminder: (
      id: number,
      reminderId: string,
      _relatedId: string,
      _title: string,
      _reminderType: string,
      triggerAtMs: number,
    ): void => {
      calls.push({ op: 'schedule', id, reminderId, triggerAtMs });
    },
    cancelNativeReminder: (id: number): void => {
      calls.push({ op: 'cancel', id });
    },
  });
  win.__reminderCalls = calls;
};

/** Test whose page starts at `startTime` (local) with the recording bridge. */
export const androidReminderTest = (startTime: string): typeof base =>
  base.extend({
    page: async ({ isolatedContext }, use) => {
      const page = await isolatedContext.newPage();
      installDevErrorDialogHandler(page, 'android-reminder');
      await page.clock.install({ time: new Date(startTime) });
      await page.addInitScript(skipOnboardingForE2E);
      await page.addInitScript(installAndroidTimerBridge);
      await page.addInitScript(installReminderRecorder);
      try {
        await page.goto('/');
        await waitForAppReady(page);
        await use(page);
      } finally {
        await page.close();
      }
    },
  });

export const readCalls = (page: Page): Promise<ReminderCall[]> =>
  page.evaluate(() => (window as unknown as ReminderWindow).__reminderCalls);

/** Saves a partial `reminder` settings section the way the settings form does. */
export const updateReminderCfg = (
  page: Page,
  sectionCfg: Record<string, unknown>,
): Promise<void> =>
  page.evaluate((cfg) => {
    (window as unknown as ReminderWindow).__e2eTestHelpers.store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'reminder',
      sectionCfg: cfg,
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'reminder',
        opType: 'UPD',
      },
    });
  }, sectionCfg);

export const readReminderCfg = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    let cfg: Record<string, unknown> = {};
    (window as unknown as ReminderWindow).__e2eTestHelpers.store
      .subscribe((state) => (cfg = state.globalConfig.reminder))
      .unsubscribe();
    return cfg;
  });
