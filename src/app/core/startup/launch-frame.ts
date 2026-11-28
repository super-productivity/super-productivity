import { LS } from '../persistence/storage-keys.const';

/**
 * What the launch screen in `src/index.html` needs to paint the app's frame
 * before any JS has loaded: colors of the current theme (custom ones included)
 * and where the bars are. Saved per dark/light mode, so a "system" user whose
 * OS switched modes between launches still gets the right one.
 *
 * Read by the inline script in index.html: keep the shape in sync there.
 * Holds no user content, only colors and pixel sizes.
 */
export interface LaunchFrame {
  /** Page background (body). */
  bg: string;
  /** Text color, for the logo and tip. */
  fg: string;
  /** Theme backdrop (body::before), resolved; empty when the theme shows none. */
  backdrop: string;
  /** Bottom bar's distance from the viewport bottom to its top edge (incl. safe area). */
  bottomBar: number | null;
  isRtl: boolean;
}

export type LaunchFrames = Partial<Record<'dark' | 'light', LaunchFrame>>;

// A bar outside this range is hidden (e.g. behind the keyboard) or mid-layout.
const MIN_BOTTOM_BAR = 30;
const MAX_BOTTOM_BAR = 200;

export const readLaunchFrame = (doc: Document): LaunchFrame | null => {
  const win = doc.defaultView;
  const body = doc.body;
  // Only a rendered shell is a frame worth repeating (not e.g. focus mode).
  if (!win || !body || !doc.querySelector('.app-container')) {
    return null;
  }
  const bodyStyle = win.getComputedStyle(body);
  const before = win.getComputedStyle(body, '::before');
  const isBackdropShown =
    before.display !== 'none' && +before.opacity > 0 && before.backgroundImage !== 'none';

  const bottomNav = doc.querySelector('.mobile-bottom-nav');
  const isRtl = doc.documentElement.dir === 'rtl' || body.dir === 'rtl';
  const bottomBar = bottomNav
    ? Math.round(win.innerHeight - bottomNav.getBoundingClientRect().top)
    : null;

  return {
    bg: bodyStyle.backgroundColor,
    fg: bodyStyle.color,
    backdrop: isBackdropShown ? before.backgroundImage : '',
    bottomBar:
      bottomBar !== null && bottomBar >= MIN_BOTTOM_BAR && bottomBar <= MAX_BOTTOM_BAR
        ? bottomBar
        : null,
    isRtl,
  };
};

/** Stores the current frame for the next launch; never throws. */
export const saveLaunchFrame = (doc: Document, isDark: boolean): void => {
  try {
    const frame = readLaunchFrame(doc);
    if (!frame) {
      return;
    }
    let frames: LaunchFrames = {};
    try {
      frames = JSON.parse(localStorage.getItem(LS.LAUNCH_FRAME) || '{}') ?? {};
    } catch {
      // corrupt entry: start over
    }
    frames[isDark ? 'dark' : 'light'] = frame;
    localStorage.setItem(LS.LAUNCH_FRAME, JSON.stringify(frames));
  } catch {
    // storage full or unavailable: the launch screen falls back to defaults
  }
};
