import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ClickUpApiService } from './clickup-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { ClickUpCfg } from './clickup.model';
import {
  ClickUpTaskReduced,
  ClickUpTask,
  ClickUpTeamsResponse,
  ClickUpUserResponse,
  ClickUpTaskSearchResponse,
} from './clickup-issue.model';
import typia from 'typia';
import { CLICKUP_HEADER_RATE_LIMIT_RESET } from './clickup.const';

const CLICKUP_API_URL = 'https://api.clickup.com/api/v2';

describe('ClickUpApiService', () => {
  let service: ClickUpApiService;
  let httpMock: HttpTestingController;
  let snackServiceMock: Partial<SnackService>;

  const mockCfg: ClickUpCfg = {
    apiKey: 'TEST_API_KEY',
    isEnabled: true,
  };

  beforeEach(() => {
    snackServiceMock = {
      open: jasmine.createSpy('open'),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ClickUpApiService,
        { provide: SnackService, useValue: snackServiceMock },
      ],
    });

    service = TestBed.inject(ClickUpApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getById$', () => {
    it('should fetch a task by ID', () => {
      const mockTask: ClickUpTask = {
        ...typia.random<ClickUpTask>(),
        id: 'TASK_ID',
        name: 'Task Name',
      };

      service.getById$('TASK_ID', mockCfg).subscribe((task) => {
        expect(task).toEqual(mockTask);
      });

      const req = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/task/TASK_ID`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('include_markdown_description')).toBe('true');
      expect(req.request.params.get('include_subtasks')).toBe('true');
      expect(req.request.headers.get('Authorization')).toBe(mockCfg.apiKey!);
      req.flush(mockTask);
    });
  });

  describe('getAuthorizedTeams$', () => {
    it('should fetch and map authorized teams', () => {
      const mockResponse: ClickUpTeamsResponse = {
        ...typia.random<ClickUpTeamsResponse>(),
        teams: [
          {
            ...typia.random<ClickUpTeamsResponse['teams'][0]>(),
            id: '1',
            name: 'Team 1',
          },
          {
            ...typia.random<ClickUpTeamsResponse['teams'][0]>(),
            id: '2',
            name: 'Team 2',
          },
        ],
      };

      const expectedTeams = mockResponse.teams.map((team) => ({
        id: team.id,
        name: team.name,
      }));

      service.getAuthorizedTeams$(mockCfg).subscribe((teams) => {
        expect(teams).toEqual(expectedTeams);
      });

      const req = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/team`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe(mockCfg.apiKey!);
      req.flush(mockResponse);
    });
  });

  describe('getCurrentUser$', () => {
    it('should fetch current user', () => {
      const mockUserResponse: ClickUpUserResponse = {
        user: {
          ...typia.random<ClickUpUserResponse['user']>(),
          id: 123,
          username: 'Test User',
        },
      };

      service.getCurrentUser$(mockCfg).subscribe((user) => {
        expect(user).toEqual(mockUserResponse);
      });

      const req = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/user`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe(mockCfg.apiKey!);
      req.flush(mockUserResponse);
    });
  });

  describe('searchTasks$', () => {
    const mockTasksResponse: ClickUpTaskSearchResponse = {
      ...typia.random<ClickUpTaskSearchResponse>(),
      tasks: [
        {
          ...typia.random<ClickUpTask>(),
          id: '1',
          name: 'Task 1',
        },
        {
          ...typia.random<ClickUpTask>(),
          id: '2',
          name: 'Task 2',
        },
      ],
    };

    it('should search tasks in specific teams when teamIds are provided', () => {
      const cfgWithTeams: ClickUpCfg = { ...mockCfg, teamIds: ['T1', 'T2'] };
      const expectedTasks: ClickUpTaskReduced[] = mockTasksResponse.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        date_updated: task.date_updated,
        url: task.url,
        custom_id: task.custom_id,
      }));

      service.searchTasks$('Task', cfgWithTeams).subscribe((tasks) => {
        // We expect flattened results from 2 teams, each returning same mock data for this test
        expect(tasks.length).toBe(4);
        expect(tasks[0].id).toBe(expectedTasks[0].id);
        expect(tasks[0].name).toBe(expectedTasks[0].name);
        expect(tasks[0].status).toEqual(expectedTasks[0].status);
        expect(tasks[0].custom_id).toBe(expectedTasks[0].custom_id);
      });

      const req1 = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/team/T1/task`,
      );
      expect(req1.request.method).toBe('GET');
      expect(req1.request.params.get('page')).toBe('0');
      expect(req1.request.params.get('subtasks')).toBe('true');
      req1.flush(mockTasksResponse);

      const req2 = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/team/T2/task`,
      );
      expect(req2.request.method).toBe('GET');
      expect(req2.request.params.get('page')).toBe('0');
      expect(req2.request.params.get('subtasks')).toBe('true');
      req2.flush(mockTasksResponse);
    });

    it('should fetch authorized teams and then search in all of them when teamIds are NOT provided', () => {
      const cfgNoTeams: ClickUpCfg = { ...mockCfg, teamIds: [] };
      const teamResponse: ClickUpTeamsResponse = {
        ...typia.random<ClickUpTeamsResponse>(),
        teams: [
          {
            ...typia.random<ClickUpTeamsResponse['teams'][0]>(),
            id: 'T1',
            name: 'Team 1',
          },
        ],
      };

      service.searchTasks$('Task', cfgNoTeams).subscribe((tasks) => {
        expect(tasks.length).toBe(2);
      });

      // 1. Fetch teams
      const reqTeams = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/team`,
      );
      expect(reqTeams.request.method).toBe('GET');
      reqTeams.flush(teamResponse);

      // 2. Search in T1
      const reqSearch = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/team/T1/task`,
      );
      expect(reqSearch.request.method).toBe('GET');
      expect(reqSearch.request.params.get('page')).toBe('0');
      expect(reqSearch.request.params.get('subtasks')).toBe('true');
      reqSearch.flush(mockTasksResponse);
    });

    it('should return empty array if no authorized teams found', () => {
      const cfgNoTeams: ClickUpCfg = { ...mockCfg, teamIds: [] };
      const teamResponse = { teams: [] };

      service.searchTasks$('Task', cfgNoTeams).subscribe((tasks) => {
        expect(tasks).toEqual([]);
      });

      const reqTeams = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/team`,
      );
      reqTeams.flush(teamResponse);
    });

    it('should filter tasks by search term locally', () => {
      const cfgWithTeams: ClickUpCfg = { ...mockCfg, teamIds: ['T1'] };

      service.searchTasks$('Task 1', cfgWithTeams).subscribe((tasks) => {
        expect(tasks.length).toBe(1);
        expect(tasks[0].name).toBe('Task 1');
      });

      const req = httpMock.expectOne(
        (request) => request.url === `${CLICKUP_API_URL}/team/T1/task`,
      );
      expect(req.request.params.get('page')).toBe('0');
      expect(req.request.params.get('subtasks')).toBe('true');
      req.flush(mockTasksResponse);
    });

    it('should handle error in one of the team searches gracefully', () => {
      const cfgWithTeams: ClickUpCfg = { ...mockCfg, teamIds: ['T1', 'T2'] };

      service.searchTasks$('Task', cfgWithTeams).subscribe((tasks) => {
        // T1 failed, T2 succeeded with 2 tasks
        expect(tasks.length).toBe(2);
      });

      const req1 = httpMock.expectOne(
        `${CLICKUP_API_URL}/team/T1/task?page=0&subtasks=true`,
      );
      req1.flush(null, { status: 500, statusText: 'Server Error' });

      const req2 = httpMock.expectOne(
        `${CLICKUP_API_URL}/team/T2/task?page=0&subtasks=true`,
      );
      req2.flush(mockTasksResponse);
    });
    it('should retry with backoff on 429 using X-RateLimit-Reset', fakeAsync(() => {
      // Current time is X. Reset time is X + 1s.
      const resetDelay = 1000;
      const resetTime = Math.floor(Date.now() / 1000) + 1;

      let errorResponse: any;
      service.getById$('TASK_ID', mockCfg).subscribe({
        error: (err) => (errorResponse = err),
      });

      // Request 1: Fail with 429
      const req1 = httpMock.expectOne(
        `${CLICKUP_API_URL}/task/TASK_ID?include_markdown_description=true&include_subtasks=true`,
      );
      req1.flush('Rate Limit Exceeded', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { [CLICKUP_HEADER_RATE_LIMIT_RESET]: resetTime.toString() },
      });

      // Should be waiting now. No new request yet.
      httpMock.expectNone(
        `${CLICKUP_API_URL}/task/TASK_ID?include_markdown_description=true&include_subtasks=true`,
      );

      // Advance time by slightly more than resetDelay
      tick(resetDelay + 100);

      // Request 2: Should happen now. Fail again.
      const req2 = httpMock.expectOne(
        `${CLICKUP_API_URL}/task/TASK_ID?include_markdown_description=true&include_subtasks=true`,
      );
      req2.flush('Rate Limit Exceeded', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { [CLICKUP_HEADER_RATE_LIMIT_RESET]: (resetTime + 2).toString() },
      });

      tick(2100); // Wait for next retry

      // Request 3: Fail again
      const req3 = httpMock.expectOne(
        `${CLICKUP_API_URL}/task/TASK_ID?include_markdown_description=true&include_subtasks=true`,
      );
      req3.flush('Rate Limit Exceeded', {
        status: 429,
        statusText: 'Too Many Requests',
      });

      tick(5000); // Backoff wait

      // Request 4: Final attempt (since count is 3, original + 3 retries? No, standard retry(3) is 3 retries (total 4 requests) or 3 attempts?
      // RxJS retry(3) resubscribes 3 times. Total 4 attempts.

      const req4 = httpMock.expectOne(
        `${CLICKUP_API_URL}/task/TASK_ID?include_markdown_description=true&include_subtasks=true`,
      );
      req4.flush('Rate Limit Exceeded', { status: 429, statusText: 'Too Many Requests' });

      // Should error out now
      expect(errorResponse).toBeDefined();
    }));
  });
});
