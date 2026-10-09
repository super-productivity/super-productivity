import { expect, test } from '@playwright/test';
import { waitForAppReady } from '../../utils/waits';

test('ready app does not wait for an absent confirmation dialog', async ({ page }) => {
  await page.setContent(`
    <dialog-confirm hidden><button e2e="confirmBtn">Hidden</button></dialog-confirm>
    <div class="route-wrapper"><main>Ready</main></div>
  `);
  const start = performance.now();
  await waitForAppReady(page, { ensureRoute: false });
  // The old dialog grace period alone took 2000ms on an already-ready page.
  expect(performance.now() - start).toBeLessThan(1500);
});

test('empty shell waits for a delayed startup dialog', async ({ page }) => {
  await page.setContent(`
    <div class="route-wrapper"><router-outlet></router-outlet></div>
    <script>
      setTimeout(() => {
        const dialog = document.createElement('dialog-confirm');
        dialog.innerHTML = '<button e2e="confirmBtn">Continue</button>';
        dialog.querySelector('button').onclick = () => {
          dialog.remove();
          document.querySelector('.route-wrapper').innerHTML = '<main>Ready</main>';
        };
        document.body.append(dialog);
      }, 300);
    </script>
  `);
  await waitForAppReady(page, { ensureRoute: false });
  await expect(page.locator('main')).toHaveText('Ready');
  await expect(page.locator('dialog-confirm')).toHaveCount(0);
});

test('dismisses chained dialogs even with a rendered route', async ({ page }) => {
  await page.setContent(`
    <div class="route-wrapper"><main>Loading</main></div>
    <dialog-confirm><button e2e="confirmBtn">Continue</button></dialog-confirm>
    <script>
      document.querySelector('button').onclick = () => {
        document.querySelector('dialog-confirm').remove();
        setTimeout(() => {
          const nextDialog = document.createElement('dialog-confirm');
          nextDialog.innerHTML = '<button e2e="confirmBtn">Confirm repair</button>';
          nextDialog.querySelector('button').onclick = () => {
            nextDialog.remove();
            document.querySelector('main').textContent = 'Ready';
          };
          document.body.append(nextDialog);
        }, 100);
      };
    </script>
  `);
  await waitForAppReady(page, { ensureRoute: false });
  await expect(page.locator('main')).toHaveText('Ready');
  await expect(page.locator('dialog-confirm')).toHaveCount(0);
});

test('loading overlay prevents the ready-route shortcut', async ({ page }) => {
  await page.setContent(`
    <div class="route-wrapper"><main>Loading</main></div>
    <div class="loading-full-page-wrapper">Loading</div>
    <script>
      setTimeout(() => {
        const dialog = document.createElement('dialog-confirm');
        dialog.innerHTML = '<button e2e="confirmBtn">Continue</button>';
        dialog.querySelector('button').onclick = () => {
          dialog.remove();
          document.querySelector('.loading-full-page-wrapper').remove();
          document.querySelector('main').textContent = 'Ready';
        };
        document.body.append(dialog);
      }, 300);
    </script>
  `);
  await waitForAppReady(page, { ensureRoute: false });
  await expect(page.locator('main')).toHaveText('Ready');
});
