export const isGnomeDesktopEnv = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean =>
  platform === 'linux' &&
  [
    env.XDG_CURRENT_DESKTOP,
    env.XDG_SESSION_DESKTOP,
    env.DESKTOP_SESSION,
    env.GNOME_SHELL_SESSION_MODE,
  ]
    .filter((v): v is string => !!v)
    .map((v) => v.toLowerCase())
    .some((v) => v.includes('gnome') || v.includes('ubuntu'));

// Some sessions only set WAYLAND_DISPLAY and leave XDG_SESSION_TYPE unset, so
// check both.
export const isWaylandEnv = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean =>
  platform === 'linux' && (env.XDG_SESSION_TYPE === 'wayland' || !!env.WAYLAND_DISPLAY);

// Only GNOME on Wayland reliably fails to render the Window-Controls-Overlay
// when titleBarStyle is 'hidden', stranding the window with no min/max/close
// controls. The custom-title-bar kill-switch is narrowed to this combination
// so GNOME-on-X11 (where the feature works) keeps it.
export const isGnomeWaylandEnv = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean => isGnomeDesktopEnv(platform, env) && isWaylandEnv(platform, env);

export const IS_MAC = process.platform === 'darwin';
export const IS_GNOME_DESKTOP = isGnomeDesktopEnv(process.platform, process.env);
export const IS_GNOME_WAYLAND = isGnomeWaylandEnv(process.platform, process.env);
