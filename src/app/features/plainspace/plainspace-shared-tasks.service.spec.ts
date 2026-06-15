import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom } from 'rxjs';
import { PlainspaceSharedTasksService } from './plainspace-shared-tasks.service';
import { PlainspaceAccountService } from './plainspace-account.service';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { IssueProviderPlainspace } from '../issue/issue.model';

const PLAINSPACE_PROVIDER = {
  id: 'p1',
  issueProviderKey: 'PLAINSPACE',
  isEnabled: true,
  defaultProjectId: 'proj-1',
  host: 'https://plainspace.org',
  spaceId: 'space-1',
} as IssueProviderPlainspace;

describe('PlainspaceSharedTasksService', () => {
  let service: PlainspaceSharedTasksService;
  let store: MockStore;
  let accountService: PlainspaceAccountService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PlainspaceSharedTasksService,
        PlainspaceAccountService,
        provideMockStore(),
      ],
    });
    service = TestBed.inject(PlainspaceSharedTasksService);
    store = TestBed.inject(MockStore);
    accountService = TestBed.inject(PlainspaceAccountService);
    accountService.login('Tester'); // "me" === ps-me
  });

  afterEach(() => {
    accountService.logout();
  });

  it('returns only tasks assigned to others for a shared project', async () => {
    store.overrideSelector(selectEnabledIssueProviders, [PLAINSPACE_PROVIDER]);
    store.refreshState();

    const others = await firstValueFrom(service.othersTasksForProject$('proj-1'));

    // mock data: ps-103 (u-mara) + ps-104 (u-jon) are others; ps-101 (me) and
    // ps-102 (unassigned) are excluded.
    expect(others.map((t) => t.id).sort()).toEqual(['ps-103', 'ps-104']);
    expect(others.every((t) => !!t.assignee && t.assignee.id !== 'ps-me')).toBe(true);
  });

  it('returns empty when the project has no bound Plainspace provider', async () => {
    store.overrideSelector(selectEnabledIssueProviders, [PLAINSPACE_PROVIDER]);
    store.refreshState();

    const none = await firstValueFrom(service.othersTasksForProject$('other-proj'));
    expect(none).toEqual([]);
  });
});
