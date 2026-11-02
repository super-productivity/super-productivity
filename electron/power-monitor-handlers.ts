import { BrowserWindow, PowerMonitor } from 'electron';
import { log } from 'electron-log/main';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { setIsLocked } from './shared-state';

/**
 * Wires suspend/lock and resume/unlock to the idle and sync IPC events.
 *
 * Never raise, focus or flash the window here: a routine wake must not request
 * attention. On Windows a raise from the background is denied and turns into a
 * taskbar flash after every resume (#9560), and when it succeeds it steals focus
 * from the app the user was in (#10726, #10700). The OS restores the previous
 * foreground window itself; the electron#20464 workaround targets the
 * post-reboot case and lives in showOrFocus()/ready-to-show.
 */
export const initPowerMonitorHandlers = (
  powerMonitor: Pick<PowerMonitor, 'on'>,
  mainWin: BrowserWindow,
  sendIdleMsgIfOverMin: (idleTime: number) => unknown,
): void => {
  let suspendStart: number;

  const onSleep = (reason: string): void => {
    log(`powerMonitor: ${reason} detected`);
    setIsLocked(true);
    suspendStart = Date.now();
    mainWin.webContents.send(IPC.SUSPEND);
  };

  const onWake = (reason: string): void => {
    const idleTime = Date.now() - suspendStart;
    log(`powerMonitor: ${reason} detected. Idle time: ${idleTime}ms`);
    setIsLocked(false);
    sendIdleMsgIfOverMin(idleTime);
    mainWin.webContents.send(IPC.RESUME);
  };

  powerMonitor.on('suspend', () => onSleep('System suspend'));
  powerMonitor.on('lock-screen', () => onSleep('Screen lock'));
  powerMonitor.on('resume', () => onWake('System resume'));
  powerMonitor.on('unlock-screen', () => onWake('Screen unlock'));
};
