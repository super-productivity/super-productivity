import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { T } from '../../../../t.const';
import { IssueProviderGitlab } from '../../issue.model';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { GitlabAutoImportConfirmService } from './gitlab-auto-import-confirm.service';
import { GITLAB_MAX_AUTO_IMPORT_ISSUES } from './gitlab.const';

describe('GitlabAutoImportConfirmService', () => {
  let service: GitlabAutoImportConfirmService;
  let gitlabApiService: jasmine.SpyObj<GitlabApiService>;
  let matDialog: jasmine.SpyObj<MatDialog>;

  const provider = (changes: Partial<IssueProviderGitlab> = {}): IssueProviderGitlab =>
    ({
      id: 'gitlab-provider',
      issueProviderKey: 'GITLAB',
      isEnabled: true,
      isAutoAddToBacklog: true,
      issueSource: 'all',
      scope: 'all',
      ...changes,
    }) as IssueProviderGitlab;

  const notAborted = (): boolean => false;

  const answerConfirm = (isConfirmed: boolean): void => {
    matDialog.open.and.returnValue({
      afterClosed: () => of(isConfirmed),
    } as ReturnType<MatDialog['open']>);
  };

  const confirmData = (): {
    message: string;
    translateParams: unknown;
    isConfirmDisabled: boolean;
  } =>
    matDialog.open.calls.mostRecent().args[1]!.data as {
      message: string;
      translateParams: unknown;
      isConfirmDisabled: boolean;
    };

  beforeEach(() => {
    gitlabApiService = jasmine.createSpyObj('GitlabApiService', [
      'getAutoImportIssueCount$',
    ]);
    gitlabApiService.getAutoImportIssueCount$.and.returnValue(of(12));
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    answerConfirm(true);

    TestBed.configureTestingModule({
      providers: [
        GitlabAutoImportConfirmService,
        { provide: GitlabApiService, useValue: gitlabApiService },
        { provide: MatDialog, useValue: matDialog },
      ],
    });
    service = TestBed.inject(GitlabAutoImportConfirmService);
  });

  it('informs about the count and allows saving within the limit', async () => {
    expect(await service.confirmSave(provider(), undefined, notAborted)).toBe(true);

    const data = confirmData();
    expect(data.message).toBe(T.F.GITLAB.AUTO_IMPORT.CONFIRM);
    expect(data.translateParams).toEqual({
      nr: 12,
      max: GITLAB_MAX_AUTO_IMPORT_ISSUES,
    });
    expect(data.isConfirmDisabled).toBe(false);
  });

  it('refuses when the user goes back', async () => {
    answerConfirm(false);

    expect(await service.confirmSave(provider(), undefined, notAborted)).toBe(false);
  });

  it('blocks saving when more issues than the limit match', async () => {
    gitlabApiService.getAutoImportIssueCount$.and.returnValue(of(2500));

    // Even if the dialog somehow closes with true, saving is refused
    expect(await service.confirmSave(provider(), undefined, notAborted)).toBe(false);

    const data = confirmData();
    expect(data.message).toBe(T.F.GITLAB.AUTO_IMPORT.OVER_LIMIT);
    expect(data.translateParams).toEqual({
      nr: 2500,
      max: GITLAB_MAX_AUTO_IMPORT_ISSUES,
    });
    expect(data.isConfirmDisabled).toBe(true);
  });

  it('blocks saving when GitLab cannot tell the total', async () => {
    gitlabApiService.getAutoImportIssueCount$.and.returnValue(of(null));

    expect(await service.confirmSave(provider(), undefined, notAborted)).toBe(false);

    const data = confirmData();
    expect(data.message).toBe(T.F.GITLAB.AUTO_IMPORT.OVER_LIMIT);
    expect(data.translateParams).toEqual({
      nr: '10,000+',
      max: GITLAB_MAX_AUTO_IMPORT_ISSUES,
    });
  });

  it('does not ask when auto-import is off', async () => {
    expect(
      await service.confirmSave(
        provider({ isAutoAddToBacklog: false }),
        undefined,
        notAborted,
      ),
    ).toBe(true);

    expect(gitlabApiService.getAutoImportIssueCount$).not.toHaveBeenCalled();
  });

  it('does not ask when an edit leaves the import setup unchanged', async () => {
    expect(
      await service.confirmSave(
        provider({ defaultTagIds: ['tag'] } as Partial<IssueProviderGitlab>),
        provider(),
        notAborted,
      ),
    ).toBe(true);

    expect(gitlabApiService.getAutoImportIssueCount$).not.toHaveBeenCalled();
  });

  it('asks when an edit changes an import-relevant field', async () => {
    await service.confirmSave(
      provider({ scope: 'assigned-to-me' }),
      provider(),
      notAborted,
    );

    expect(gitlabApiService.getAutoImportIssueCount$).toHaveBeenCalled();
    expect(matDialog.open).toHaveBeenCalled();
  });

  it('asks when auto-import is newly switched on', async () => {
    await service.confirmSave(
      provider(),
      provider({ isAutoAddToBacklog: false }),
      notAborted,
    );

    expect(matDialog.open).toHaveBeenCalled();
  });

  it('allows saving without asking when the count fails', async () => {
    gitlabApiService.getAutoImportIssueCount$.and.returnValue(
      throwError(() => new Error('offline')),
    );

    expect(await service.confirmSave(provider(), undefined, notAborted)).toBe(true);

    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('refuses without asking when the caller went away during the count', async () => {
    expect(await service.confirmSave(provider(), undefined, () => true)).toBe(false);

    expect(matDialog.open).not.toHaveBeenCalled();
  });
});
