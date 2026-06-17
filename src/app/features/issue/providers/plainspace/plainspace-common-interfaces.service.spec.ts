import { TestBed } from '@angular/core/testing';
import { PlainspaceCommonInterfacesService } from './plainspace-common-interfaces.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceIssue } from './plainspace-issue.model';
import { IssueProviderService } from '../../issue-provider.service';

describe('PlainspaceCommonInterfacesService', () => {
  let service: PlainspaceCommonInterfacesService;

  const issue = (remindAt: string | null, isDone = false): PlainspaceIssue => ({
    id: 't1',
    title: 'Buy milk',
    isDone,
    updatedAt: '2026-01-02T00:00:00.000Z',
    url: 'https://plainspace.org/p/item/t1',
    projectId: 'space-1',
    remindAt,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PlainspaceCommonInterfacesService,
        // extractSyncValues is pure, so the API stub is never called here.
        { provide: PlainspaceApiService, useValue: {} },
        { provide: IssueProviderService, useValue: {} },
      ],
    });
    service = TestBed.inject(PlainspaceCommonInterfacesService);
  });

  // Without a seeded baseline, computePushDecisions skips every push as
  // 'no-baseline', so the done + scheduled-time write-back never fires.
  it('getAddTaskData seeds the two-way-sync baseline (done + remindAt)', () => {
    const data = service.getAddTaskData(issue('2026-01-02T09:00:00.000Z', true));
    expect(data.title).toBe('Buy milk');
    expect(data.isDone).toBe(true);
    expect(data.issueLastSyncedValues).toEqual({
      isDone: true,
      remindAt: '2026-01-02T09:00:00.000Z',
    });
  });

  it('getAddTaskData baseline carries a null remindAt for unscheduled tasks', () => {
    const data = service.getAddTaskData(issue(null));
    expect(data.issueLastSyncedValues).toEqual({ isDone: false, remindAt: null });
  });

  it('getAddTaskData imports remindAt as dueWithTime (schedule shows in the app)', () => {
    const iso = '2026-01-02T09:00:00.000Z';
    const data = service.getAddTaskData(issue(iso));
    expect(data.dueWithTime).toBe(new Date(iso).getTime());
  });

  it('getAddTaskData leaves dueWithTime unset for unscheduled tasks', () => {
    const data = service.getAddTaskData(issue(null));
    expect('dueWithTime' in data).toBe(false);
  });
});
