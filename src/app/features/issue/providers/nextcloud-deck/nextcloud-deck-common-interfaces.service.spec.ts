import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NextcloudDeckCommonInterfacesService } from './nextcloud-deck-common-interfaces.service';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { DEFAULT_NEXTCLOUD_DECK_CFG } from './nextcloud-deck.const';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
} from './nextcloud-deck-issue.model';
import { createTask } from '../../../tasks/task.test-helper';
import { Task } from '../../../tasks/task.model';
import { IssueProviderNextcloudDeck } from '../../issue.model';

const ISSUE_PROVIDER_ID = 'deck-provider-1';
const ISSUE_ID = '42';

const CFG: IssueProviderNextcloudDeck = {
  ...DEFAULT_NEXTCLOUD_DECK_CFG,
  id: ISSUE_PROVIDER_ID,
  issueProviderKey: 'NEXTCLOUD_DECK',
  isEnabled: true,
  nextcloudBaseUrl: 'https://nc.example.com',
  username: 'user',
  password: 'pass',
  selectedBoardId: 1,
};

const makeReducedCard = (done: boolean): NextcloudDeckIssueReduced => ({
  id: 42,
  title: 'A card',
  stackId: 1,
  stackTitle: 'Stack',
  lastModified: 200,
  done,
  labels: [],
});

const makeIssue = (done: boolean): NextcloudDeckIssue => ({
  ...makeReducedCard(done),
  description: '',
  duedate: null,
  assignedUsers: [],
  boardId: 1,
  order: 0,
});

const makeTask = (): Task =>
  createTask({
    id: 'task-1',
    title: 'A card',
    issueId: ISSUE_ID,
    issueProviderId: ISSUE_PROVIDER_ID,
    issueType: 'NEXTCLOUD_DECK',
    issueLastUpdated: 100,
  });

describe('NextcloudDeckCommonInterfacesService', () => {
  let service: NextcloudDeckCommonInterfacesService;
  let apiService: jasmine.SpyObj<NextcloudDeckApiService>;
  let issueProviderService: jasmine.SpyObj<IssueProviderService>;

  beforeEach(() => {
    apiService = jasmine.createSpyObj('NextcloudDeckApiService', [
      'getById$',
      'getOpenCards$',
    ]);
    issueProviderService = jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']);
    issueProviderService.getCfgOnce$.and.returnValue(of(CFG));

    TestBed.configureTestingModule({
      providers: [
        NextcloudDeckCommonInterfacesService,
        { provide: NextcloudDeckApiService, useValue: apiService },
        { provide: IssueProviderService, useValue: issueProviderService },
      ],
    });
    service = TestBed.inject(NextcloudDeckCommonInterfacesService);
  });

  // Guards the sinks that write to synced task.isDone (issue #8436). The API
  // service normalizes done to a boolean; these assert the value is forwarded
  // as a real boolean and never null/undefined.
  describe('isDone is always a boolean (issue #8436)', () => {
    it('getFreshDataForIssueTask forwards done:false as boolean false', async () => {
      apiService.getById$.and.returnValue(of(makeIssue(false)));

      const result = await service.getFreshDataForIssueTask(makeTask());

      expect(result?.taskChanges.isDone).toBe(false);
      expect(typeof result?.taskChanges.isDone).toBe('boolean');
    });

    it('getFreshDataForIssueTask forwards done:true as boolean true', async () => {
      apiService.getById$.and.returnValue(of(makeIssue(true)));

      const result = await service.getFreshDataForIssueTask(makeTask());

      expect(result?.taskChanges.isDone).toBe(true);
      expect(typeof result?.taskChanges.isDone).toBe('boolean');
    });

    it('getFreshDataForIssueTasks (batch poll) forwards done as boolean false', async () => {
      apiService.getOpenCards$.and.returnValue(of([makeReducedCard(false)]));

      const result = await service.getFreshDataForIssueTasks([makeTask()]);

      expect(result.length).toBe(1);
      expect(result[0].taskChanges.isDone).toBe(false);
      expect(typeof result[0].taskChanges.isDone).toBe('boolean');
    });
  });
});
