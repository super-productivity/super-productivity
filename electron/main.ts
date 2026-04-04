import { app } from 'electron';
import { PROTOCOL_PREFIX } from './protocol-handler';
import { startApp } from './start-app';

// Enforce single-instance behavior on all desktop platforms.
// macOS Finder launches are already single-instance, but CLI invocations still need this.
const isLockObtained = app.requestSingleInstanceLock();
if (!isLockObtained) {
  const hasProtocolUrl = process.argv.some((arg) => arg.startsWith(PROTOCOL_PREFIX));
  if (!hasProtocolUrl) {
    console.log('Another instance is already running. Exiting.');
  }
  process.exit(0);
} else {
  console.log('Start app...');
  startApp();
}
