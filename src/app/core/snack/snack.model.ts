import { MatSnackBarConfig } from '@angular/material/snack-bar';
import { Observable } from 'rxjs';

export type SnackType = 'ERROR' | 'SUCCESS' | 'WARNING' | 'CUSTOM' | 'JIRA_UNBLOCK';

export interface SnackParams {
  msg: string;
  isSkipTranslate?: boolean;
  translateParams?: { [key: string]: string | number };
  type?: SnackType;
  ico?: string;
  svgIco?: string;
  actionStr?: string;
  actionId?: string;
  // eslint-disable-next-line
  actionFn?: Function;
  actionPayload?: unknown;
  config?: MatSnackBarConfig;
  isSpinner?: boolean;
  promise?: Promise<unknown>;
  showWhile$?: Observable<unknown>;
}
