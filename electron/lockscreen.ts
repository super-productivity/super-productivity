import { exec } from 'child_process';

// NOTE: keep as a template literal so prettier cannot strip backslash escapes
// and re-break the osascript argument (see issue #7217). CGSession was removed
// in macOS Big Sur, so modern macOS relies on the Ctrl+Cmd+Q fallback.
const DARWIN_LOCK_CMD =
  `(/System/Library/CoreServices/"Menu Extras"/User.menu/Contents/Resources/CGSession -suspend)` +
  ` || (osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}')`;

export const lockscreen = (cb?: (err: unknown, stdout: string) => void): void => {
  const lockCommands = {
    darwin: DARWIN_LOCK_CMD,
    win32: 'rundll32.exe user32.dll, LockWorkStation',
    linux:
      '(hash gnome-screensaver-command 2>/dev/null && gnome-screensaver-command -l) || (hash dm-tool 2>/dev/null && dm-tool lock) || (qdbus org.freedesktop.ScreenSaver /ScreenSaver Lock)',
  };

  const lockCommandToUse = lockCommands[
    process.platform as 'darwin' | 'win32' | 'linux'
  ] as any;
  if (!lockCommandToUse) {
    throw new Error(`lockscreen doesn't support your platform (${process.platform})`);
  } else {
    exec(lockCommandToUse, (err, stdout) => (cb ? cb(err, stdout) : null));
  }
};
