import type { BrowserContext, Page } from '@playwright/test';

export type RuntimeBrowserError = {
  type: 'pageerror';
  message: string;
};

export const attachPageErrorCollector = (
  page: Page,
  label: string,
): RuntimeBrowserError[] => {
  const errors: RuntimeBrowserError[] = [];

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
