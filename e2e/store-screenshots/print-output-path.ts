import * as fs from 'fs';
import * as path from 'path';
import { MASTER_DIR_ELECTRON, MASTER_DIR_WEB } from './matrix';

const printOutputPath = (): void => {
  const dir =
    process.env.SCREENSHOT_MODE === 'electron' ? MASTER_DIR_ELECTRON : MASTER_DIR_WEB;
  const exists = fs.existsSync(dir);
  console.log(
    `\nMaster captures: ${dir}${exists ? '' : ' (not created — no scenarios ran)'}`,
  );

  // Re-surface the OS-capture-failed warning at end-of-run. The first-time
  // banner from the fixture scrolls off during long runs, so a final summary
  // ensures the user notices that Linux captures lack native GTK chrome.
  const marker = path.join(dir, '.os-capture-failed');
  if (fs.existsSync(marker)) {
    const hint =
      process.platform === 'linux'
        ? '  ↳ Linux: install `grim` (Wayland) or ImageMagick `import` (X11).\n'
        : '';
    console.warn(
      '\n' +
        '════════════════════════════════════════════════════════════════════\n' +
        '⚠  THIS RUN USED THE RENDERER FALLBACK — NO NATIVE GTK CHROME\n' +
        '════════════════════════════════════════════════════════════════════\n' +
        '  At least one capture fell back to page.screenshot() because the\n' +
        '  OS-level capture tool failed. The resulting PNGs do NOT contain\n' +
        '  the GTK titlebar — the Flathub deliverables from this run are NOT\n' +
        '  submission-ready.\n' +
        hint +
        '════════════════════════════════════════════════════════════════════\n',
    );
    try {
      fs.unlinkSync(marker);
    } catch {
      /* clean-up only */
    }
  }
};

export default printOutputPath;
