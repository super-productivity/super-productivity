import type { Page } from '@playwright/test';
import { waitForAppReady } from '../utils/waits';

type ControlledDocument = Window & { pwaInitialUpdateCheckComplete?: boolean };

export const reloadControlledDocument = async (
  page: Page,
  { bypassCachedImports = false }: { bypassCachedImports?: boolean } = {},
): Promise<void> => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const controlledDocument = window as ControlledDocument;
    controlledDocument.pwaInitialUpdateCheckComplete = false;
    navigator.serviceWorker.addEventListener('message', (event) => {
      const message = event.data as { type?: string; result?: boolean };
      if (message.type === 'OPERATION_COMPLETED' && message.result === false) {
        controlledDocument.pwaInitialUpdateCheckComplete = true;
      }
    });
  });
  if (bypassCachedImports) {
    await page.setExtraHTTPHeaders({ ['ngsw-bypass']: 'true' });
  }
  try {
    // Bypass cached imports too: a legacy worker can abort them before the app boots.
    await page.goto('/?ngsw-bypass=true', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    // The app's timeout also logs false, without completing the worker's update check.
    await page.waitForFunction(
      () => (window as ControlledDocument).pwaInitialUpdateCheckComplete,
      undefined,
      { timeout: 30000 },
    );
  } finally {
    if (bypassCachedImports) await page.setExtraHTTPHeaders({});
  }
  // Assign this document to the cached version before the server switches to v2.
  await page.evaluate(async () => {
    const response = await fetch('/manifest.json');
    if (!response.ok) throw new Error('Unable to load the cached PWA manifest');
    await response.json();
  });
};
