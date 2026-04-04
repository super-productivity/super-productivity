import { spawn } from 'child_process';
import { app } from 'electron';
import { parseDesktopCommandFromArgv } from './desktop-command-parser';
import { PROTOCOL_PREFIX } from './protocol-handler';
import { startApp } from './start-app';

const BACKGROUND_CLI_ENV_FLAG = 'SP_BACKGROUND_CLI_LAUNCH';
const parsedDesktopCommand = parseDesktopCommandFromArgv(process.argv);
const hasProtocolUrl = process.argv.some((arg) => arg.startsWith(PROTOCOL_PREFIX));
const shouldLaunchDetachedInBackground =
  !process.env[BACKGROUND_CLI_ENV_FLAG] &&
  (parsedDesktopCommand.kind === 'command' || hasProtocolUrl);

if (shouldLaunchDetachedInBackground) {
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      [BACKGROUND_CLI_ENV_FLAG]: '1',
    },
  });
  child.unref();
  process.exit(0);
}

// Enforce single-instance behavior on all desktop platforms.
// macOS Finder launches are already single-instance, but CLI invocations still need this.
const isLockObtained = app.requestSingleInstanceLock();
if (!isLockObtained) {
  if (parsedDesktopCommand.kind === 'error') {
    console.error(parsedDesktopCommand.error);
    process.exit(1);
  }
  process.exit(0);
} else {
  if (parsedDesktopCommand.kind === 'error' && !hasProtocolUrl) {
    console.error(parsedDesktopCommand.error);
    process.exit(1);
  }
  startApp();
}
