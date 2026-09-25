/**
 * Time-tracking reel (`REEL_VARIANT=time`): start a timer with one click, watch
 * a time-lapse fill the estimate, switch tasks, then wrap up in the daily summary.
 * Also the first reel written against the extracted video-kit from scratch.
 */
import { expect, test } from '../fixture';
import { hold } from '../helpers';
import {
  createCamera,
  createPointer,
  type LayerHandle,
  loopBoundary,
  markScene,
  nextScene,
  showEndCard,
  showKeyChip,
  timeLapse,
} from '../../video-kit';

test.describe('@video time-tracking reel', () => {
  test.skip(process.env.REEL_VARIANT !== 'time', 'requires REEL_VARIANT=time');
  test.use({ locale: 'en', theme: 'dark' });

  test('track time with one click', async ({ seededPage: page, markBeatsStart }) => {
    const pointer = createPointer(page);
    const camera = createCamera(page, 'app-root');
    await page.clock.resume();
    await page.goto('/#/tag/TODAY/tasks');
    const review = page.locator('task[data-task-id="t-pr-review"]');
    const handoff = page.locator('task[data-task-id="t-release-handoff"]');
    await expect(review).toBeVisible();
    await pointer.park();

    const intro = await showEndCard(page, {
      title: 'Where did the day go?',
      logo: { src: '/assets/icons/sp.svg', monochrome: true },
    });
    await loopBoundary(page, 'out', 0);
    markBeatsStart();
    await hold(200);
    await loopBoundary(page, 'in', 450);
    await hold(1800);

    let caption: LayerHandle | undefined = await nextScene(page, {
      caption: 'One click starts the timer.',
      pointer,
      setup: () => intro.hide(),
    });
    const start = review.locator('.start-task-btn');
    await pointer.glideTo(review);
    await pointer.glideTo(start, { durationMs: 450 });
    await start.click();
    await expect(review).toHaveClass(/isCurrent/);
    // Hovered rows swap the time readout for controls; park before framing it.
    await pointer.park();
    const reviewTime = review.locator('.time-wrapper').first();
    const reviewTitle = review.locator('task-title');
    await camera.zoomTo([reviewTitle, reviewTime], { scale: 1.1 });
    await expect(reviewTitle).toBeInViewport({ ratio: 0.999 });
    await expect(reviewTime).toBeInViewport({ ratio: 0.999 });

    const lapse = await showKeyChip(page, '⏩ time-lapse', { noWait: true });
    await timeLapse(page, 30 * 60_000);
    await expect(review.locator('.time-val').first()).toContainText('30m');
    await lapse.hide();
    await hold(900);

    caption = await nextScene(page, {
      caption: 'Switch tasks. Time follows.',
      pointer,
      camera,
    });
    const next = handoff.locator('.start-task-btn');
    await pointer.glideTo(handoff);
    await pointer.glideTo(next, { durationMs: 450 });
    await next.click();
    await expect(handoff).toHaveClass(/isCurrent/);
    await expect(review).not.toHaveClass(/isCurrent/);
    await pointer.park();
    // Both readouts in frame: the first stays at 30m while the second climbs.
    const handoffTime = handoff.locator('.time-wrapper').first();
    const handoffTitle = handoff.locator('task-title');
    await camera.zoomTo([reviewTitle, reviewTime, handoffTitle, handoffTime], {
      scale: 1.1,
      durationMs: 700,
    });
    await expect(reviewTitle).toBeInViewport({ ratio: 0.999 });
    await expect(handoffTitle).toBeInViewport({ ratio: 0.999 });
    await expect(handoffTime).toBeInViewport({ ratio: 0.999 });
    const lapseAgain = await showKeyChip(page, '⏩ time-lapse', { noWait: true });
    await timeLapse(page, 20 * 60_000);
    await expect(handoff.locator('.time-val').first()).toContainText('20m');
    await lapseAgain.hide();
    await hold(500);
    await camera.reset();
    // Checking the first task off gives the summary a completed task to show.
    const reviewDone = review.locator('done-toggle').first();
    await pointer.glideTo(reviewDone, { durationMs: 600 });
    await reviewDone.click();
    // The list shifts up under the cursor; park before it hovers the next row.
    await pointer.park();
    // An invisible leaving copy can linger mid-animation, so match the done row.
    await expect(page.locator('task.isDone[data-task-id="t-pr-review"]')).toBeVisible();
    await hold(900);

    caption = await nextScene(page, {
      caption: 'Wrap up your day.',
      pointer,
      camera,
      setup: async () => {
        await page.goto('/#/tag/TODAY/daily-summary');
        await expect(page.locator('daily-summary')).toBeVisible();
      },
    });
    await hold(500);
    const stats = page.locator('.daily-summary-summary');
    await expect(stats).toContainText('1 / 5');
    await camera.zoomTo(stats, { scale: 1.4, durationMs: 800 });
    await hold(1400);
    await camera.reset({ durationMs: 500 });
    // The Work table holds the tracked time; it sits below the fold.
    const workTable = page
      .locator('task-summary-tables .project-section')
      .filter({ has: page.locator('h3', { hasText: /^Work$/ }) });
    await expect(workTable).toContainText('0:30');
    await workTable.evaluate((el) =>
      el.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    await hold(700);
    await camera.zoomTo(workTable, { scale: 1.3, durationMs: 700 });
    await hold(1800);

    markScene(page, 'Time, well spent.');
    await showEndCard(page, {
      title: 'Time, well spent.',
      subtitle: 'Super Productivity',
      stats: ['superproductivity.com'],
      logo: { src: '/assets/icons/sp.svg', monochrome: true },
    });
    void caption?.hide();
    await hold(2500);
    await loopBoundary(page, 'out', 350);
  });
});
