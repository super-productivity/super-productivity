import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SnackService } from 'src/app/core/snack/snack.service';
import { GitlabApiService } from './gitlab-api.service';
import { GitlabCfg } from '../gitlab.model';
import { DEFAULT_GITLAB_CFG } from '../gitlab.const';
import { GitlabOriginalIssue, GitlabOriginalUser } from './gitlab-api-responses';
import { SearchResultItem } from '../../../issue.model';

const USER: GitlabOriginalUser = {
  id: 1,
  username: 'u',
  name: 'U',
  state: 'active',
  avatar_url: '',
  web_url: '',
};

const makeOriginalIssue = (iid: number): GitlabOriginalIssue => ({
  id: 1000 + iid,
  iid,
  project_id: 1,
  title: `Issue ${iid}`,
  description: 'desc',
  state: 'open',
  weight: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  closed_at: '',
  closed_by: '',
  labels: [],
  milestone: null,
  assignees: [],
  author: USER,
  assignee: USER,
  user_notes_count: 7,
  merge_requests_count: 0,
  upvotes: 0,
  downvotes: 0,
  due_date: '',
  confidential: false,
  discussion_locked: false,
  web_url: `https://gitlab.com/group/sub/proj/-/issues/${iid}`,
  time_stats: {
    time_estimate: 0,
    total_time_spent: 0,
    human_time_estimate: '',
    human_total_time_spent: '',
  },
  task_completion_status: { count: 0, completed_count: 0 },
  has_tasks: false,
  task_status: '',
  _links: {
    self: `https://gitlab.com/api/v4/projects/1/issues/${iid}`,
    notes: `https://gitlab.com/api/v4/projects/1/issues/${iid}/notes`,
    award_emoji: '',
    project: '',
  },
  references: {
    short: `#${iid}`,
    relative: `#${iid}`,
    full: `group/sub/proj#${iid}`,
  },
  moved_to_id: 0,
});

describe('GitlabApiService', () => {
  let service: GitlabApiService;
  let httpMock: HttpTestingController;

  const cfg: GitlabCfg = {
    ...DEFAULT_GITLAB_CFG,
    isEnabled: true,
    project: 'group/sub/proj',
    token: 'token',
    scope: 'all',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        GitlabApiService,
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    service = TestBed.inject(GitlabApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('searchIssueInProject$', () => {
    it('fetches only the first page and never requests per-issue notes/comments (#9034)', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssueInProject$('bug', cfg).subscribe((r) => (result = r));

      const reqs = httpMock.match(() => true);
      expect(reqs.length).toBe(1);
      const req = reqs[0].request;
      expect(req.method).toBe('GET');
      expect(req.url).toContain('/issues');
      expect(req.url).toContain('page=1');
      expect(req.url).toContain('per_page=100');
      expect(req.url).not.toContain('/notes');

      // Respond WITH an x-next-page header — the service must NOT follow it, otherwise a
      // large project would trigger the request storm this fix removes.
      reqs[0].flush([makeOriginalIssue(1), makeOriginalIssue(2)], {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'x-next-page': '2' },
      });

      // No follow-up page request and no per-issue /notes request.
      httpMock.expectNone(() => true);
      expect(result?.length).toBe(2);
      expect(result?.[0].title).toBe('#group/sub/proj#1 Issue 1');
      expect(result?.[0].issueType).toBe('GITLAB');
    });

    it('resolves to [] and sends no request when settings are invalid', () => {
      let result: SearchResultItem[] | undefined;
      let completed = false;
      service
        .searchIssueInProject$('bug', { ...cfg, project: null })
        .subscribe({ next: (r) => (result = r), complete: () => (completed = true) });

      httpMock.expectNone(() => true);
      // EMPTY completes without emitting a value.
      expect(result).toBeUndefined();
      expect(completed).toBe(true);
    });
  });
});
