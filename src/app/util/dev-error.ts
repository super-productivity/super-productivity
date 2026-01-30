import { environment } from '../../environments/environment';
import { Log } from '../core/log';
import { alertDialog, confirmDialog } from './native-dialogs';

let isShowAlert = true;

export const devError = (errStr: string | Error | unknown): void => {
  if (environment.production) {
    Log.err(errStr);
    // TODO add super simple snack message if possible
  } else {
    if (isShowAlert) {
      alertDialog('devERR: ' + errStr);
      isShowAlert = false;
    }
    if (confirmDialog(`Throw an error for error? ––– ${errStr}`)) {
      throw new Error(errStr as string);
    }
  }
};
