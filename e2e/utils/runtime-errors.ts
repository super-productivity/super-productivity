import { test, type BrowserContext, type Page } from '@playwright/test';
import { recordSyncAudit } from './sync-audit';

export type RuntimeBrowserError = {
  type: 'pageerror' | 'devError';
  message: string;
};

// Collectors by page, so the devError dialog handler can report into the
// same list that closeClient()/context close assert on.
const collectorsByPage = new WeakMap<Page, RuntimeBrowserError[]>();
// devError messages a test expects, by Playwright test id.
const allowedDevErrorsByTest = new Map<string, RegExp[]>();

const currentTestId = (): string | undefined => {
  try {
    return test.info().testId;
  } catch {
    return undefined;
  }
};

/**
 * Lets the current test raise devError() messages matching `pattern` without
 * failing, e.g. a test that injects corrupt state on purpose to exercise
 * repair. Any other devError on a page with an error collector fails the test.
 */
export const allowDevErrorsInCurrentTest = (pattern: RegExp): void => {
  const testId = currentTestId();
  if (!testId) {
    throw new Error('allowDevErrorsInCurrentTest() must be called inside a test');
  }
  allowedDevErrorsByTest.set(testId, [
    ...(allowedDevErrorsByTest.get(testId) ?? []),
    pattern,
  ]);
};

const isDevErrorAllowed = (message: string): boolean => {
  const testId = currentTestId();
  const allowed = testId ? allowedDevErrorsByTest.get(testId) : undefined;
  return !!allowed?.some((pattern) => pattern.test(message));
};

/**
 * Reports page errors and devError() calls on `page` into an existing
 * collector, e.g. for a page a client opens later in the same context with
 * context.newPage(). A page that already has a collector is left alone.
 */
export const registerPageWithErrorCollector = (
  page: Page,
  errors: RuntimeBrowserError[],
  label: string,
): void => {
  if (collectorsByPage.has(page)) {
    return;
  }
  collectorsByPage.set(page, errors);
  page.on('pageerror', (error) => {
    const message = error.stack ?? error.message;
    console.error(`[${label}] Page error:`, message);
    errors.push({ type: 'pageerror', message });
  });
};

export const attachPageErrorCollector = (
  page: Page,
  label: string,
): RuntimeBrowserError[] => {
  const errors: RuntimeBrowserError[] = [];
  collectorsByPage.set(page, errors);

  page.on('pageerror', (error) => {
    const message = error.stack ?? error.message;
    console.error(`[${label}] Page error:`, message);
    errors.push({
      type: 'pageerror',
      message,
    });
  });

  return errors;
};

// devError() in non-production builds opens window.alert("devERR: …") and then
// window.confirm("Throw an error for error? ––– …"). Both are page-blocking and
// will hang any Playwright action (goto/click/waitFor) until handled. Tests
// that observe these dialogs explicitly can attach their own listener first;
// this fallback dismisses anything matching the devError shape so a stray call
// (e.g. selectProjectById on a project that sync just removed) fails the test
// with its real assertion instead of a 9-minute timeout.
//
// Call this on every Page created in E2E. It is wired into the default test
// fixture, setupSyncClient, createSimulatedClient, and createLegacyMigratedClient;
// any spec that builds its own context via browser.newContext() must invoke it
// explicitly, or it will be vulnerable to the same hang.
export const installDevErrorDialogHandler = (page: Page, label: string): void => {
  page.on('dialog', async (dialog) => {
    // Registering ANY 'dialog' listener switches off Playwright's built-in
    // handling (accept for beforeunload, dismiss for everything else). This
    // fallback is installed on every page, so it must restore that default for
    // beforeunload: startup.service raises one whenever a sync is in flight, and
    // an unanswered prompt blocks the navigation before it starts — reload()
    // then times out on any waitUntil, however early.
    if (dialog.type() === 'beforeunload') {
      try {
        await dialog.accept();
      } catch {
        // Already handled by another listener — ignore.
      }
      return;
    }

    const message = dialog.message();
    const isDevErrorAlert = dialog.type() === 'alert' && message.startsWith('devERR:');
    const isDevErrorConfirm =
      dialog.type() === 'confirm' && message.startsWith('Throw an error for error?');
    if (!isDevErrorAlert && !isDevErrorConfirm) {
      return;
    }
    console.warn(
      `[${label}] Auto-dismissing devError dialog (${dialog.type()}): ${message}`,
    );
    if (isDevErrorConfirm) {
      // devError() marks a broken internal invariant. In dev builds (CI runs
      // one) it never reaches console.error or a pageerror, so record it as a
      // runtime error unless the test expects it. Read it from the confirm:
      // devError() shows its alert only once per page load, but asks the
      // confirm on every call.
      const devErrorMessage = message.replace(/^Throw an error for error\? –+ ?/, '');
      recordSyncAudit('dev-error-dismissed', devErrorMessage);
      if (!isDevErrorAllowed(devErrorMessage)) {
        collectorsByPage
          .get(page)
          ?.push({ type: 'devError', message: `devERR: ${devErrorMessage}` });
      }
    }
    try {
      await dialog.dismiss();
    } catch {
      // Already handled by another listener — ignore.
    }
  });
};

export const assertNoRuntimeBrowserErrors = (
  errors: RuntimeBrowserError[],
  label: string,
): void => {
  if (errors.length === 0) {
    return;
  }

  throw new Error(
    `[${label}] Browser runtime errors were emitted during the test:\n${errors
      .map((error, index) => `${index + 1}. ${error.type}: ${error.message}`)
      .join('\n')}`,
  );
};

export const guardContextCloseWithRuntimeErrorCheck = (
  context: BrowserContext,
  errors: RuntimeBrowserError[],
  label: string,
): void => {
  const originalClose = context.close.bind(context);

  context.close = async (...args: Parameters<BrowserContext['close']>) => {
    let closeError: unknown;

    try {
      await originalClose(...args);
    } catch (error) {
      closeError = error;
    }

    assertNoRuntimeBrowserErrors(errors, label);

    if (closeError) {
      throw closeError;
    }
  };
};
