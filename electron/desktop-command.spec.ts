import {
  executeDesktopCommand,
  flushPendingDesktopCommands,
  getPendingDesktopCommandCount,
  queueOrExecuteDesktopCommand,
  resetPendingDesktopCommands,
  type DesktopCommandWindow,
} from './desktop-command-executor';
import {
  getProtocolUrlFromArgv,
  parseDesktopCommandFromArgv,
  parseDesktopCommandFromProtocolUrl,
} from './desktop-command-parser';
import { IPC } from './shared-with-frontend/ipc-events.const';

describe('desktop command parser', () => {
  it('should parse toggle visibility argv flag', () => {
    expect(parseDesktopCommandFromArgv(['app', '--toggle-visibility'])).toEqual({
      kind: 'command',
      command: { type: 'toggle-visibility' },
    });
  });

  it('should ignore existing non-command flags', () => {
    expect(parseDesktopCommandFromArgv(['app', '--disable-tray', '--new-task'])).toEqual({
      kind: 'command',
      command: { type: 'new-task' },
    });
  });

  it('should reject multiple command flags', () => {
    expect(parseDesktopCommandFromArgv(['app', '--new-note', '--new-task'])).toEqual({
      kind: 'error',
      error: 'Multiple desktop command flags are not supported: --new-note, --new-task',
    });
  });

  it('should reject unknown desktop command-like flags', () => {
    expect(parseDesktopCommandFromArgv(['app', '--toggle-'])).toEqual({
      kind: 'error',
      error: 'Unknown desktop command flag: --toggle-',
    });
  });

  it('should parse existing create-task protocol URLs', () => {
    expect(
      parseDesktopCommandFromProtocolUrl('superproductivity://create-task/Foo%20Bar'),
    ).toEqual({
      kind: 'command',
      command: { type: 'create-task', title: 'Foo Bar' },
    });
  });

  it('should parse existing toggle tracking protocol URLs', () => {
    expect(
      parseDesktopCommandFromProtocolUrl('superproductivity://task-toggle-start'),
    ).toEqual({
      kind: 'command',
      command: { type: 'toggle-time-tracking' },
    });
  });

  it('should return matching protocol URL from argv', () => {
    expect(
      getProtocolUrlFromArgv([
        'app',
        '--dev-tools',
        'superproductivity://task-toggle-start',
      ]),
    ).toBe('superproductivity://task-toggle-start');
  });
});

describe('desktop command executor', () => {
  let mainWin: DesktopCommandWindow;
  let showOrFocusSpy: jasmine.Spy;
  let sendSpy: jasmine.Spy;
  let hideSpy: jasmine.Spy;
  let blurSpy: jasmine.Spy;
  let isFocusedSpy: jasmine.Spy;

  beforeEach(() => {
    sendSpy = jasmine.createSpy('send');
    hideSpy = jasmine.createSpy('hide');
    blurSpy = jasmine.createSpy('blur');
    isFocusedSpy = jasmine.createSpy('isFocused').and.returnValue(false);
    showOrFocusSpy = jasmine.createSpy('showOrFocus');
    mainWin = {
      blur: blurSpy,
      hide: hideSpy,
      isFocused: isFocusedSpy,
      webContents: {
        send: sendSpy,
      },
    };
    resetPendingDesktopCommands();
  });

  afterEach(() => {
    resetPendingDesktopCommands();
  });

  it('should hide focused window for toggle visibility', () => {
    isFocusedSpy.and.returnValue(true);

    executeDesktopCommand({ type: 'toggle-visibility' }, mainWin, {
      showOrFocus: showOrFocusSpy,
    });

    expect(blurSpy).toHaveBeenCalled();
    expect(hideSpy).toHaveBeenCalled();
    expect(showOrFocusSpy).not.toHaveBeenCalled();
  });

  it('should show or focus hidden window for toggle visibility', () => {
    executeDesktopCommand({ type: 'toggle-visibility' }, mainWin, {
      showOrFocus: showOrFocusSpy,
    });

    expect(showOrFocusSpy).toHaveBeenCalledWith(mainWin);
    expect(hideSpy).not.toHaveBeenCalled();
  });

  it('should send the expected ipc messages for commands', () => {
    executeDesktopCommand({ type: 'toggle-time-tracking' }, mainWin, {
      showOrFocus: showOrFocusSpy,
    });
    executeDesktopCommand({ type: 'new-note' }, mainWin, {
      showOrFocus: showOrFocusSpy,
    });
    executeDesktopCommand({ type: 'new-task' }, mainWin, {
      showOrFocus: showOrFocusSpy,
    });
    executeDesktopCommand({ type: 'create-task', title: 'Protocol Task' }, mainWin, {
      showOrFocus: showOrFocusSpy,
    });

    expect(sendSpy.calls.argsFor(0)).toEqual([IPC.TASK_TOGGLE_START]);
    expect(sendSpy.calls.argsFor(1)).toEqual([IPC.ADD_NOTE]);
    expect(sendSpy.calls.argsFor(2)).toEqual([IPC.SHOW_ADD_TASK_BAR]);
    expect(sendSpy.calls.argsFor(3)).toEqual([
      IPC.ADD_TASK_FROM_APP_URI,
      { title: 'Protocol Task' },
    ]);
    expect(showOrFocusSpy).toHaveBeenCalledTimes(3);
  });

  it('should queue until app readiness and flush pending commands', () => {
    queueOrExecuteDesktopCommand({
      command: { type: 'new-note' },
      getMainWindow: () => mainWin,
      isAppReady: () => false,
      showOrFocus: showOrFocusSpy,
    });

    expect(getPendingDesktopCommandCount()).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();

    flushPendingDesktopCommands({
      getMainWindow: () => mainWin,
      isAppReady: () => true,
      showOrFocus: showOrFocusSpy,
    });

    expect(getPendingDesktopCommandCount()).toBe(0);
    expect(sendSpy).toHaveBeenCalledWith(IPC.ADD_NOTE);
    expect(showOrFocusSpy).toHaveBeenCalledWith(mainWin);
  });
});
