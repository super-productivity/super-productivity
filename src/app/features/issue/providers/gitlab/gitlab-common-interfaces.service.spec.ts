import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GitlabCommonInterfacesService } from './gitlab-common-interfaces.service';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { DEFAULT_GITLAB_CFG } from './gitlab.const';
import { GitlabIssue } from './gitlab-issue.model';
import {
  GitlabOriginalComment,
  GitlabOriginalUser,
} from './gitlab-api/gitlab-api-responses';
import { createTask } from '../../../tasks/task.test-helper';
import { Task } from '../../../tasks/task.model';
import { IssueProviderGitlab } from '../../issue.model';

const ISSUE_PROVIDER_ID = 'gitlab-provider-1';
const ISSUE_ID = 'project/repo#42';
const ISSUE_BODY = 'body';
const BASE_UPDATED_AT = '2026-01-08T03:29:14.653Z';
const LATER_COMMENT_AT = '2026-01-08T03:29:14.717Z';
const NEWER_UPDATED_AT = '2026-01-08T03:30:00.000Z';

const BASE_CFG: IssueProviderGitlab = {
  ...DEFAULT_GITLAB_CFG,
  id: ISSUE_PROVIDER_ID,
  issueProviderKey: 'GITLAB',
  isEnabled: true,
  project: 'project/repo',
  token: 'token',
  filterUsername: 'current-user',
};

const USER: GitlabOriginalUser = {
  id: 1,
  username: 'another-user',
  name: 'Another User',
  state: 'active',
  avatar_url: '',
  web_url: '',
};

const makeComment = (createdAt: string, body = 'comment'): GitlabOriginalComment => ({
  id: 1,
  body,
  attachment: '',
  author: USER,
  created_at: createdAt,
  updated_at: createdAt,
  system: false,
  noteable_id: 42,
  noteable_type: 'Issue',
  noteable_iid: 42,
  resolvable: false,
});

const makeIssue = (
  updatedAt: string,
  comments: GitlabOriginalComment[] = [],
  body = ISSUE_BODY,
): GitlabIssue => ({
  html_url: 'https://gitlab.example.com/project/repo/-/issues/42',
  number: 42,
  state: 'open',
  title: 'GitLab issue',
  body,
  user: USER,
  labels: [],
  assignee: USER,
  milestone: {
    id: 1,
    iid: 1,
    project_id: 1,
    title: 'milestone',
    description: '',
    start_date: '',
    due_date: '',
    state: 'active',
    created_at: updatedAt,
    updated_at: updatedAt,
  },
  closed_at: '',
  created_at: '2026-01-08T03:00:00.000Z',
  updated_at: updatedAt,
  wasUpdated: false,
  commentsNr: comments.length,
  comments,
  url: 'https://gitlab.example.com/project/repo/-/issues/42',
  id: ISSUE_ID,
  links: {
    self: 'https://gitlab.example.com/api/v4/projects/1/issues/42',
    notes: 'https://gitlab.example.com/api/v4/projects/1/issues/42/notes',
    award_emoji: 'https://gitlab.example.com/api/v4/projects/1/issues/42/award_emoji',
    project: 'https://gitlab.example.com/api/v4/projects/1',
  },
});

const makeTask = (issueLastUpdated: number): Task =>
  createTask({
    id: 'task-1',
    title: '#42 GitLab issue',
    issueId: ISSUE_ID,
    issueProviderId: ISSUE_PROVIDER_ID,
    issueType: 'GITLAB',
    issueLastUpdated,
    issueWasUpdated: false,
  });

describe('GitlabCommonInterfacesService', () => {
  let service: GitlabCommonInterfacesService;
  let gitlabApiService: jasmine.SpyObj<GitlabApiService>;
  let issueProviderService: jasmine.SpyObj<IssueProviderService>;

  beforeEach(() => {
    gitlabApiService = jasmine.createSpyObj('GitlabApiService', [
      'getById$',
      'searchIssueInProject$',
      'getProjectIssues$',
    ]);
    issueProviderService = jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']);
    issueProviderService.getCfgOnce$.and.returnValue(of(BASE_CFG));

    TestBed.configureTestingModule({
      providers: [
        GitlabCommonInterfacesService,
        { provide: GitlabApiService, useValue: gitlabApiService },
        { provide: IssueProviderService, useValue: issueProviderService },
      ],
    });
    service = TestBed.inject(GitlabCommonInterfacesService);
  });

  describe('getFreshDataForIssueTask', () => {
    it('does not flag an update when only a GitLab comment timestamp is later than issue.updated_at', async () => {
      const issueLastUpdated = new Date(BASE_UPDATED_AT).getTime();
      gitlabApiService.getById$.and.returnValue(
        of(makeIssue(BASE_UPDATED_AT, [makeComment(LATER_COMMENT_AT)])),
      );

      const result = await service.getFreshDataForIssueTask(makeTask(issueLastUpdated));

      expect(result).toBeNull();
    });

    it('does not flag an update from a later comment after the user marked updates as read', async () => {
      const issueLastUpdated = new Date(LATER_COMMENT_AT).getTime();
      gitlabApiService.getById$.and.returnValue(
        of(makeIssue(BASE_UPDATED_AT, [makeComment(LATER_COMMENT_AT)])),
      );

      const result = await service.getFreshDataForIssueTask(makeTask(issueLastUpdated));

      expect(result).toBeNull();
    });

    it('flags a new GitLab comment as an update when issue.updated_at is bumped', async () => {
      const issueLastUpdated = new Date(BASE_UPDATED_AT).getTime();
      gitlabApiService.getById$.and.returnValue(
        of(makeIssue(NEWER_UPDATED_AT, [makeComment(NEWER_UPDATED_AT, 'new comment')])),
      );

      const result = await service.getFreshDataForIssueTask(makeTask(issueLastUpdated));

      expect(result?.taskChanges.issueWasUpdated).toBe(true);
      expect(result?.taskChanges.issueLastUpdated).toBe(
        new Date(NEWER_UPDATED_AT).getTime(),
      );
      const issue = result?.issue as GitlabIssue;
      expect(issue.body).toBe(ISSUE_BODY);
      expect(issue.commentsNr).toBe(1);
      expect(result?.issueTitle).toBe('#42 GitLab issue');
    });
  });
});
