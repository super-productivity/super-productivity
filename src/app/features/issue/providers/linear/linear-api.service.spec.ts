import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { LinearApiService } from './linear-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { LinearCfg } from './linear.model';

describe('LinearApiService', () => {
  let service: LinearApiService;
  let httpMock: HttpTestingController;
  let snackService: jasmine.SpyObj<SnackService>;

  const mockCfg: LinearCfg = {
    apiKey: 'test-api-key',
  } as any;

  beforeEach(() => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [LinearApiService, { provide: SnackService, useValue: snackServiceSpy }],
    });

    service = TestBed.inject(LinearApiService);
    httpMock = TestBed.inject(HttpTestingController);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should fetch issue by id', (done) => {
    const issueId = 'test-issue-id';
    const mockResponse = {
      data: {
        issue: {
          id: issueId,
          identifier: 'LIN-1',
          number: 1,
          title: 'Test Issue',
          description: 'Test Description',
          priority: 1,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          completedAt: null,
          canceledAt: null,
          dueDate: null,
          url: 'https://linear.app/issue',
          state: {
            id: 'state-id',
            name: 'In Progress',
            type: 'started',
          },
          team: {
            id: 'team-id',
            name: 'Team A',
            key: 'TEAM',
          },
          assignee: {
            id: 'user-id',
            name: 'John Doe',
            email: 'john@example.com',
            avatarUrl: 'https://example.com/avatar.jpg',
          },
          creator: {
            id: 'creator-id',
            name: 'Jane Doe',
          },
          labels: {
            nodes: [{ id: 'label-1', name: 'bug', color: '#ff0000' }],
          },
          comments: {
            nodes: [
              {
                id: 'comment-1',
                body: 'Test comment',
                createdAt: '2025-01-02T00:00:00Z',
                user: {
                  id: 'user-2',
                  name: 'Jane Smith',
                  avatarUrl: 'https://example.com/avatar2.jpg',
                },
              },
            ],
          },
          attachments: {
            nodes: [
              {
                id: 'attachment-1',
                sourceType: 'github',
                title: 'GitHub Pull Request',
                url: 'https://github.com/example/pr/123',
              },
              {
                id: 'attachment-2',
                sourceType: 'slack',
                title: 'Slack Discussion',
                url: 'https://slack.com/archives/C123456/p1234567890',
              },
            ],
          },
        },
      },
    };

    service.getById$(issueId, mockCfg).subscribe((issue) => {
      expect(issue.identifier).toBe('LIN-1');
      expect(issue.title).toBe('Test Issue');
      expect(issue.comments.length).toBe(1);
      expect(issue.attachments).toBeDefined();
      expect(issue.attachments.length).toBe(2);
      expect(issue.attachments[0].sourceType).toBe('github');
      expect(issue.attachments[1].sourceType).toBe('slack');
      done();
    });

    const req = httpMock.expectOne('https://api.linear.app/graphql');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('test-api-key');
    req.flush(mockResponse);
  });

  it('should search issues', (done) => {
    const mockResponse = {
      data: {
        viewer: {
          assignedIssues: {
            nodes: [
              {
                id: 'issue-1',
                identifier: 'LIN-1',
                number: 1,
                title: 'Test Issue 1',
                updatedAt: '2025-01-02T00:00:00Z',
                url: 'https://linear.app/issue1',
                state: {
                  id: 'state-id',
                  name: 'Backlog',
                  type: 'backlog',
                },
              },
            ],
          },
        },
      },
    };

    service.searchIssues$('Test', mockCfg).subscribe((issues) => {
      expect(issues.length).toBe(1);
      expect(issues[0].title).toBe('Test Issue 1');
      done();
    });

    const req = httpMock.expectOne('https://api.linear.app/graphql');
    expect(req.request.method).toBe('POST');
    req.flush(mockResponse);
  });

  it('should test connection', (done) => {
    const mockResponse = {
      data: {
        viewer: {
          id: 'viewer-id',
          name: 'Test User',
        },
      },
    };

    service.testConnection(mockCfg).subscribe((result) => {
      expect(result).toBe(true);
      done();
    });

    const req = httpMock.expectOne('https://api.linear.app/graphql');
    req.flush(mockResponse);
  });

  it('should handle GraphQL errors', (done) => {
    const mockResponse = {
      errors: [{ message: 'Invalid query' }],
    };

    service.getById$('test-id', mockCfg).subscribe(
      () => {
        fail('Should have thrown error');
      },
      (err) => {
        // The error is thrown and propagated
        expect(err).toBeDefined();
        done();
      },
    );

    const req = httpMock.expectOne('https://api.linear.app/graphql');
    req.flush(mockResponse);
  });

  it('should handle HTTP errors', (done) => {
    service.getById$('test-id', mockCfg).subscribe(
      () => {
        fail('Should have thrown error');
      },
      () => {
        expect(snackService.open).toHaveBeenCalled();
        done();
      },
    );

    const req = httpMock.expectOne('https://api.linear.app/graphql');
    req.error(new ErrorEvent('Network error'));
  });

  it('should filter search results by search term', (done) => {
    const mockResponse = {
      data: {
        viewer: {
          assignedIssues: {
            nodes: [
              {
                id: 'issue-1',
                identifier: 'LIN-1',
                number: 1,
                title: 'Feature: Add login',
                updatedAt: '2025-01-02T00:00:00Z',
                url: 'https://linear.app/issue1',
                state: {
                  id: 'state-id',
                  name: 'Backlog',
                  type: 'backlog',
                },
              },
              {
                id: 'issue-2',
                identifier: 'LIN-2',
                number: 2,
                title: 'Bug: Fix logout',
                updatedAt: '2025-01-02T00:00:00Z',
                url: 'https://linear.app/issue2',
                state: {
                  id: 'state-id',
                  name: 'Backlog',
                  type: 'backlog',
                },
              },
            ],
          },
        },
      },
    };

    service.searchIssues$('login', mockCfg).subscribe((issues) => {
      expect(issues.length).toBe(1);
      expect(issues[0].title).toBe('Feature: Add login');
      done();
    });

    const req = httpMock.expectOne('https://api.linear.app/graphql');
    req.flush(mockResponse);
  });
});
