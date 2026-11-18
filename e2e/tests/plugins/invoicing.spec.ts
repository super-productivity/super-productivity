import * as fs from 'fs';
import type { Frame, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';
import { getTaskTimeSpentFromState } from '../../utils/supersync-helpers';

const PLUGIN_IFRAME = 'plugin-index iframe';
const TASK = 'Invoice me task';

const todayStr = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type PrintLog = { printed: string[] };

// The plugin view is a srcdoc iframe; window.print is replaced so the test can
// see that printing was requested, and the app window title the print dialog
// suggests as the PDF file name, without a native dialog.
const pluginFrame = async (page: Page): Promise<Frame> => {
  const handle = await page.locator(PLUGIN_IFRAME).elementHandle();
  const frame = await handle!.contentFrame();
  await frame!.evaluate(() => {
    const log = window as unknown as PrintLog;
    log.printed = [];
    window.print = () => {
      log.printed.push(window.top!.document.title);
    };
  });
  return frame!;
};

const printedTitles = (frame: Frame): Promise<string[]> =>
  frame.evaluate(() => (window as unknown as PrintLog).printed);

test.describe('Invoicing plugin', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    test.setTimeout(90000 * getCITimeoutMultiplier());
    if (!(await waitForPluginAssets(page))) {
      throw new Error('Plugin assets not available — run `npm run prebuild`');
    }
    await workViewPage.waitForTaskList();
    expect(await waitForPluginManagementInit(page)).toBeTruthy();
    expect(await enablePluginWithVerification(page, 'Invoicing')).toBeTruthy();
  });

  test('bills tracked time once and frees it again when the invoice is deleted', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(TASK);
    const task = taskPage.getTaskByText(TASK);
    // Same start pattern as time-spent-survives-reload.spec.ts: the start
    // button only appears on hover.
    await expect(async () => {
      if (!(await task.evaluate((n) => n.classList.contains('isCurrent')))) {
        await task.hover();
        await task.locator('.start-task-btn').click({ timeout: 2000 });
      }
      await expect(task).toHaveClass(/\bisCurrent\b/, { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await expect
      .poll(() => getTaskTimeSpentFromState({ page }, TASK), { timeout: 15000 })
      .toBeGreaterThanOrEqual(2000);
    // Stop tracking, or time added after issuing would show up as unbilled.
    await page.locator('play-button .play-btn').click();
    await expect(task).not.toHaveClass(/\bisCurrent\b/);

    await page.goto('/#/plugins/invoicing/index');
    const ui = page.frameLocator(PLUGIN_IFRAME);

    // Your details, with 6-minute rounding so a few seconds bill as 0.1 h.
    await ui.getByLabel('Your name, address and tax ID').fill('Me Freelance');
    await ui.getByLabel('Round each line up to').selectOption('6');
    await ui.getByRole('button', { name: 'Save' }).click();

    await ui.getByLabel('Project').selectOption({ label: 'Inbox' });
    await ui.getByLabel('To', { exact: true }).fill(todayStr());
    await ui.getByLabel('To', { exact: true }).dispatchEvent('change');
    await expect(ui.locator('tbody input[type="number"]')).toHaveValue('0.1');
    await ui.getByLabel('Hourly rate').fill('100');
    await ui.getByLabel('Bill to').fill('ACME Corp\nMain St 1');
    await expect(ui.getByLabel('Invoice language')).toHaveValue('en');
    await ui.getByLabel('Invoice language').selectOption({ label: 'Deutsch' });
    await expect(ui.getByText('Total: €10.00')).toBeVisible();

    // Saving your details again keeps the half-finished invoice.
    await ui.locator('summary').click();
    await ui.getByRole('button', { name: 'Save' }).click();
    await expect(ui.locator('summary')).toBeFocused();
    await expect(ui.getByLabel('Hourly rate')).toHaveValue('100');
    await expect(ui.getByLabel('Bill to')).toHaveValue('ACME Corp\nMain St 1');
    await expect(ui.getByLabel('Invoice language')).toHaveValue('de');

    const frame = await pluginFrame(page);
    await ui.getByRole('button', { name: 'Issue and print' }).click();

    await expect(ui.getByText(/^001 · .* · ACME Corp · €10\.00$/)).toBeVisible();
    await expect(ui.locator('[data-invoice-id] button').first()).toBeFocused();
    await expect(ui.getByText('No unbilled time on this project')).toBeVisible();
    expect(await printedTitles(frame)).toEqual(['Rechnung 001 - ACME Corp']);
    // Remembered for the project, after the draft is gone.
    await expect(ui.getByLabel('Invoice language')).toHaveValue('de');
    const printed = ui.locator('#print-root');
    await expect(printed).toContainText('Me Freelance');
    await expect(printed).toContainText(TASK);
    // In the invoice language, not the app language.
    await expect(printed.locator('h1')).toHaveText('Rechnung');
    await expect(printed).toContainText(/10,00\s€/);

    // Printing again from the list keeps the language and the file name.
    await printed.evaluate((node) => (node.innerHTML = ''));
    await ui.getByRole('button', { name: 'Print / PDF' }).click();
    await expect(printed.locator('h1')).toHaveText('Rechnung');
    expect(await printedTitles(frame)).toEqual([
      'Rechnung 001 - ACME Corp',
      'Rechnung 001 - ACME Corp',
    ]);
    await expect(page).not.toHaveTitle(/Rechnung/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      ui.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('invoice-001.csv');
    const csv = fs.readFileSync((await download.path())!, 'utf8');
    // Byte order mark first, so Excel reads accents correctly.
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [header, line, ...rest] = csv.slice(1).split('\n');
    expect(header).toBe('Invoice,Date,Description,Hours,Rate,Amount,Currency');
    // The fixture prefixes task titles per worker.
    expect(line).toMatch(
      new RegExp(`^001,${todayStr()},\\S*${TASK},0\\.10,100\\.00,10\\.00,EUR$`),
    );
    expect(rest).toEqual(['']);

    page.once('dialog', (dialog) => dialog.accept());
    await ui.getByRole('button', { name: 'Delete' }).click();
    await expect(ui.getByText('No invoices yet.')).toBeVisible();
    await expect(ui.getByRole('heading', { name: 'Invoices' })).toBeFocused();
    await ui.getByLabel('Project').selectOption({ label: 'Inbox' });
    await ui.getByLabel('To', { exact: true }).fill(todayStr());
    await ui.getByLabel('To', { exact: true }).dispatchEvent('change');
    await expect(ui.locator('tbody input[type="number"]')).toHaveValue('0.1');
  });
});
