/** Caption-led v18 → v19.1 highlights, captured through the existing reel pipeline. */
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForMenuSettled } from '../../utils/waits';
import { expect, test } from '../fixture';
import { dispatch, hold } from '../helpers';
import {
  type CaptionHandle,
  createCamera,
  createPointer,
  cutToScene,
  type LayerHandle,
  loopBoundary,
  markScene,
  nextScene,
  settleScene,
  showCaption,
  showEndCard,
  showKeyChip,
  showOverlay,
  showStill,
  type StillHandle,
  typeText,
} from '../../video-kit';

const THEME_FADE_MS = 400;

test.describe('@video updates reel', () => {
  test.skip(process.env.REEL_VARIANT !== 'updates', 'requires REEL_VARIANT=updates');
  test.use({ locale: 'en', theme: 'dark' });

  test('what changed since v18', async ({ seededPage: page, markBeatsStart }) => {
    const workView = new WorkViewPage(page);
    // Glide the cursor between targets instead of letting clicks teleport it.
    const pointer = createPointer(page);
    // Paint-only zoom on the app; captions, cursor and key chips stay unzoomed.
    const camera = createCamera(page, 'app-root');
    await page.clock.resume();
    await page.goto('/#/project/work/tasks');
    await workView.waitForTaskList();

    // Capture real theme previews before the reel, using the appearance controls.
    const themes = [
      // Rainbow first: it differs most from the dark default, so the beat reads at once.
      { id: 'rainbow', name: 'Rainbow', mode: 'dark' },
      { id: 'liquid-glass', name: 'Liquid Glass', mode: 'light' },
      { id: 'plainspace', name: 'Plainspace', mode: 'light' },
      { id: 'velvet', name: 'Velvet', mode: 'dark' },
    ];
    const themeFrames: { name: string; src: string }[] = [];
    for (const theme of [...themes, { id: 'default', name: 'Default', mode: 'dark' }]) {
      await page.goto('/#/config');
      await page.locator('theme-selector mat-select').click();
      if (theme.id === 'default') {
        // The first option can sit outside the overlay viewport after prior selections.
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
      } else {
        await page.getByRole('option', { name: new RegExp(theme.name) }).click();
      }
      const mode = page.locator(`mat-button-toggle[value="${theme.mode}"] button`);
      if (theme.mode === 'light' || theme.id === 'default') {
        await expect(mode).toBeEnabled();
        await mode.click();
      }
      await expect(page.locator('body')).toHaveClass(
        theme.mode === 'dark' ? /isDarkTheme/ : /isLightTheme/,
      );
      if (theme.id !== 'default') {
        await expect(page.locator('#custom-theme-stylesheet')).toHaveAttribute(
          'href',
          new RegExp(`${theme.id}\\.css$`),
        );
      }
      await page.goto('/#/project/work/tasks');
      await workView.waitForTaskList();
      await page.mouse.move(0, 0);
      if (theme.id !== 'default') {
        const frame = await page.screenshot({ animations: 'disabled' });
        themeFrames.push({
          name: theme.name,
          src: `data:image/png;base64,${frame.toString('base64')}`,
        });
      }
    }

    await expect(page.locator('body')).not.toHaveClass(/isDisableAnimations/);

    // Prepare an empty section through the same dialog users use.
    await page.locator('.project-settings-btn').click();
    await waitForMenuSettled(page);
    await page.getByRole('menuitem', { name: 'Add Section' }).click();
    const prompt = page.locator('mat-dialog-container');
    await prompt.locator('input[type="text"]').fill('Ready to ship');
    await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(prompt).not.toBeVisible();
    const section = page.locator('.section-container').filter({
      has: page.locator('.collapsible-title', { hasText: 'Ready to ship' }),
    });
    await expect(section).toBeVisible();
    await pointer.park();

    const intro = await showEndCard(page, {
      title: 'A lot has changed.',
      subtitle: 'Super Productivity · v18 → v19.1',
      logo: { src: '/assets/icons/sp.svg', monochrome: true },
    });
    // Start on black so the loop seam is black-to-black.
    await loopBoundary(page, 'out', 0);
    markBeatsStart();
    await hold(200);
    await loopBoundary(page, 'in', 450);
    await hold(2000);

    let caption: LayerHandle | undefined = await showOverlay(
      page,
      'Select once. Act on many.',
      { noWait: true },
    );
    await cutToScene(page, async () => intro.hide(), {
      fadeMs: 180,
      label: 'Select once. Act on many.',
    });
    const first = page.locator('task[data-task-id="t-design-review"]');
    const second = page.locator('task[data-task-id="t-release-handoff"]');
    // Above the caption, where the eye already is; the corner sits on the toolbar.
    const modifierChip = await showKeyChip(page, 'Ctrl + Click', {
      noWait: true,
      position: 'above-caption',
    });
    await pointer.glideTo(first);
    await first.click({ modifiers: ['Control'] });
    await hold(400);
    await pointer.glideTo(second);
    await second.click({ modifiers: ['Control'] });
    const selection = page.locator('task-multi-select-bar .bar');
    await expect(selection).toContainText('2 selected');
    await hold(900);
    await modifierChip.hide();
    await hold(200);
    // Reveal the bottom action bar before interacting with it.
    await caption.hide();
    caption = undefined;
    const actions = selection.getByRole('button', { name: 'Actions' });
    await pointer.glideTo(actions, { durationMs: 550 });
    await actions.click();
    await waitForMenuSettled(page);
    await hold(500);
    const complete = page.locator('.mat-mdc-menu-content button', {
      hasText: 'Mark as completed',
    });
    await pointer.glideTo(complete, { durationMs: 250, fromLeft: true });
    await complete.click();
    // Completed rows animate into the done list; wait until the leaving copies are gone.
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await expect(first).toHaveClass(/isDone/);
    await expect(second).toHaveClass(/isDone/);
    await hold(1200);

    caption = await nextScene(page, {
      caption: 'Give projects some structure.',
      pointer,
      setup: () => selection.getByRole('button', { name: 'Clear selection' }).click(),
    });
    const planningTask = page.locator('task[data-task-id="t-quarterly-plan"]');
    const handle = planningTask.locator('done-toggle').first();
    const target = section.locator('task-list').first();
    await handle.scrollIntoViewIfNeeded();
    await hold(1200);
    // The app's drag preview can cover the lower caption. Let the action use
    // the full frame after viewers have read the scene title.
    await caption?.hide();
    caption = undefined;
    await pointer.drag(handle, target);
    await expect(section.locator('task[data-task-id="t-quarterly-plan"]')).toBeVisible();
    await pointer.park();
    await hold(2000);

    caption = await nextScene(page, {
      caption: 'Markdown. Live as you write.',
      pointer,
      setup: async () => {
        await planningTask.hover();
        await planningTask.locator('.show-additional-info-btn').first().click();
      },
    });
    const notes = page.locator('task-detail-panel inline-markdown').first();
    const editor = notes.locator('.cm-content');
    // Push in on the note so the live Markdown styling reads at a glance; the
    // camera frames it above the caption bar.
    await camera.zoomTo(notes, { scale: 1.6 });
    await pointer.glideTo(editor);
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await typeText(page, '# Launch plan\n- [ ] Publish the update', { delayMs: 80 });
    await page.keyboard.press('Escape');
    await editor.blur();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName.toLowerCase()))
      .toBe('task-detail-item');
    await expect(notes.locator('.cm-md-h1')).toBeVisible();
    const checkbox = notes.locator('.cm-md-task-checkbox');
    await expect(checkbox).toHaveText('check_box_outline_blank');
    await hold(600);
    await pointer.glideTo(checkbox, { durationMs: 500 });
    await checkbox.click();
    await expect(checkbox).toHaveText('check_box');
    await pointer.park();
    await hold(900);
    await camera.reset();
    await hold(200);

    caption = await nextScene(page, {
      caption: 'Navigate Boards with arrow keys.',
      setup: async () => {
        await page.goto('/#/boards');
        await expect(page.locator('boards')).toBeVisible();
      },
    });
    const urgent = page.locator(
      'board-panel[data-board-selection-scope="URGENT_AND_IMPORTANT"] planner-task[data-task-id="t-pr-review"]',
    );
    const important = page.locator(
      'board-panel[data-board-selection-scope="NOT_URGENT_AND_IMPORTANT"] planner-task[data-task-id="t-quarterly-plan"]',
    );
    await urgent.focus();
    await expect(urgent).toBeFocused();
    // Frame both quadrants so the focus ring visibly jumps between them.
    await camera.zoomTo([urgent, important], { scale: 1.05, durationMs: 700 });
    await expect(urgent).toBeInViewport({ ratio: 0.999 });
    await expect(important).toBeInViewport({ ratio: 0.999 });
    for (const step of [
      { key: 'ArrowRight', label: '→', target: important },
      { key: 'ArrowLeft', label: '←', target: urgent },
      { key: 'ArrowRight', label: '→', target: important },
    ]) {
      const key = await showKeyChip(page, step.label, {
        noWait: true,
        position: 'above-caption',
      });
      await page.keyboard.press(step.key);
      await expect(step.target).toBeFocused();
      await hold(850);
      await key.hide();
    }

    caption = await nextScene(page, {
      caption: 'Focus Mode, reworked.',
      camera,
      // Set up the running Focus screen behind the cut, as in the default reel.
      setup: async () => {
        await dispatch(
          page,
          { type: '[Task] SetCurrentTask', id: 't-quarterly-plan' },
          { type: '[FocusMode] Show Overlay' },
          { type: '[FocusMode] Start Session', duration: 1500000 },
        );
        await expect(page.locator('focus-mode-main')).toBeVisible();
        await expect(page.locator('focus-mode-main .bottom-controls')).toBeVisible();
      },
    });
    await hold(3500);

    // Crossfade real theme screenshots; the caption bar stays put and only swaps its text.
    const [firstTheme, ...otherThemes] = themeFrames;
    let themeCaption: CaptionHandle | undefined;
    let stills: StillHandle | undefined;
    await cutToScene(
      page,
      async () => {
        await settleScene(page);
        stills = await showStill(page, firstTheme.src, { fadeMs: THEME_FADE_MS });
        themeCaption = await showCaption(page, `Make it yours. ${firstTheme.name}.`, {
          noWait: true,
        });
      },
      { label: `Make it yours. ${firstTheme.name}.` },
    );
    await hold(1300);
    for (const theme of otherThemes) {
      markScene(page, `Make it yours. ${theme.name}.`);
      await Promise.all([
        stills!.crossfadeTo(theme.src),
        themeCaption!.update(`Make it yours. ${theme.name}.`),
      ]);
      await hold(1000);
    }
    markScene(page, 'Less busywork. More deep work.');
    await showEndCard(page, {
      title: 'Less busywork. More deep work.',
      subtitle: 'Try Super Productivity 19.1',
      stats: ['superproductivity.com'],
      logo: { src: '/assets/icons/sp.svg', monochrome: true },
    });
    void themeCaption!.hide();
    await hold(3000);
    await loopBoundary(page, 'out', 350);
  });
});
