/**
 * E2E coverage for the new `autoStartFocusOnPlay` opt-in.
 *
 * Behavior under test (from
 * docs/plans/2026-04-29-focus-mode-time-tracking-sync.md): when the user
 * enables this setting and starts tracking a task, a focus session must
 * spawn automatically *without* opening the focus-mode overlay — the
 * header focus-button countdown is the only surface.
 *
 * If this regresses, the headline feature of the rework is broken with
 * no other automated test catching it.
 */

import { test, expect } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const enableAutoStartOnPlay = async (page: Page): Promise<void> => {
  await page.goto('/#/config');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // Navigate to Productivity tab
  const productivityTab = page.locator('[role="tab"]', { hasText: /Productivity/i });
  if (await productivityTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await productivityTab.click();
    await page.waitForTimeout(500);
  }

  // Find and expand the Focus Mode section
  const focusModeSection = page
    .locator('config-section')
    .filter({ hasText: 'Focus Mode' })
    .first();
  await focusModeSection.scrollIntoViewIfNeeded();

  const collapsible = focusModeSection.locator('collapsible');
  const isExpanded = await collapsible
    .evaluate((el) => el.classList.contains('isExpanded'))
    .catch(() => false);

  if (!isExpanded) {
    const header = collapsible.locator('.collapsible-header');
    await header.click();
    await page.waitForTimeout(500);
  }

  const toggle = page
    .locator('mat-slide-toggle')
    .filter({ hasText: 'Start a focus session when I start tracking a task' })
    .first();

  await expect(toggle).toBeVisible({ timeout: 5000 });
  const cls = (await toggle.getAttribute('class')) ?? '';
  if (!cls.includes('mat-checked')) {
    await toggle.click();
    await page.waitForTimeout(300);
  }
};

test.describe('autoStartFocusOnPlay', () => {
  test('pressing play with the opt-in on starts a focus session indicator-only (no overlay)', async ({
    page,
    workViewPage,
  }) => {
    const focusOverlay = page.locator('focus-mode-overlay');
    const focusRunningLabel = page.locator('focus-button .focus-running-label');

    // Step 1: enable the new setting via Settings UI.
    await enableAutoStartOnPlay(page);

    // Step 2: navigate back to work view and add a task.
    await page.goto('/');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('AutoStartTask');

    const firstTask = page.locator('task').first();
    await expect(firstTask).toBeVisible();

    // Sanity: overlay must not be open before we press play.
    await expect(focusOverlay).not.toBeVisible();

    // Step 3: start tracking via the task's play button.
    await firstTask.hover();
    const trackingPlayBtn = page.locator('.play-btn.tour-playBtn').first();
    await trackingPlayBtn.waitFor({ state: 'visible' });
    await trackingPlayBtn.click();
    await expect(firstTask).toHaveClass(/isCurrent/, { timeout: 5000 });

    // Expected: focus session spawns and the header countdown becomes the
    // surface (per the rework, the overlay must NOT auto-open here).
    await expect(focusRunningLabel).toBeVisible({ timeout: 5000 });
    await expect(focusOverlay).not.toBeVisible();
  });

  test('with the opt-in OFF (default), pressing play does not spawn a focus session', async ({
    page,
    workViewPage,
  }) => {
    const focusOverlay = page.locator('focus-mode-overlay');
    const focusRunningLabel = page.locator('focus-button .focus-running-label');

    await workViewPage.waitForTaskList();
    await workViewPage.addTask('NoAutoStartTask');

    const firstTask = page.locator('task').first();
    await expect(firstTask).toBeVisible();

    await firstTask.hover();
    const trackingPlayBtn = page.locator('.play-btn.tour-playBtn').first();
    await trackingPlayBtn.waitFor({ state: 'visible' });
    await trackingPlayBtn.click();
    await expect(firstTask).toHaveClass(/isCurrent/, { timeout: 5000 });

    // Tracking is on, but no focus session — countdown badge stays hidden,
    // overlay stays closed.
    await expect(focusOverlay).not.toBeVisible();
    // Wait a beat in case the spawn is async; assert it never appears.
    await page.waitForTimeout(1000);
    await expect(focusRunningLabel).not.toBeVisible();
  });
});
