import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { RedmineApiService } from './redmine-api.service';
import { RedmineCfg } from './redmine.model';
import { SearchResultItem } from '../../issue.model';
import { SnackService } from '../../../../core/snack/snack.service';

describe('RedmineApiService', () => {
  let service: RedmineApiService;
  let httpMock: HttpTestingController;

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
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('searchIssuesInProject$', () => {
    const searchUrl = (query: string): string =>
      `${mockCfg.host}/projects/${mockCfg.projectId}/search.json?limit=100&q=${query}&issues=1&open_issues=1`;

    it('should only send a text search request for non-numeric queries', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('some text', mockCfg).subscribe((r) => (result = r));

      const req = httpMock.expectOne(searchUrl('some%20text'));
      expect(req.request.method).toBe('GET');
      req.flush(mockSearchResponse);

      httpMock.expectNone(`${mockCfg.host}/issues/100.json`);
      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('Bug #100: Some text issue');
    });

    it('should additionally fetch the issue by id for numeric queries', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('22899', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(`${mockCfg.host}/issues/22899.json`);
      expect(byIdReq.request.method).toBe('GET');
      byIdReq.flush({ issue: { id: 22899, subject: 'Issue found by id' } });

      const searchReq = httpMock.expectOne(searchUrl('22899'));
      searchReq.flush(mockSearchResponse);

      expect(result?.length).toBe(2);
      expect(result?.[0].title).toBe('#22899 Issue found by id');
      expect((result?.[0].issueData as { id: number }).id).toBe(22899);
    });

    it('should support queries prefixed with #', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('#22899', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(`${mockCfg.host}/issues/22899.json`);
      byIdReq.flush({ issue: { id: 22899, subject: 'Issue found by id' } });

      const searchReq = httpMock.expectOne(searchUrl('%2322899'));
      searchReq.flush({ ...mockSearchResponse, results: [] });

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('#22899 Issue found by id');
    });

    it('should de-duplicate the by-id issue from text search results', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('100', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(`${mockCfg.host}/issues/100.json`);
      byIdReq.flush({ issue: { id: 100, subject: 'Some text issue' } });

      const searchReq = httpMock.expectOne(searchUrl('100'));
      searchReq.flush(mockSearchResponse);

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('#100 Some text issue');
    });

    it('should fall back to text search results when issue id is not found', () => {
      let result: SearchResultItem[] | undefined;
      service.searchIssuesInProject$('99999', mockCfg).subscribe((r) => (result = r));

      const byIdReq = httpMock.expectOne(`${mockCfg.host}/issues/99999.json`);
      byIdReq.flush('Not found', { status: 404, statusText: 'Not Found' });

      const searchReq = httpMock.expectOne(searchUrl('99999'));
      searchReq.flush(mockSearchResponse);

      expect(result?.length).toBe(1);
      expect(result?.[0].title).toBe('Bug #100: Some text issue');
    });
  });
});
