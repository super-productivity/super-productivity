import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';
import { createView, readBoard, seedInboxTasks } from '../../utils/view-helpers';

/**
 * Table: a list view with a header row and fixed-width columns after the
 * title (Project and Tags by default), resizable, stored with the view.
 */

const viewId = (page: Page): string => page.url().match(/#\/boards\/([^/?]+)/)?.[1] ?? '';

/**
 * How far apart a picked column's left edges are across the header and
 * every row, in px (0 = aligned; ≤ 1 is subpixel rounding).
 */
const colSpread = (page: Page, col: string): Promise<number> =>
  page.locator(`boards [data-col="${col}"]`).evaluateAll((els) => {
    const lefts = els.map((el) => el.getBoundingClientRect().left);
    return Math.max(...lefts) - Math.min(...lefts);
  });

test.describe('View table layout', () => {
  test('shows aligned columns, edits a cell, and stores a resize', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    // A project to move to.
    await projectPage.createProject('Target');
    await seedInboxTasks(page, [
      `${testPrefix}-short`,
      `${testPrefix}-${'long '.repeat(30)}`,
    ]);
    await createView(page, {
      title: `${testPrefix}-Table`,
      layout: 'table',
      sections: [{ title: 'One' }, { title: 'Two' }],
    });
    const id = viewId(page);
    expect(await readBoard(page, id)).toEqual(
      expect.objectContaining({ cols: 1, listStyle: 'table' }),
    );

    // A header per section.
    const headers = page.locator('boards board-table-header');
    await expect(headers).toHaveCount(2);
    const header = headers.first();
    await expect(header.getByRole('columnheader')).toHaveText([
      'Title',
      'Project',
      'Tags',
    ]);
    const rows = page.locator('boards task.isTableRow');
    await expect(rows).toHaveCount(4);

    // Every row's Project and Tags cell starts where its header does, across
    // both sections and with long or short titles.
    for (const col of ['project', 'tags']) {
      await expect.poll(() => colSpread(page, col)).toBeLessThanOrEqual(1);
    }
    // Short rows, long titles on one line, also while hovered.
    const firstLineHeights = (): Promise<number[]> =>
      rows.evaluateAll((els) =>
        els.map((el) =>
          Math.round(el.querySelector('.first-line')!.getBoundingClientRect().height),
        ),
      );
    await expect
      .poll(async () => Math.max(...(await firstLineHeights())))
      .toBeLessThanOrEqual(30);
    await rows.nth(1).hover();
    await expect(rows.nth(1).locator('task-hover-controls')).toBeVisible();
    expect(Math.max(...(await firstLineHeights()))).toBeLessThanOrEqual(30);

    const projectChip = rows.first().locator('.table-cell[data-col="project"] tag');
    await expect(projectChip).toHaveText(/Inbox/);
    // A click on the project chip moves the task (like tags), not navigates.
    const url = page.url();
    // The plain chip lets clicks through to its cell (force: the cell
    // takes the click at the chip's spot).
    await projectChip.click({ force: true });
    await expect(
      page.locator('.mat-mdc-menu-panel').getByRole('menuitem', { name: /Target/ }),
    ).toBeVisible();
    expect(page.url()).toBe(url);
    await page.keyboard.press('Escape');
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);

    // The handle is room to click the row: it edits nothing, and a
    // Ctrl+click there selects like anywhere else on the row.
    const handle0 = rows.first().locator('.table-handle');
    await handle0.click();
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    await expect(page.locator('mat-dialog-container')).toHaveCount(0);
    await handle0.click({ modifiers: ['ControlOrMeta'] });
    await rows
      .nth(1)
      .locator('.table-handle')
      .click({ modifiers: ['ControlOrMeta'] });
    // Both sections list the same tasks: count the first section's rows.
    await expect(
      page.locator('boards board-panel').first().locator('task.isMultiSelected'),
    ).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('boards task.isMultiSelected')).toHaveCount(0);

    // A click on the tags cell opens the row's tag menu, under that cell.
    const tagsCell = rows.first().locator('.table-cell[data-col="tags"]');
    await tagsCell.click();
    const menu = page.locator('.mat-mdc-menu-panel');
    await expect(menu).toBeVisible();
    const cellBox = (await tagsCell.boundingBox())!;
    await expect
      .poll(async () => Math.abs((await menu.boundingBox())!.x - cellBox.x))
      .toBeLessThanOrEqual(24);
    await page.keyboard.press('Escape');

    // Dragging the Tags divider left widens it; stored once on release.
    const handle = header.locator('[data-col="tags"] .resize-handle');
    const box = (await handle.boundingBox())!;
    const halfWidth = box.width / 2;
    const halfHeight = box.height / 2;
    const x = box.x + halfWidth;
    const y = box.y + halfHeight;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, { steps: 5 });
    await page.mouse.up();
    // Stored on that section only; the other keeps its widths.
    const sectionCols = async (i: number): Promise<unknown> =>
      ((await readBoard(page, id))?.panels[i] as { tableCols?: unknown } | undefined)
        ?.tableCols;
    await expect
      .poll(() => sectionCols(0))
      .toEqual([
        { id: 'title' },
        { id: 'project', width: 160 },
        { id: 'tags', width: 260 },
      ]);
    expect(await sectionCols(1)).toBeUndefined();
    await expect(headers.nth(1).locator('[data-col="tags"]')).toHaveCSS('width', '200px');

    // A click on a column name sorts that section by it (ascending, then
    // descending), leaving the other section's order alone.
    const sectionSort = async (
      i: number,
    ): Promise<{ sortBy?: string; sortDir?: string } | undefined> =>
      (await readBoard(page, id))?.panels[i] as { sortBy?: string; sortDir?: string };
    await header.getByRole('button', { name: 'Title', exact: true }).click();
    await expect.poll(async () => (await sectionSort(0))?.sortBy).toBe('title');
    expect((await sectionSort(0))?.sortDir).toBe('asc');
    expect((await sectionSort(1))?.sortBy).toBeUndefined();
    await header.getByRole('button', { name: 'Title', exact: true }).click();
    await expect.poll(async () => (await sectionSort(0))?.sortDir).toBe('desc');
    await expect(header.getByRole('columnheader').first()).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await waitForStatePersistence(page);
    await page.reload();
    await expect(
      page.locator('boards board-table-header [data-col="tags"]').first(),
    ).toHaveCSS('width', '260px');
  });

  test('on phones a table shows as a list and keeps its layout', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await seedInboxTasks(page, [`${testPrefix}-a`]);
    await createView(page, { title: `${testPrefix}-Phone`, layout: 'table' });
    const id = viewId(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.locator('boards board-table-header')).toHaveCount(0);
    await expect(page.locator('boards task.isTableRow')).toHaveCount(0);
    await expect(page.locator('boards task')).toHaveCount(1);
    expect((await readBoard(page, id))?.listStyle).toBe('table');

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('boards board-table-header')).toBeVisible();
    // One section (no collapsible around the rows): still aligned.
    await expect(page.locator('boards task.isTableRow')).toHaveCount(1);
    for (const col of ['project', 'tags']) {
      await expect.poll(() => colSpread(page, col)).toBeLessThanOrEqual(1);
    }
  });

  test('the header stays at the top edge while the rows scroll', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await seedInboxTasks(
      page,
      Array.from({ length: 60 }, (_, i) => `${testPrefix}-${i}`),
    );
    await createView(page, { title: `${testPrefix}-Scroll`, layout: 'table' });
    const board = page.locator('boards board');
    await expect(page.locator('boards task.isTableRow')).toHaveCount(60);
    await board.evaluate((el) => el.scrollBy(0, 600));
    // Nothing shows above it: it covers the board's padding too.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const boardTop = document
            .querySelector('boards board')!
            .getBoundingClientRect().top;
          const headerTop = document
            .querySelector('boards board-table-header')!
            .getBoundingClientRect().top;
          return Math.round(headerTop - boardTop);
        }),
      )
      .toBe(0);
  });
});
