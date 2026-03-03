import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { GithubApiService } from './github-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { GithubCfg } from './github.model';
import { GITHUB_API_BASE_URL } from './github.const';

describe('GithubApiService', () => {
  let service: GithubApiService;
  let httpMock: HttpTestingController;
  let snackService: jasmine.SpyObj<SnackService>;

  const mockCfg: GithubCfg = {
    isEnabled: true,
    repo: 'owner/repo',
    token: 'test-token',
    filterUsernameForIssueUpdates: undefined,
    backlogQuery: undefined,
  };

  beforeEach(() => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [GithubApiService, { provide: SnackService, useValue: snackServiceSpy }],
    });

    service = TestBed.inject(GithubApiService);
    httpMock = TestBed.inject(HttpTestingController);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('searchIssueForRepoNoMap$', () => {
    describe('URL encoding', () => {
      it('should properly encode simple search text', () => {
        const searchText = 'bug fix';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        expect(req.request.urlWithParams).toContain(
          'q=is%3Aissue%20bug%20fix%20repo%3Aowner%2Frepo',
        );
        req.flush({ items: [] });
      });

      it('should properly encode search with parentheses', () => {
        const searchText = 'state:open (author:@me OR assignee:@me)';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Verify parentheses are properly encoded in the URL
        expect(req.request.urlWithParams).toContain('%28'); // (
        expect(req.request.urlWithParams).toContain('%29'); // )
        expect(req.request.urlWithParams).toContain('state%3Aopen');
        expect(req.request.urlWithParams).toContain('author%3A%40me');
        req.flush({ items: [] });
      });

      it('should properly encode special characters', () => {
        const searchText = 'label:"bug fix" @mentions #123';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Verify special characters are properly encoded in the URL
        expect(req.request.urlWithParams).toContain('label%3A%22bug%20fix%22');
        expect(req.request.urlWithParams).toContain('%40mentions');
        expect(req.request.urlWithParams).toContain('%23123');
        req.flush({ items: [] });
      });

      it('should properly encode repo qualifier with forward slash', () => {
        const searchText = 'test';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Forward slash in repo name should be encoded as %2F in the URL
        expect(req.request.urlWithParams).toContain('repo%3Aowner%2Frepo');
        req.flush({ items: [] });
      });

      it('should handle search without repo filter when isSearchAllGithub is true', () => {
        const searchText = 'javascript';
        service.searchIssueForRepoNoMap$(searchText, mockCfg, true).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Should not contain repo qualifier but should have is:issue
        expect(req.request.urlWithParams).toContain('q=is%3Aissue%20javascript');
        expect(req.request.urlWithParams).not.toContain('repo%3A');
        req.flush({ items: [] });
      });

      it('should properly encode complex GitHub search query from issue #4913', () => {
        const searchText = 'sort:updated state:open (author:@me OR assignee:@me)';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // All special characters should be properly encoded in the URL
        expect(req.request.urlWithParams).toContain('sort%3Aupdated');
        expect(req.request.urlWithParams).toContain('state%3Aopen');
        expect(req.request.urlWithParams).toContain('%28'); // (
        expect(req.request.urlWithParams).toContain('%29'); // )
        expect(req.request.urlWithParams).toContain('%40me'); // @me
        req.flush({ items: [] });
      });

      it('should handle empty search text', () => {
        const searchText = '';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        expect(req.request.urlWithParams).toContain(
          'q=is%3Aissue%20%20repo%3Aowner%2Frepo',
        );
        req.flush({ items: [] });
      });

      it('should properly encode plus signs in search', () => {
        const searchText = 'C++ programming';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Plus signs should be encoded
        expect(req.request.urlWithParams).toContain('C%2B%2B');
        req.flush({ items: [] });
      });

      it('should properly encode ampersands', () => {
        const searchText = 'R&D issues';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Ampersand should be encoded as %26
        expect(req.request.urlWithParams).toContain('R%26D');
        req.flush({ items: [] });
      });

      it('should properly encode equals signs', () => {
        const searchText = 'variable=value';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Equals sign should be encoded as %3D
        expect(req.request.urlWithParams).toContain('variable%3Dvalue');
        req.flush({ items: [] });
      });

      it('should properly encode question marks', () => {
        const searchText = 'what? why?';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Question mark should be encoded as %3F
        expect(req.request.urlWithParams).toContain('what%3F');
        expect(req.request.urlWithParams).toContain('why%3F');
        req.flush({ items: [] });
      });

      it('should properly encode brackets', () => {
        const searchText = 'array[index] object{key}';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Brackets should be encoded
        expect(req.request.urlWithParams).toContain('%5B'); // [
        expect(req.request.urlWithParams).toContain('%5D'); // ]
        expect(req.request.urlWithParams).toContain('%7B'); // {
        expect(req.request.urlWithParams).toContain('%7D'); // }
        req.flush({ items: [] });
      });

      it('should handle unicode characters', () => {
        const searchText = '日本語 emoji 😀';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Unicode should be properly encoded
        expect(req.request.urlWithParams).toContain('%E6%97%A5%E6%9C%AC%E8%AA%9E');
        expect(req.request.urlWithParams).toContain('%F0%9F%98%80');
        req.flush({ items: [] });
      });

      it('should properly build query with space separator between search and repo', () => {
        const searchText = 'test search';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Query should use space separator, not plus
        expect(req.request.urlWithParams).toContain('test%20search%20repo');
        req.flush({ items: [] });
      });

      it('should not duplicate is:issue when already in search text', () => {
        const searchText = 'is:issue state:open assignee:@me';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Should contain exactly one is:issue, not is:issue is:issue
        const decodedUrl = decodeURIComponent(req.request.urlWithParams);
        const matches = decodedUrl.match(/is:issue/g);
        expect(matches?.length).toBe(1);
        req.flush({ items: [] });
      });

      it('should not add is:issue when is:pull-request is in search text', () => {
        const searchText = 'is:pull-request state:open';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        const decodedUrl = decodeURIComponent(req.request.urlWithParams);
        expect(decodedUrl).not.toContain('is:issue');
        expect(decodedUrl).toContain('is:pull-request');
        req.flush({ items: [] });
      });

      it('should not truncate query - specific test for issue #4913', () => {
        // This test specifically checks for the truncation bug where "sort" became "rt"
        const searchText = 'sort:updated state:open (author:@me OR assignee:@me)';
        service.searchIssueForRepoNoMap$(searchText, mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        // Critical: ensure the query starts with "is:issue sort" and is not truncated
        expect(req.request.urlWithParams).toContain('q=is%3Aissue%20sort%3A');
        expect(req.request.urlWithParams).not.toContain('q=rt%3A');

        // Also verify the full query structure is intact
        expect(req.request.urlWithParams).toContain('sort%3Aupdated');
        expect(req.request.urlWithParams).toContain('state%3Aopen');
        expect(req.request.urlWithParams).toContain(
          '%28author%3A%40me%20OR%20assignee%3A%40me%29',
        );
        req.flush({ items: [] });
      });
    });

    describe('request headers', () => {
      it('should include authorization token when provided', () => {
        service.searchIssueForRepoNoMap$('test', mockCfg).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        expect(req.request.headers.get('Authorization')).toBe('token test-token');
        req.flush({ items: [] });
      });

      it('should not include authorization header when token is not provided', () => {
        const cfgWithoutToken = { ...mockCfg, token: null };
        service.searchIssueForRepoNoMap$('test', cfgWithoutToken).subscribe();

        const req = httpMock.expectOne((request) =>
          request.url.startsWith(`${GITHUB_API_BASE_URL}search/issues`),
        );

        expect(req.request.headers.has('Authorization')).toBeFalsy();
        req.flush({ items: [] });
      });
    });

    describe('error handling', () => {
      it('should handle missing repo configuration', () => {
        const invalidCfg = { ...mockCfg, repo: '' };

        expect(() => {
          service.searchIssueForRepoNoMap$('test', invalidCfg).subscribe();
        }).toThrowError('Github: Not enough settings');

        expect(snackService.open).toHaveBeenCalled();
      });
    });
  });
});
