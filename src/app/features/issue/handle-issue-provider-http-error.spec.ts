import { HttpErrorResponse } from '@angular/common/http';
import { from } from 'rxjs';
import { handleIssueProviderHttpError$ } from './handle-issue-provider-http-error';
import { SnackService } from '../../core/snack/snack.service';
import { HANDLED_ERROR_PROP_STR } from '../../app.constants';
import { GITLAB_TYPE } from './issue.const';

describe('handleIssueProviderHttpError$', () => {
  it('keeps the request URL out of the handled error', () => {
    const snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const url =
      'https://gitlab.example.com/api/v4/projects/1/issues?private_token=secret';
    const error = new HttpErrorResponse({ url, status: 401, statusText: 'Unauthorized' });

    let handled: Record<string, string> = {};
    from(handleIssueProviderHttpError$(GITLAB_TYPE, snackService, error)).subscribe({
      error: (e) => (handled = e),
    });

    const txt = handled[HANDLED_ERROR_PROP_STR];
    expect(txt).toContain('401');
    expect(txt).not.toContain('gitlab.example.com');
  });
});
