import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom } from 'rxjs';
import { PlainspaceClaimPoolService } from './plainspace-claim-pool.service';
import { PlainspaceAccountService } from './plainspace-account.service';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { IssueService } from '../issue/issue.service';
import { IssueProviderPlainspace } from '../issue/issue.model';
import { resetPlainspaceMockData } from '../issue/providers/plainspace/plainspace-mock-data.const';

const PLAINSPACE_PROVIDER = {
  id: 'p1',
  issueProviderKey: 'PLAINSPACE',
  isEnabled: true,
  defaultProjectId: 'proj-1',
  host: 'https://plainspace.org',
  spaceId: 'space-1',
} as IssueProviderPlainspace;

describe('PlainspaceClaimPoolService', () => {
  let service: PlainspaceClaimPoolService;
  let store: MockStore;
  let accountService: PlainspaceAccountService;
  let addTaskFromIssueSpy: jasmine.Spy;

  beforeEach(() => {
    resetPlainspaceMockData();
    addTaskFromIssueSpy = jasmine.createSpy('addTaskFromIssue').and.resolveTo('t1');
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PlainspaceClaimPoolService,
        PlainspaceAccountService,
        provideMockStore(),
        { provide: IssueService, useValue: { addTaskFromIssue: addTaskFromIssueSpy } },
      ],
    });
    service = TestBed.inject(PlainspaceClaimPoolService);
    store = TestBed.inject(MockStore);
    accountService = TestBed.inject(PlainspaceAccountService);
    accountService.login('Tester');
    store.overrideSelector(selectEnabledIssueProviders, [PLAINSPACE_PROVIDER]);
    store.refreshState();
  });

  afterEach(() => {
    accountService.logout();
    resetPlainspaceMockData();
  });

  it('returns the unclaimed tasks for a shared project', async () => {
    const unclaimed = await firstValueFrom(service.unclaimedTasksForProject$('proj-1'));
    expect(unclaimed.map((t) => t.id).sort()).toEqual(['ps-102', 'ps-105', 'ps-106']);
  });

  it('returns empty when the project has no bound Plainspace provider', async () => {
    const none = await firstValueFrom(service.unclaimedTasksForProject$('other-proj'));
    expect(none).toEqual([]);
  });

  it('claim imports the task as an SP task and removes it from the pool', async () => {
    await service.claim('proj-1', 'ps-102');

    expect(addTaskFromIssueSpy).toHaveBeenCalledTimes(1);
    const arg = addTaskFromIssueSpy.calls.mostRecent().args[0];
    expect(arg.issueProviderKey).toBe('PLAINSPACE');
    expect(arg.issueDataReduced.id).toBe('ps-102');

    const unclaimed = await firstValueFrom(service.unclaimedTasksForProject$('proj-1'));
    expect(unclaimed.map((t) => t.id)).not.toContain('ps-102');
  });
});
