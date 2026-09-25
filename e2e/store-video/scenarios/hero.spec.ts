/**
 * Landing-page hero (`REEL_VARIANT=hero`, or `hero-light` for the light
 * theme): a silent 4:3 loop. Three typed lines show short syntax turning plain
 * text into set-up tasks — estimate, tag, due time, project, repeat — then
 * one click starts time tracking. No captions: the page's headline does the
 * talking. It ends on its own first frame, so the loop has no visible seam.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixture';
import { dispatch, hold } from '../helpers';
import { createPointer, markScene, showStill, typeText } from '../../video-kit';

// Each line ends on a token without a suggestion menu (`#tag`, `+project`
// and `@daily` open one), so Enter adds the task instead of picking a
// suggestion.
// Fewer seeded tasks, so every new task, including the timed one under
// "Later Today", stays in the 576px frame.
const TRIMMED_TASK_IDS = [
  't-design-review',
  't-release-handoff',
  't-water-plants',
  't-issue-triage',
];

const LINES = [
  { text: 'Draft launch post 1h #important @4pm', title: 'Draft launch post' },
  { text: 'Plan weekend trip +Personal 45m', title: 'Plan weekend trip' },
  { text: 'Stretch #home @daily 10m', title: 'Stretch' },
];

const frameUri = async (page: Page): Promise<string> =>
  `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;

const VARIANT = process.env.REEL_VARIANT ?? '';

test.describe('@video hero', () => {
  test.skip(
    VARIANT !== 'hero' && VARIANT !== 'hero-light',
    'requires REEL_VARIANT=hero or hero-light',
  );
  test.use({ locale: 'en', theme: VARIANT === 'hero-light' ? 'light' : 'dark' });

  test('short syntax sets up tasks as you type', async ({
    seededPage: page,
    markBeatsStart,
  }) => {
    const pointer = createPointer(page);
    // The add bar parses on timers; a paused clock would freeze the highlights.
    await page.clock.resume();
    await page.goto('/#/tag/TODAY/tasks');
    // Lead-in state prep; the build trims everything before markBeatsStart.
    await dispatch(page, {
      type: '[Task Shared] deleteTasks',
      taskIds: TRIMMED_TASK_IDS,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: TRIMMED_TASK_IDS,
        opType: 'DEL',
        isBulk: true,
      },
    });
    await expect(page.locator('task')).toHaveCount(2);
    await pointer.park();
    await hold(600);
    const firstFrame = await frameUri(page);

    markBeatsStart();
    await hold(900);

    const addButton = page.locator('main-header button.tour-addBtn');
    const bar = page.locator('add-task-bar.global');
    for (const line of LINES) {
      markScene(page, line.title);
      // A fresh bar per task: consecutive adds keep the last project, date
      // and estimate, which would blur what each line sets.
      await pointer.glideTo(addButton);
      await addButton.click();
      await expect(bar.locator('.main-input')).toBeFocused();
      await hold(250);
      await typeText(page, line.text, { delayMs: 70 });
      // Let the highlighted tokens and chips register before they apply.
      await hold(800);
      await page.keyboard.press('Enter');
      // Repeating tasks are added asynchronously; closing first would drop them.
      await expect(
        page.locator('task').filter({ hasText: line.title }).first(),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(bar).toBeHidden();
      await hold(1300);
    }

    markScene(page, 'Track');
    // Starts the top task, the one just added; its timer ticks in the row.
    const playButton = page.locator('main-header .play-btn');
    await pointer.glideTo(playButton);
    await playButton.click();
    await expect(page.locator('task.isCurrent')).toHaveCount(1);
    await hold(700);
    // Time lapse: the row shows whole minutes, so real seconds would show no
    // change. Each jump fires the tracking tick with a minute's delta.
    for (let minute = 0; minute < 4; minute++) {
      await page.clock.fastForward(60_000);
      await hold(450);
    }
    await hold(800);
    await pointer.park();
    await hold(1200);

    markScene(page, 'Loop');
    // A still of the live page swaps in unseen, then crossfades to the first
    // frame, so the video ends where it starts.
    const stills = await showStill(page, await frameUri(page), { fadeMs: 700 });
    await stills.crossfadeTo(firstFrame);
    await hold(100);
  });
});
