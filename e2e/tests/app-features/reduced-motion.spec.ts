import { expect, test } from '../../fixtures/test.fixture';

// Peak number of script-driven (Angular) animations while navigating to `hash`.
// CSS transitions are excluded: the OS setting only turns off Angular motion.
const sampleRouteAnimations = (hash: string): Promise<number> =>
  new Promise((resolve) => {
    let peak = 0;
    const start = performance.now();
    const tick = (): void => {
      const count = document
        .getAnimations()
        .filter(
          (a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation),
        ).length;
      peak = Math.max(peak, count);
      if (performance.now() - start < 600) {
        requestAnimationFrame(tick);
      } else {
        resolve(peak);
      }
    };
    location.hash = hash;
    requestAnimationFrame(tick);
  });

test.describe('OS reduced motion', () => {
  // Control: proves the sampler sees route animations, so the zero below means something.
  test('route change animates by default', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    expect(await page.evaluate(sampleRouteAnimations, '#/planner')).toBeGreaterThan(0);
  });

  test('route change runs no Angular animation when the OS asks for reduced motion', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    // Switched after boot: the app must follow a live change of the setting.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(sampleRouteAnimations, '#/planner')).toBe(0);
  });
});
