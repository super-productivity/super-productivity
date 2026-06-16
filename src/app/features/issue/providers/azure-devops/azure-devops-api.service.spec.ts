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

    it('should use the configured host directly for self-hosted Azure DevOps Server URLs (#7672)', () => {
      const cfg: AzureDevOpsCfg = {
        ...mockCfg,
        host: 'https://ado.example.com/tfs/DefaultCollection',
        organization: null,
      };

      service.searchIssues$('test', cfg).subscribe();

      const req = httpMock.expectOne(
        `${cfg.host}/${cfg.project}/_apis/wit/wiql?api-version=6.0`,
      );

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

    it('should keep search result mapping at the default work item limit', () => {
      service
        .searchIssues$('test', { ...mockCfg, autoImportLimit: 120 })
        .subscribe((issues) => {
          expect(issues.length).toBe(50);
        });

      const req = httpMock.expectOne(
        `${mockCfg.host}/${mockCfg.project}/_apis/wit/wiql?api-version=6.0`,
      );
      req.flush({
        workItems: Array.from({ length: 75 }, (_, i) => ({ id: i + 1 })),
      });

      const detailsReq = httpMock.expectOne((r) =>
        r.url.includes(`${mockCfg.host}/${mockCfg.project}/_apis/wit/workitems`),
      );
      expect(getRequestedIds(detailsReq.request.urlWithParams).length).toBe(50);
      detailsReq.flush({
        value: Array.from({ length: 50 }, (_, i) => makeWorkItem(i + 1)),
      });
    });
  });

  describe('getNewIssuesToAddToBacklog$', () => {
    it('should default auto import mapping to 50 work items', () => {
      service.getNewIssuesToAddToBacklog$(mockCfg).subscribe((issues) => {
        expect(issues.length).toBe(50);
      });

      const req = httpMock.expectOne(
        `${mockCfg.host}/${mockCfg.project}/_apis/wit/wiql?api-version=6.0`,
      );
      req.flush({
        workItems: Array.from({ length: 75 }, (_, i) => ({ id: i + 1 })),
      });

      const detailsReq = httpMock.expectOne((r) =>
        r.url.includes(`${mockCfg.host}/${mockCfg.project}/_apis/wit/workitems`),
      );
      expect(getRequestedIds(detailsReq.request.urlWithParams).length).toBe(50);
      detailsReq.flush({
        value: Array.from({ length: 50 }, (_, i) => makeWorkItem(i + 1)),
      });
    });

    it('should respect a custom auto import limit', () => {
      service
        .getNewIssuesToAddToBacklog$({ ...mockCfg, autoImportLimit: 120 })
        .subscribe((issues) => {
          expect(issues.length).toBe(120);
        });

      const req = httpMock.expectOne(
        `${mockCfg.host}/${mockCfg.project}/_apis/wit/wiql?api-version=6.0`,
      );
      req.flush({
        workItems: Array.from({ length: 150 }, (_, i) => ({ id: i + 1 })),
      });

      const detailsReq = httpMock.expectOne((r) =>
        r.url.includes(`${mockCfg.host}/${mockCfg.project}/_apis/wit/workitems`),
      );
      expect(getRequestedIds(detailsReq.request.urlWithParams).length).toBe(120);
      detailsReq.flush({
        value: Array.from({ length: 120 }, (_, i) => makeWorkItem(i + 1)),
      });
    });

    it('should cap the custom auto import limit to the Azure DevOps API maximum', () => {
      service
        .getNewIssuesToAddToBacklog$({ ...mockCfg, autoImportLimit: 500 })
        .subscribe((issues) => {
          expect(issues.length).toBe(200);
        });

      const req = httpMock.expectOne(
        `${mockCfg.host}/${mockCfg.project}/_apis/wit/wiql?api-version=6.0`,
      );
      req.flush({
        workItems: Array.from({ length: 250 }, (_, i) => ({ id: i + 1 })),
      });

      const detailsReq = httpMock.expectOne((r) =>
        r.url.includes(`${mockCfg.host}/${mockCfg.project}/_apis/wit/workitems`),
      );
      expect(getRequestedIds(detailsReq.request.urlWithParams).length).toBe(200);
      detailsReq.flush({
        value: Array.from({ length: 200 }, (_, i) => makeWorkItem(i + 1)),
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

    it('should not require organization when host already contains the collection path (#7672)', () => {
      const cfg: AzureDevOpsCfg = {
        ...mockCfg,
        host: 'https://ado.example.com/tfs/DefaultCollection',
        organization: null,
      };

      service.getCurrentUser$(cfg).subscribe();

      const req = httpMock.expectOne(
        `${cfg.host}/_apis/connectionData?api-version=5.1-preview`,
      );
      expect(req.request.method).toBe('GET');

      req.flush({ authenticatedUser: { providerDisplayName: 'Test User' } });
    });
  });
});

const makeWorkItem = (id: number): unknown => ({
  id,
  fields: {
    /* eslint-disable @typescript-eslint/naming-convention */
    'System.Title': `Test Issue ${id}`,
    'System.WorkItemType': 'Bug',
    'System.State': 'To Do',
    /* eslint-enable @typescript-eslint/naming-convention */
  },
});

const getRequestedIds = (urlWithParams: string): string[] => {
  return new URL(urlWithParams).searchParams.get('ids')?.split(',') || [];
};
