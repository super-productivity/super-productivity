import { HttpErrorResponse } from '@angular/common/http';
import { ObservableInput, throwError } from 'rxjs';
import { T } from '../../t.const';
import { ISSUE_PROVIDER_HUMANIZED } from './issue.const';
import { HANDLED_ERROR_PROP_STR } from '../../app.constants';
import { IssueProviderKey } from './issue.model';
import { getErrorTxt } from '../../util/get-error-text';
import { SnackService } from '../../core/snack/snack.service';
import { IssueLog } from '../../core/log';

export const handleIssueProviderHttpError$ = <T>(
  issueProviderKey: IssueProviderKey,
  snackService: SnackService,
  error: HttpErrorResponse,
): ObservableInput<T> => {
  IssueLog.log(error);
  if (error.error instanceof ErrorEvent) {
    // A client-side or network error occurred. Handle it accordingly.
    snackService.open({
      type: 'ERROR',
      msg: T.F.ISSUE.S.ERR_NETWORK,
      translateParams: {
        issueProviderName: ISSUE_PROVIDER_HUMANIZED[issueProviderKey],
      },
    });
  } else if (error.error && error.error.message) {
    snackService.open({
      type: 'ERROR',
      msg: ISSUE_PROVIDER_HUMANIZED[issueProviderKey] + ': ' + error.error.message,
    });
  } else if (error.status) {
    // The backend returned an unsuccessful response code.
    const errorMsg =
      (error.error && (error.error.name || error.error.statusText)) || error.toString();
    snackService.open({
      type: 'ERROR',
      translateParams: {
        issueProviderName: ISSUE_PROVIDER_HUMANIZED[issueProviderKey],
        errTxt: `Unknown error ${error.status} ${errorMsg}`,
      },
      msg: T.F.ISSUE.S.ERR_GENERIC,
    });
  }
  const ipLabel = ISSUE_PROVIDER_HUMANIZED[issueProviderKey];
  if (error && error.message) {
    return throwError({ [HANDLED_ERROR_PROP_STR]: `${ipLabel}: ` + error.message });
  }

  return throwError({ [HANDLED_ERROR_PROP_STR]: `${ipLabel}: ${getErrorTxt(error)}` });
};
