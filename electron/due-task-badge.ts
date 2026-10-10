import { app, nativeImage } from 'electron';
import type { BrowserWindow, NativeImage } from 'electron';
import { getWin } from './main-window';

const windowBadges = new WeakMap<
  BrowserWindow,
  { icon: NativeImage | null; description: string }
>();

export const setDueTaskBadge = (count: number, iconDataUrl?: string): void => {
  if (process.platform === 'win32') {
    // The renderer rasterizes numbers with Canvas/Segoe UI and sends PNG.
    const icon = count && iconDataUrl ? nativeImage.createFromDataURL(iconDataUrl) : null;
    if (count && (!icon || icon.isEmpty())) return;
    if (icon && (icon.getSize().width !== 64 || icon.getSize().height !== 64)) return;
    const win = getWin();
    const description = count ? `${count} tasks due today or overdue` : '';
    const badge = windowBadges.get(win);
    if (badge) {
      badge.icon = icon;
      badge.description = description;
    } else {
      const latestBadge = { icon, description };
      windowBadges.set(win, latestBadge);
      const restoreBadge = (): void => {
        win.setOverlayIcon(latestBadge.icon, latestBadge.description);
      };
      // Startup IPC can arrive before the hidden window has a taskbar button.
      // Reapply on show and on the subsequent focus (including the existing
      // delayed Windows startup focus), without requiring a new renderer count.
      win.on('show', restoreBadge);
      win.on('focus', restoreBadge);
    }
    win.setOverlayIcon(icon, description);
  } else {
    // macOS Dock and Linux launchers that support Electron's badge API.
    app.setBadgeCount(count);
  }
};
