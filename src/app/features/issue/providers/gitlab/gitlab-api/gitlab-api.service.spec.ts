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
import { Log } from 'src/app/core/log';
import { GitlabIssue } from '../gitlab-issue.model';

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

  afterEach(() => {
    httpMock.verify();
    Log.clearLogHistory();
  });

  it('keeps a private GitLab host and project path out of exported logs during lookup', () => {
    const privateHost = 'private-gitlab.example.test';
    const privateProject = 'private-group/private-project';
    const privateCfg = { ...cfg, gitlabBaseUrl: `https://${privateHost}` };
    let result: GitlabIssue | undefined;
    Log.clearLogHistory();

    service.getById$(`${privateProject}#1`, privateCfg).subscribe((issue) => {
      result = issue;
    });

    const issueReq = httpMock.expectOne((req) => req.url.includes(privateHost));
    expect(issueReq.request.url).toContain('private-group%2Fprivate-project');
    issueReq.flush([makeOriginalIssue(1)]);

    const commentsReq = httpMock.expectOne((req) => req.url.includes('/notes'));
    commentsReq.flush([]);

    expect(result?.number).toBe(1);
    expect(result?.comments).toEqual([]);
    expect(Log.exportLogHistory()).not.toContain(privateHost);
    expect(Log.exportLogHistory()).not.toContain(privateProject);
  });

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

    it('URL-encodes the search term so "#" and "&" do not break the query (#9907)', () => {
      service.searchIssueInProject$('fix #42 & bug', cfg).subscribe();

      const req = httpMock.expectOne(() => true);
      const url = new URL(req.request.url);
      expect(url.searchParams.get('search')).toBe('fix #42 & bug');
      expect(url.searchParams.get('scope')).toBe('all');
      expect(url.searchParams.get('order_by')).toBe('updated_at');
      req.flush([]);
    });

    it('keeps a "#" in the custom filter from truncating the query (#10151)', () => {
      service
        .searchIssueInProject$('bug', { ...cfg, filter: 'labels=C#&state=opened' })
        .subscribe();

      const req = httpMock.expectOne(() => true);
      const url = new URL(req.request.url);
      expect(url.searchParams.get('labels')).toBe('C#');
      expect(url.searchParams.get('state')).toBe('opened');
      expect(url.searchParams.get('search')).toBe('bug');
      req.flush([]);
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

  describe('issueSource: group', () => {
    const groupCfg: GitlabCfg = {
      ...cfg,
      project: 'old/proj',
      issueSource: 'group',
      group: 'my-org/sub',
      scope: 'created-by-me',
    };

    it('searches the group endpoint with an encoded path and the documented scope', () => {
      service.searchIssueInProject$('bug', groupCfg).subscribe();

      const req = httpMock.expectOne(() => true);
      const url = new URL(req.request.url);
      expect(url.pathname).toBe('/api/v4/groups/my-org%2Fsub/issues');
      expect(url.searchParams.get('scope')).toBe('created_by_me');
      expect(url.searchParams.get('search')).toBe('bug');
      req.flush([]);
    });

    it('imports open issues from the group endpoint', () => {
      let result: GitlabIssue[] | undefined;
      service.getProjectIssues$(groupCfg).subscribe((r) => (result = r));

      const req = httpMock.expectOne(() => true);
      const url = new URL(req.request.url);
      expect(url.pathname).toBe('/api/v4/groups/my-org%2Fsub/issues');
      expect(url.searchParams.get('state')).toBe('opened');
      req.flush([makeOriginalIssue(4)]);

      expect(result?.[0].id).toBe('group/sub/proj#4');
    });

    it('sends no request when the group is missing', () => {
      service.searchIssueInProject$('bug', { ...groupCfg, group: null }).subscribe();
      httpMock.expectNone(() => true);
    });
  });

  describe('issueSource: all', () => {
    const allCfg: GitlabCfg = {
      ...cfg,
      project: null,
      issueSource: 'all',
      scope: 'assigned-to-me',
    };

    it('searches the global /issues endpoint with the documented scope value', () => {
      service.searchIssueInProject$('bug', allCfg).subscribe();

      const req = httpMock.expectOne(() => true);
      const url = new URL(req.request.url);
      expect(url.pathname).toBe('/api/v4/issues');
      expect(url.searchParams.get('scope')).toBe('assigned_to_me');
      expect(url.searchParams.get('search')).toBe('bug');
      req.flush([]);
    });

    it('imports open issues from the global endpoint on a custom host', () => {
      let result: GitlabIssue[] | undefined;
      service
        .getProjectIssues$({ ...allCfg, gitlabBaseUrl: 'https://git.example.test' })
        .subscribe((r) => (result = r));

      const req = httpMock.expectOne(() => true);
      const url = new URL(req.request.url);
      expect(url.origin + url.pathname).toBe('https://git.example.test/api/v4/issues');
      expect(url.searchParams.get('state')).toBe('opened');
      req.flush([makeOriginalIssue(3)]);

      expect(result?.length).toBe(1);
      expect(result?.[0].id).toBe('group/sub/proj#3');
    });

    it('ignores a stale project value when enabled', () => {
      service
        .searchIssueInProject$('bug', { ...allCfg, project: 'old/proj' })
        .subscribe();

      const req = httpMock.expectOne(() => true);
      expect(new URL(req.request.url).pathname).toBe('/api/v4/issues');
      req.flush([]);
    });

    it('fetches a single issue through its own project', () => {
      service.getById$('other/repo#9', allCfg).subscribe();

      const issueReq = httpMock.expectOne((req) => !req.url.includes('/notes'));
      expect(issueReq.request.url).toContain('/api/v4/projects/other%2Frepo/issues/9');
      issueReq.flush([makeOriginalIssue(9)]);
      httpMock.expectOne((req) => req.url.includes('/notes')).flush([]);
    });

    it('keeps the stored scope value for the project endpoint', () => {
      service
        .searchIssueInProject$('bug', { ...cfg, scope: 'assigned-to-me' })
        .subscribe();

      const req = httpMock.expectOne(() => true);
      const url = new URL(req.request.url);
      expect(url.pathname).toBe('/api/v4/projects/group%2Fsub%2Fproj/issues');
      expect(url.searchParams.get('scope')).toBe('assigned-to-me');
      req.flush([]);
    });
  });
});
