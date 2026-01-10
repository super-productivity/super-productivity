import { getIsAppReady, getWin } from './main-window';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { error, log } from 'electron-log/main';

const WAIT_FOR_WIN_TIMEOUT_DURATION = 4000;

export const errorHandlerWithFrontendInform = (
  e: Error | unknown | string = 'UNDEFINED ERROR',
  additionalLogInfo?: unknown,
): void => {
  const errObj = new Error(e as string);

  if (_isReadyForFrontEndError()) {
    _handleError(e, additionalLogInfo, errObj);
  } else {
    // try again a little later, when window might be ready
    setTimeout(() => {
      _handleError(e, additionalLogInfo, errObj);
    }, WAIT_FOR_WIN_TIMEOUT_DURATION);
  }
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function _isReadyForFrontEndError(): boolean {
  const mainWin = getWin();
  const isAppReady = getIsAppReady();
  return mainWin && mainWin.webContents && isAppReady;
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function _handleError(
  e: Error | unknown | string,
  additionalLogInfo: unknown,
  errObj: Error,
): void {
  const mainWin = getWin();
  const stack = errObj.stack;

  console.error('ERR', e);
  log(stack);
  error(e, stack);

  if (additionalLogInfo) {
    log('Additional Error info: ', additionalLogInfo);
  }

  if (_isReadyForFrontEndError()) {
    mainWin.webContents.send(IPC.ERROR, {
      error: e,
      errorStr: _getErrorStr(e),
      stack,
    });
  } else {
    error('Electron Error: Frontend not loaded. Could not send error to renderer.');
    throw errObj;
  }
}

const OBJECT_OBJECT_STR = '[object Object]';

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function _getErrorStr(e: unknown): string {
  if (typeof e === 'string') {
    return e;
  }

  if (e == null) {
    return 'Unknown error';
  }

  // Check for message property first (standard Error and custom errors)
  if (typeof (e as any).message === 'string' && (e as any).message) {
    return (e as any).message;
  }

  if (e instanceof Error) {
    return e.toString();
  }

  // Check for name property
  if (typeof (e as any).name === 'string' && (e as any).name) {
    return (e as any).name;
  }

  if (typeof e === 'object') {
    try {
      const jsonStr = JSON.stringify(e);
      if (jsonStr && jsonStr !== '{}') {
        return jsonStr;
      }
    } catch {
      // Circular reference - fall through
    }

    // Try toString but check for [object Object]
    const str = String(e);
    if (str && str !== OBJECT_OBJECT_STR) {
      return str;
    }
  }

  return 'Unknown error (unable to extract message)';
}
