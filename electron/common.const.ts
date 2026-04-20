export const IS_MAC = process.platform === 'darwin';
export const IS_GNOME_DESKTOP =
  process.platform === 'linux' &&
  [
    process.env.XDG_CURRENT_DESKTOP,
    process.env.XDG_SESSION_DESKTOP,
    process.env.DESKTOP_SESSION,
    process.env.GNOME_SHELL_SESSION_MODE,
  ]
    .filter((v): v is string => !!v)
    .map((v) => v.toLowerCase())
    .some((v) => v.includes('gnome') || v.includes('ubuntu'));
