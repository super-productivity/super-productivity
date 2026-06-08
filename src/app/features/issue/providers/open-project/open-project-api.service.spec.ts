import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SnackService } from '../../../../core/snack/snack.service';
import { DEFAULT_OPEN_PROJECT_CFG } from './open-project.const';
import { OpenProjectApiService } from './open-project-api.service';
import { OpenProjectCfg } from './open-project.model';

describe('OpenProjectApiService', () => {
  let service: OpenProjectApiService;
  let httpMock: HttpTestingController;
  const workPackagesUrl =
    'https://openproject.example.com/api/v3/projects/software/work_packages';

  const cfg: OpenProjectCfg = {
    ...DEFAULT_OPEN_PROJECT_CFG,
    host: 'https://openproject.example.com',
    projectId: 'software',
    token: 'test-token',
    scope: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        OpenProjectApiService,
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
        },
      ],
    });

    service = TestBed.inject(OpenProjectApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('searchIssueForRepo$', () => {
    it('searches explicit terms across all statuses so closed work packages can match', (done) => {
      service.searchIssueForRepo$(' 1451 ', cfg).subscribe((results) => {
        expect(results).toEqual([]);
        done();
      });

      const req = httpMock.expectOne((request) => request.url === workPackagesUrl);
      const filters = JSON.parse(req.request.params.get('filters') || '[]');

      expect(filters).toEqual([
        {
          subjectOrId: {
            operator: '**',
            values: ['1451'],
          },
        },
      ]);
      expect(req.request.params.get('pageSize')).toBe('100');
      expect(req.request.params.get('sortBy')).toBe('[["updatedAt","desc"]]');

      req.flush({ _embedded: { elements: [] } });
    });

    it('keeps empty searches limited to open work packages', (done) => {
      service.searchIssueForRepo$('', cfg).subscribe((results) => {
        expect(results).toEqual([]);
        done();
      });

      const req = httpMock.expectOne((request) => request.url === workPackagesUrl);
      const filters = JSON.parse(req.request.params.get('filters') || '[]');

      expect(filters).toEqual([
        {
          status: {
            operator: 'o',
            values: [],
          },
        },
      ]);

      req.flush({ _embedded: { elements: [] } });
    });

    it('preserves configured scope filters when searching closed work packages', (done) => {
      service
        .searchIssueForRepo$('bug', {
          ...cfg,
          scope: 'assigned-to-me',
        })
        .subscribe((results) => {
          expect(results).toEqual([]);
          done();
        });

      const req = httpMock.expectOne((request) => request.url === workPackagesUrl);
      const filters = JSON.parse(req.request.params.get('filters') || '[]');

      expect(filters).toEqual([
        {
          subjectOrId: {
            operator: '**',
            values: ['bug'],
          },
        },
        {
          assignee: {
            operator: '=',
            values: ['me'],
          },
        },
      ]);

      req.flush({ _embedded: { elements: [] } });
    });
  });
});
