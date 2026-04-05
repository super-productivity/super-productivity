export const IS_MAC = process.platform === 'darwin';
export const IS_GNOME_DESKTOP =
  process.platform === 'linux' &&
  process.env.XDG_CURRENT_DESKTOP?.toLowerCase()!.includes('gnome') &&
  process.env.XDG_CURRENT_DESKTOP?.toLowerCase()!.includes('ubuntu');
