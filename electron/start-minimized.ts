// `--start-minimized` starts the app without showing the main window, e.g. when
// it is launched at login (#1865, #3757).
//
// The window only stays hidden when the user can get it back: through the tray,
// or on macOS through the Dock icon, which remains after hide(). Without a tray
// (`--disable-tray`) a hidden window would be unreachable (#7282), so it is
// minimized instead and keeps its taskbar entry.
export const START_MINIMIZED_ARG = '--start-minimized';

export type StartMinimizedMode = 'hide' | 'minimize';

export const getStartMinimizedMode = ({
  hasTray,
  isMac,
}: {
  hasTray: boolean;
  isMac: boolean;
}): StartMinimizedMode => (hasTray || isMac ? 'hide' : 'minimize');
