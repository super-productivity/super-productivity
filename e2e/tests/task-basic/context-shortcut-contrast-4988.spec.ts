import { expect, test } from '../../fixtures/test.fixture';

for (const mode of ['dark', 'light'] as const) {
  for (const state of ['normal', 'hover', 'keyboard'] as const) {
    test(`enabled task-menu shortcut contrast (${mode}, ${state}) #4988`, async ({
      page,
      workViewPage,
      taskPage,
      testPrefix,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
      await expect(page.locator('body')).toHaveClass(
        mode === 'dark' ? /isDarkTheme/ : /^(?!.*isDarkTheme).*$/,
      );
      await workViewPage.waitForTaskList();
      const title = `${testPrefix} contrast task`;
      await workViewPage.addTask(title);
      await taskPage
        .getTaskByText(title)
        .locator('task-title')
        .click({ button: 'right' });
      const menu = page.locator('.mat-mdc-menu-panel').first();
      await expect(menu).toBeVisible();
      await expect(menu).not.toHaveClass(/mat-menu-panel-animating/);
      await expect(menu).toHaveCSS('opacity', '1');
      const action = menu.getByRole('menuitem', { name: /Toggle Tags/i });
      await expect(action).toBeEnabled();
      const hint = action.locator('.key-i');
      await expect(hint).toBeVisible();
      await expect(hint).not.toHaveText('');
      // Move away so this non-focused menu item has no hover state overlay.
      await page.mouse.move(0, 0);
      await expect(action).not.toBeFocused();
      if (state === 'hover') await action.hover();
      if (state === 'keyboard') {
        for (
          let i = 0;
          i < 30 && !(await action.evaluate((el) => el === document.activeElement));
          i++
        ) {
          await page.keyboard.press('ArrowDown');
        }
        await expect(action).toBeFocused();
        await expect(action).toHaveClass(/cdk-keyboard-focused/);
      }
      // Flush the interaction style, then await its CSS transitions.
      await action.evaluate(async (element) => {
        getComputedStyle(element).getPropertyValue('background-color');
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const measured = await hint.evaluate((element) => {
        type Rgba = [number, number, number, number];
        const parse = (value: string): Rgba => {
          const srgb = value.match(
            /^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+))?\)$/,
          );
          if (srgb)
            return [
              Number(srgb[1]) * 255,
              Number(srgb[2]) * 255,
              Number(srgb[3]) * 255,
              Number(srgb[4] ?? 1),
            ];
          const parts = value
            .match(/^rgba?\(([^)]+)\)$/)?.[1]
            .split(',')
            .map(Number);
          if (!parts || parts.length < 3) throw new Error(`Unsupported color: ${value}`);
          return [parts[0], parts[1], parts[2], parts[3] ?? 1];
        };
        const over = (front: Rgba, back: Rgba): Rgba => {
          const backAlpha = back[3] * (1 - front[3]);
          const alpha = front[3] + backAlpha;
          if (!alpha) return [0, 0, 0, 0];
          return [0, 1, 2]
            .map((i) => {
              const frontChannel = front[i] * front[3];
              const backChannel = back[i] * backAlpha;
              return (frontChannel + backChannel) / alpha;
            })
            .concat(alpha) as Rgba;
        };
        let foreground = parse(getComputedStyle(element).color);
        let background: Rgba = [0, 0, 0, 0];
        const layers = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.backgroundImage !== 'none' || style.filter !== 'none') {
            throw new Error(
              'Unsupported image/filter; inspect before asserting contrast',
            );
          }
          const color = parse(style.backgroundColor);
          const opacity = Number(style.opacity);
          layers.push({
            tag: node.tagName,
            classes: node.className,
            color: style.color,
            background: style.backgroundColor,
            opacity,
          });
          foreground = over(foreground, color);
          background = over(background, color);
          foreground[3] *= opacity;
          background[3] *= opacity;
        }
        foreground = over(foreground, [255, 255, 255, 1]);
        background = over(background, [255, 255, 255, 1]);
        const luminance = (rgb: Rgba): number =>
          rgb.slice(0, 3).reduce((sum, c, i) => {
            const s = c / 255;
            const linear = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            const weighted = linear * [0.2126, 0.7152, 0.0722][i];
            return sum + weighted;
          }, 0);
        const controlWhite: Rgba = [255, 255, 255, 1];
        const controlBlack: Rgba = [0, 0, 0, 1];
        const blackWhite =
          (luminance(controlWhite) + 0.05) / (luminance(controlBlack) + 0.05);
        const black40 = over([0, 0, 0, 0.4], controlWhite);
        const black40White = 1.05 / (luminance(black40) + 0.05);
        if (
          Math.abs(blackWhite - 21) > 0.000001 ||
          Math.abs(black40White - 2.849027755287037) > 0.000001
        ) {
          throw new Error('Contrast calculation control failed');
        }
        const controls = { blackWhite, black40White };
        const a = luminance(foreground);
        const b = luminance(background);
        const style = getComputedStyle(element);
        return {
          text: element.textContent,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          foreground,
          background,
          controls,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          layers,
        };
      });
      await testInfo.attach(`${mode}-measurement`, {
        body: JSON.stringify(measured, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach(`${mode}-menu`, {
        body: await menu.screenshot(),
        contentType: 'image/png',
      });
      console.log(`${mode}/${state} shortcut contrast ${JSON.stringify(measured)}`);
      expect(parseFloat(measured.fontSize)).toBeLessThan(18);
      // An enabled command's shortcut conveys usable information; it is neither
      // disabled nor decorative. Small text requires 4.5:1, without rounding.
      expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
}
