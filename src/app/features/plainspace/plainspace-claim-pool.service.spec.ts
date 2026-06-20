import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of } from 'rxjs';
import { PlainspaceClaimPoolService } from './plainspace-claim-pool.service';
import { PlainspaceApiService } from '../issue/providers/plainspace/plainspace-api.service';
import { PlainspaceIssue } from '../issue/providers/plainspace/plainspace-issue.model';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { IssueService } from '../issue/issue.service';
import { IssueProviderPlainspace } from '../issue/issue.model';
import { SnackService } from '../../core/snack/snack.service';

const PLAINSPACE_PROVIDER = {
  id: 'p1',
  issueProviderKey: 'PLAINSPACE',
  isEnabled: true,
  defaultProjectId: 'proj-1',
  host: 'https://plainspace.org',
  spaceId: 'space-1',
  token: 'pat_x',
} as IssueProviderPlainspace;

const issue = (id: string): PlainspaceIssue => ({
  id,
  title: id,
  isDone: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  url: `https://plainspace.org/p/item/${id}`,
  projectId: 'space-1',
  scheduledAt: null,
  isRecurring: false,
});

describe('PlainspaceClaimPoolService', () => {
  let service: PlainspaceClaimPoolService;
  let store: MockStore;
  let apiSpy: jasmine.SpyObj<PlainspaceApiService>;
  let addTaskFromIssueSpy: jasmine.Spy;
  let snackSpy: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    apiSpy = jasmine.createSpyObj<PlainspaceApiService>('PlainspaceApiService', [
      'getUnclaimedTasks$',
      'claimTask$',
    ]);
    apiSpy.getUnclaimedTasks$.and.returnValue(of([issue('ps-102'), issue('ps-105')]));
    apiSpy.claimTask$.and.returnValue(of(issue('ps-102')));
    addTaskFromIssueSpy = jasmine.createSpy('addTaskFromIssue').and.resolveTo('t1');
    snackSpy = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        PlainspaceClaimPoolService,
        provideMockStore(),
        { provide: PlainspaceApiService, useValue: apiSpy },
        { provide: IssueService, useValue: { addTaskFromIssue: addTaskFromIssueSpy } },
        { provide: SnackService, useValue: snackSpy },
      ],
    });
    service = TestBed.inject(PlainspaceClaimPoolService);
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectEnabledIssueProviders, [PLAINSPACE_PROVIDER]);
    store.refreshState();
  });

  it('returns the unclaimed tasks for a shared project', async () => {
    const unclaimed = await firstValueFrom(service.unclaimedTasksForProject$('proj-1'));
    expect(unclaimed.map((t) => t.id)).toEqual(['ps-102', 'ps-105']);
  });

  it('returns empty when the project has no bound Plainspace provider', async () => {
    const none = await firstValueFrom(service.unclaimedTasksForProject$('other-proj'));
    expect(none).toEqual([]);
  });

  it('claim assigns the task and imports it as an SP task', async () => {
    await service.claim('proj-1', 'ps-102');

    expect(apiSpy.claimTask$).toHaveBeenCalledWith('ps-102', PLAINSPACE_PROVIDER);
    expect(addTaskFromIssueSpy).toHaveBeenCalledTimes(1);
    const arg = addTaskFromIssueSpy.calls.mostRecent().args[0];
    expect(arg.issueProviderKey).toBe('PLAINSPACE');
    expect(arg.issueDataReduced.id).toBe('ps-102');
  });

  it('shows a success snack on a successful claim', async () => {
    await service.claim('proj-1', 'ps-102');
    expect(snackSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: 'SUCCESS' }),
    );
  });

  it('shows an error snack and does not import when the claim fails', async () => {
    apiSpy.claimTask$.and.returnValue(of(null));
    await service.claim('proj-1', 'ps-102');
    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
    expect(snackSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: 'ERROR' }),
    );
  });
});
