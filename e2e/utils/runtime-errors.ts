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
