import { app } from 'electron';
import { parseDesktopCommandFromArgv } from './desktop-command-parser';
import { PROTOCOL_PREFIX } from './protocol-handler';
import { startApp } from './start-app';

const parsedDesktopCommand = parseDesktopCommandFromArgv(process.argv);
const hasProtocolUrl = process.argv.some((arg) => arg.startsWith(PROTOCOL_PREFIX));

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
