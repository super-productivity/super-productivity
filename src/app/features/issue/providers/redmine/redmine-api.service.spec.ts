import {
  HttpClientTestingModule,
  HttpTestingController,
  TestRequest,
} from '@angular/common/http/testing';
import { HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SnackService } from '../../../../core/snack/snack.service';
import { SearchResultItem } from '../../issue.model';
import { RedmineApiService } from './redmine-api.service';
import { RedmineCfg } from './redmine.model';

describe('RedmineApiService', () => {
  let service: RedmineApiService;
  let httpMock: HttpTestingController;
  let snackService: jasmine.SpyObj<SnackService>;

  const mockCfg: RedmineCfg = {
    isEnabled: true,
    host: 'https://redmine.example.com',
    projectId: 'test-project',
    api_key: 'test-api-key',
    scope: null,
  };

  const mockSearchResponse = {
    results: [
      {
        id: 100,
        title: 'Bug #100: Some text issue',
        url: 'https://redmine.example.com/issues/100',
      },
    ],
    total_count: 1,
    offset: 0,
    limit: 100,
  };

  const searchUrl = (query: string): string =>
    `${mockCfg.host}/projects/${mockCfg.projectId}/search.json?limit=100&q=${query}&issues=1&open_issues=1`;

  const byIdInProjectMatcher =
    (issueId: number) =>
    (req: HttpRequest<unknown>): boolean =>
      req.method === 'GET' &&
      req.url === `${mockCfg.host}/projects/${mockCfg.projectId}/issues.json` &&
      req.params.get('issue_id') === String(issueId) &&
      req.params.get('status_id') === '*';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        RedmineApiService,
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    service = TestBed.inject(RedmineApiService);
    httpMock = TestBed.inject(HttpTestingController);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('searchIssuesInProject$', () => {
    it('should only send a text search request for non-numeric Latin queries', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('some text', mockCfg).subscribe((r) => (result = r));

      const req = httpMock.expectOne(searchUrl('some%20text'));
      expect(req.request.method).toBe('GET');
      req.flush(mockSearchResponse);

      httpMock.expectNone(byIdInProjectMatcher(100));
      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('Bug #100: Some text issue');
    });

    it('should additionally fetch the issue by id (project-scoped) for numeric queries', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('22899', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(byIdInProjectMatcher(22899));
      byIdReq.flush({ issues: [{ id: 22899, subject: 'Issue found by id' }] });

      const searchReq = httpMock.expectOne(searchUrl('22899'));
      searchReq.flush(mockSearchResponse);

      expect(result?.length).toBe(2);
      expect(result?.[0].title).toBe('#22899 Issue found by id');
      expect((result?.[0].issueData as { id: number }).id).toBe(22899);
    });

    it('should support queries prefixed with #', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('#22899', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(byIdInProjectMatcher(22899));
      byIdReq.flush({ issues: [{ id: 22899, subject: 'Issue found by id' }] });

      const searchReq = httpMock.expectOne(searchUrl('%2322899'));
      searchReq.flush({ ...mockSearchResponse, results: [] });

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('#22899 Issue found by id');
    });

    it('should de-duplicate the by-id issue from text search results', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('100', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(byIdInProjectMatcher(100));
      byIdReq.flush({ issues: [{ id: 100, subject: 'Some text issue' }] });

      const searchReq = httpMock.expectOne(searchUrl('100'));
      searchReq.flush(mockSearchResponse);

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('#100 Some text issue');
    });

    it('should fall back to text search results when the id is not in the project', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('99999', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(byIdInProjectMatcher(99999));
      byIdReq.flush({ issues: [], total_count: 0, offset: 0, limit: 1 });

      const searchReq = httpMock.expectOne(searchUrl('99999'));
      searchReq.flush(mockSearchResponse);

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('Bug #100: Some text issue');
    });

    it('should not surface an issue id that belongs to another project', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('424242', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(byIdInProjectMatcher(424242));
      byIdReq.flush({ issues: [], total_count: 0, offset: 0, limit: 1 });

      const searchReq = httpMock.expectOne(searchUrl('424242'));
      searchReq.flush({ ...mockSearchResponse, results: [] });

      httpMock.expectNone(`${mockCfg.host}/issues/424242.json`);
      expect(result?.length).toBe(0);
    });

    it('adds a subject filter fallback for non-Latin queries without full text results', () => {
      service.searchIssuesInProject$('修正', mockCfg).subscribe((issues) => {
        expect(issues.length).toBe(1);
        expect(issues[0].title).toBe('#23 修正ログイン');
        expect(issues[0].issueData.id).toBe(23);
      });

      const searchReq = httpMock.expectOne(searchUrl('%E4%BF%AE%E6%AD%A3'));
      searchReq.flush({
        results: [],
        total_count: 0,
        offset: 0,
        limit: 100,
      });

      const fallbackReq = expectSubjectFallbackRequest(httpMock, mockCfg, '修正');
      expect(fallbackReq.request.method).toBe('GET');
      fallbackReq.flush({
        issues: [
          {
            id: 23,
            subject: '修正ログイン',
            title: '修正ログイン',
            updated_on: '2026-01-01T00:00:00Z',
            url: 'https://redmine.example.com/issues/23',
          },
        ],
        total_count: 1,
        offset: 0,
        limit: 100,
      });
    });

    it('does not request the subject fallback when full text search already returns results', () => {
      service.searchIssuesInProject$('修正', mockCfg).subscribe((issues) => {
        expect(issues.map((issue) => issue.issueData.id)).toEqual([23]);
      });

      const searchReq = httpMock.expectOne(searchUrl('%E4%BF%AE%E6%AD%A3'));
      searchReq.flush({
        results: [
          {
            id: 23,
            title: '#23 修正ログイン',
            url: 'https://redmine.example.com/issues/23',
          },
        ],
        total_count: 1,
        offset: 0,
        limit: 100,
      });

      httpMock.expectNone((req: HttpRequest<unknown>) => {
        return req.url === `${mockCfg.host}/projects/${mockCfg.projectId}/issues.json`;
      });
    });

    it('keeps full text results when subject fallback fails', () => {
      service.searchIssuesInProject$('修正', mockCfg).subscribe((issues) => {
        expect(issues).toEqual([]);
      });

      const searchReq = httpMock.expectOne(searchUrl('%E4%BF%AE%E6%AD%A3'));
      searchReq.flush({
        results: [],
        total_count: 0,
        offset: 0,
        limit: 100,
      });

      const fallbackReq = expectSubjectFallbackRequest(httpMock, mockCfg, '修正');
      fallbackReq.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      expect(snackService.open).not.toHaveBeenCalled();
    });
  });

  describe('global mode (no projectId)', () => {
    // When projectId is empty the service queries the whole Redmine instance: requests hit
    // the instance-wide endpoints (no `/projects/<id>` URL segment).
    const globalCfg: RedmineCfg = { ...mockCfg, projectId: null };

    const globalSearchUrl = (query: string): string =>
      `${globalCfg.host}/search.json?limit=100&q=${query}&issues=1&open_issues=1`;

    // by-id lookup against the instance-wide /issues.json (no project segment)
    const byIdGlobalMatcher =
      (issueId: number) =>
      (req: HttpRequest<unknown>): boolean =>
        req.method === 'GET' &&
        req.url === `${globalCfg.host}/issues.json` &&
        req.params.get('issue_id') === String(issueId) &&
        req.params.get('status_id') === '*';

    it('should run text search against the instance-wide /search.json', () => {
      let result: SearchResultItem[] | undefined;
      service
        .searchIssuesInProject$('some text', globalCfg)
        .subscribe((r) => (result = r));

      const req = httpMock.expectOne(globalSearchUrl('some%20text'));
      expect(req.request.method).toBe('GET');
      req.flush(mockSearchResponse);

      httpMock.expectNone(byIdGlobalMatcher(100));
      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('Bug #100: Some text issue');
    });

    it('should additionally fetch the issue by id (instance-wide) for numeric queries', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('22899', globalCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(byIdGlobalMatcher(22899));
      byIdReq.flush({ issues: [{ id: 22899, subject: 'Issue found by id' }] });

      const searchReq = httpMock.expectOne(globalSearchUrl('22899'));
      searchReq.flush(mockSearchResponse);

      expect(result?.length).toBe(2);
      expect(result?.[0].title).toBe('#22899 Issue found by id');
      expect((result?.[0].issueData as { id: number }).id).toBe(22899);
    });

    it('should support queries prefixed with # in global mode', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('#22899', globalCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(byIdGlobalMatcher(22899));
      byIdReq.flush({ issues: [{ id: 22899, subject: 'Issue found by id' }] });

      const searchReq = httpMock.expectOne(globalSearchUrl('%2322899'));
      searchReq.flush({ ...mockSearchResponse, results: [] });

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('#22899 Issue found by id');
    });

    it('should surface an issue from any project in global mode', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('424242', globalCfg).subscribe((r) => (result = r));

      // In global mode the instance-wide lookup intentionally returns the issue regardless
      // of which project it belongs to (the inverse of the project-scoped behaviour).
      const byIdReq = httpMock.expectOne(byIdGlobalMatcher(424242));
      byIdReq.flush({ issues: [{ id: 424242, subject: 'Cross-project issue' }] });

      const searchReq = httpMock.expectOne(globalSearchUrl('424242'));
      searchReq.flush({ ...mockSearchResponse, results: [] });

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('#424242 Cross-project issue');
    });

    it('should fetch the last 100 issues from the instance-wide /issues.json', () => {
      let result: unknown[] | undefined;
      service
        .getLast100IssuesForCurrentRedmineProject$(globalCfg)
        .subscribe((r) => (result = r));

      const req = httpMock.expectOne(`${globalCfg.host}/issues.json?limit=100`);
      expect(req.request.method).toBe('GET');
      req.flush({ issues: [{ id: 1, subject: 'Latest issue' }] });

      expect(result?.length).toBe(1);
    });

    it('should run the non-Latin subject fallback against instance-wide /issues.json', () => {
      service.searchIssuesInProject$('修正', globalCfg).subscribe((issues) => {
        expect(issues.length).toBe(1);
        expect(issues[0].title).toBe('#23 修正ログイン');
      });

      const searchReq = httpMock.expectOne(globalSearchUrl('%E4%BF%AE%E6%AD%A3'));
      searchReq.flush({
        results: [],
        total_count: 0,
        offset: 0,
        limit: 100,
      });

      const fallbackReq = expectSubjectFallbackRequest(httpMock, globalCfg, '修正');
      expect(fallbackReq.request.method).toBe('GET');
      fallbackReq.flush({
        issues: [
          {
            id: 23,
            subject: '修正ログイン',
            title: '修正ログイン',
            updated_on: '2026-01-01T00:00:00Z',
            url: 'https://redmine.example.com/issues/23',
          },
        ],
        total_count: 1,
        offset: 0,
        limit: 100,
      });
    });
  });
});

const expectSubjectFallbackRequest = (
  httpMock: HttpTestingController,
  cfg: RedmineCfg,
  query: string,
): TestRequest =>
  httpMock.expectOne((req: HttpRequest<unknown>) => {
    const params = req.params;

    return (
      req.url ===
        `${cfg.host}${cfg.projectId ? `/projects/${cfg.projectId}` : ''}/issues.json` &&
      params.get('limit') === '100' &&
      params.get('status_id') === 'open' &&
      params.get('set_filter') === '1' &&
      params.get('f[]') === 'subject' &&
      params.get('op[subject]') === '~' &&
      params.get('v[subject][]') === query
    );
  });
