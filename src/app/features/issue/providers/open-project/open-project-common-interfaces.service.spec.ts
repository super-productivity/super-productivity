import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { IssueLog } from '../../../../core/log';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { OpenProjectCommonInterfacesService } from './open-project-common-interfaces.service';
import { OpenProjectApiService } from './open-project-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { DEFAULT_OPEN_PROJECT_CFG } from './open-project.const';
import { OpenProjectWorkPackage } from './open-project-issue.model';
import { createTask } from '../../../tasks/task.test-helper';
import { IssueProviderOpenProject } from '../../issue.model';

const ISSUE_PROVIDER_ID = 'open-project-provider-1';
const BASE_UPDATED_AT = '2026-01-08T03:29:14.653Z';
const NEWER_UPDATED_AT = '2026-01-08T03:30:00.000Z';

const BASE_CFG: IssueProviderOpenProject = {
  ...DEFAULT_OPEN_PROJECT_CFG,
  id: ISSUE_PROVIDER_ID,
  issueProviderKey: 'OPEN_PROJECT',
  isEnabled: true,
  host: 'https://openproject.example.com',
  projectId: 'project',
  token: 'token',
};

const makeWorkPackage = (
  id: number,
  updatedAt: string,
  subject = 'OpenProject work package',
): OpenProjectWorkPackage =>
  ({
    id,
    subject,
    updatedAt,
    createdAt: '2026-01-08T03:00:00.000Z',
    startDate: null,
    estimatedTime: null,
    storyPoints: null,
    url: `https://openproject.example.com/projects/project/work_packages/${id}`,
  }) as unknown as OpenProjectWorkPackage;

describe('OpenProjectCommonInterfacesService', () => {
  let service: OpenProjectCommonInterfacesService;
  let openProjectApiService: jasmine.SpyObj<OpenProjectApiService>;
  let issueProviderService: jasmine.SpyObj<IssueProviderService>;

  beforeEach(() => {
    openProjectApiService = jasmine.createSpyObj('OpenProjectApiService', ['getById$']);
    issueProviderService = jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']);
    issueProviderService.getCfgOnce$.and.returnValue(of(BASE_CFG));

    TestBed.configureTestingModule({
      providers: [
        OpenProjectCommonInterfacesService,
        { provide: OpenProjectApiService, useValue: openProjectApiService },
        { provide: IssueProviderService, useValue: issueProviderService },
      ],
    });
    service = TestBed.inject(OpenProjectCommonInterfacesService);
  });

  it('isolates rejected and unchanged tasks, preserves update pairing and logs safe diagnostics', async () => {
    const errorLog = spyOn(IssueLog, 'err');
    const warningLog = spyOn(IssueLog, 'warn');
    const ids = { http: 1, unexpected: 2, unchanged: 3, changed1: 4, changed2: 5 };
    const tasks = Object.entries(ids).map(([id, issueId]) =>
      createTask({
        id,
        title: `#${issueId} OpenProject work package`,
        issueId: String(issueId),
        issueProviderId: ISSUE_PROVIDER_ID,
        issueType: 'OPEN_PROJECT',
        issueLastUpdated: new Date(BASE_UPDATED_AT).getTime(),
        issueWasUpdated: false,
      }),
    );
    const changedWorkPackages = [ids.changed1, ids.changed2].map((id, i) =>
      makeWorkPackage(id, NEWER_UPDATED_AT, `Changed ${i + 1}`),
    );
    openProjectApiService.getById$.and.callFake((id) => {
      if (id === ids.http) {
        return throwError(() => ({ [HANDLED_ERROR_PROP_STR]: 'private HTTP error' }));
      }
      if (id === ids.unexpected) {
        return throwError(() => new TypeError('private response detail'));
      }
      return of(
        changedWorkPackages.find((workPackage) => workPackage.id === id) ??
          makeWorkPackage(id, BASE_UPDATED_AT),
      );
    });

    const result = await service.getFreshDataForIssueTasks(tasks);

    expect(openProjectApiService.getById$).toHaveBeenCalledTimes(tasks.length);
    expect(result.map(({ task, issue }) => ({ task, issue }))).toEqual([
      { task: tasks[3], issue: changedWorkPackages[0] },
      { task: tasks[4], issue: changedWorkPackages[1] },
    ]);
    expect(result.map(({ taskChanges }) => taskChanges.title)).toEqual([
      '#4 Changed 1',
      '#5 Changed 2',
    ]);
    expect(result.every(({ taskChanges }) => taskChanges.issueWasUpdated)).toBeTrue();
    expect(warningLog.calls.allArgs()).toEqual([
      [
        'Issue refresh failed in getFreshDataForIssueTask',
        { taskId: 'http', providerKey: 'OPEN_PROJECT', errorType: 'HandledError' },
      ],
    ]);
    expect(errorLog.calls.allArgs()).toEqual([
      [
        'Issue refresh failed in getFreshDataForIssueTask',
        { taskId: 'unexpected', providerKey: 'OPEN_PROJECT', errorType: 'TypeError' },
      ],
    ]);
  });
});
