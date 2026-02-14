import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { AzureDevOpsApiService } from './azure-devops-api.service';
import { AzureDevOpsCfg } from './azure-devops.model';

describe('AzureDevOpsApiService', () => {
  let service: AzureDevOpsApiService;
  let httpMock: HttpTestingController;

  const mockCfg: AzureDevOpsCfg = {
    isEnabled: true,
    host: 'https://dev.azure.com/testorg',
    organization: 'testorg',
    project: 'testproject',
    token: 'testtoken',
    scope: 'all',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AzureDevOpsApiService],
    });
    service = TestBed.inject(AzureDevOpsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('searchIssues$', () => {
    it('should sanitize search term and send correct POST request', () => {
      const searchTerm = "It's broken";

      service.searchIssues$(searchTerm, mockCfg).subscribe();

      const req = httpMock.expectOne(
        `${mockCfg.host}/${mockCfg.project}/_apis/wit/wiql?api-version=6.0`,
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body.query).toContain("It''s broken"); // Check for escaped quote

      req.flush({ workItems: [] });
    });

    it('should ignore scope for numeric search', () => {
      const numericSearch = '12345';
      service.searchIssues$(numericSearch, mockCfg).subscribe();

      const req = httpMock.expectOne(
        `${mockCfg.host}/${mockCfg.project}/_apis/wit/wiql?api-version=6.0`,
      );
      expect(req.request.body.query).toContain(`[System.Id] = 12345`);

      req.flush({ workItems: [] });
    });

    it('should map search results correctly including ticket type', () => {
      const searchTerm = 'test';
      service.searchIssues$(searchTerm, mockCfg).subscribe((issues) => {
        expect(issues.length).toBe(1);
        expect(issues[0].summary).toBe('Bug 1: Test Issue');
      });

      const req = httpMock.expectOne(
        `${mockCfg.host}/${mockCfg.project}/_apis/wit/wiql?api-version=6.0`,
      );
      req.flush({
        workItems: [{ id: 1 }],
      });

      const detailsReq = httpMock.expectOne((r) =>
        r.url.includes(`${mockCfg.host}/${mockCfg.project}/_apis/wit/workitems`),
      );
      detailsReq.flush({
        value: [
          {
            id: 1,
            /* eslint-disable @typescript-eslint/naming-convention */
            fields: {
              'System.Title': 'Test Issue',
              'System.WorkItemType': 'Bug',
              'System.State': 'To Do',
            },
            /* eslint-enable @typescript-eslint/naming-convention */
          },
        ],
      });
    });
  });

  describe('getCurrentUser$', () => {
    it('should get current user from connectionData', () => {
      service.getCurrentUser$(mockCfg).subscribe();

      const req = httpMock.expectOne(
        `${mockCfg.host}/_apis/connectionData?api-version=5.1-preview`,
      );
      expect(req.request.method).toBe('GET');

      req.flush({ authenticatedUser: { providerDisplayName: 'Test User' } });
    });
  });
});
