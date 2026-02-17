import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TrelloApiService } from './trello-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { TrelloCfg } from './trello.model';

describe('TrelloApiService', () => {
  let service: TrelloApiService;
  let httpMock: HttpTestingController;
  let snackService: jasmine.SpyObj<SnackService>;

  const mockCfg: TrelloCfg = {
    isEnabled: true,
    apiKey: 'test-api-key',
    token: 'test-token',
    boardId: '5f1a1a1a1a1a1a1a1a1a1a1a',
  };

  beforeEach(() => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        TrelloApiService,
        {
          provide: SnackService,
          useValue: snackServiceSpy,
        },
      ],
    });

    service = TestBed.inject(TrelloApiService);
    httpMock = TestBed.inject(HttpTestingController);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('testConnection$', () => {
    it('should make request to boards endpoint with credentials', (done) => {
      service.testConnection$(mockCfg).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      expect(req.request.urlWithParams).toContain(`key=${mockCfg.apiKey}`);
      expect(req.request.urlWithParams).toContain(`token=${mockCfg.token}`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: mockCfg.boardId });
    });

    it('should return true on successful connection', (done) => {
      service.testConnection$(mockCfg).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      req.flush({ id: mockCfg.boardId });
    });
  });

  describe('issuePicker$', () => {
    it('should fetch board cards when search term is empty', (done) => {
      service.issuePicker$('', mockCfg).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should search when search term is provided', (done) => {
      service.issuePicker$('test search', mockCfg).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/search'));
      expect(req.request.urlWithParams).toContain('query=test');
      req.flush({ cards: [] });
    });

    it('should limit search results correctly', (done) => {
      service.issuePicker$('test', mockCfg, 10).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/search'));
      expect(req.request.urlWithParams).toContain('cards_limit=10');
      req.flush({ cards: [] });
    });

    it('should cap cards_limit to 100 maximum', (done) => {
      service.issuePicker$('test', mockCfg, 200).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/search'));
      expect(req.request.urlWithParams).toContain('cards_limit=100');
      req.flush({ cards: [] });
    });
  });

  describe('configuration validation', () => {
    it('should throw error when apiKey is missing', () => {
      const invalidCfg = { ...mockCfg, apiKey: null };

      expect(() => {
        service.testConnection$(invalidCfg).subscribe();
      }).toThrowError('Trello: Not enough settings');

      expect(snackService.open).toHaveBeenCalled();
    });

    it('should throw error when token is missing', () => {
      const invalidCfg = { ...mockCfg, token: null };

      expect(() => {
        service.testConnection$(invalidCfg).subscribe();
      }).toThrowError('Trello: Not enough settings');

      expect(snackService.open).toHaveBeenCalled();
    });

    it('should throw error when boardId is missing', () => {
      const invalidCfg = { ...mockCfg, boardId: null };

      expect(() => {
        service.testConnection$(invalidCfg).subscribe();
      }).toThrowError('Trello: Not enough settings');

      expect(snackService.open).toHaveBeenCalled();
    });

    it('should accept valid board IDs', (done) => {
      const validCfg = { ...mockCfg, boardId: 'abc123DEF456abc123DEF456' };

      service.testConnection$(validCfg).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      req.flush({ id: validCfg.boardId });
    });
  });

  describe('error handling', () => {
    it('should handle invalid object id error from API', (done) => {
      let errorOccurred = false;
      service.testConnection$(mockCfg).subscribe(
        () => {},
        () => {
          errorOccurred = true;
          done();
        },
      );

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      req.flush(
        { error: 'Invalid objectId' },
        { status: 400, statusText: 'Bad Request' },
      );
      expect(errorOccurred).toBe(true);
    });

    it('should handle network errors', (done) => {
      let errorOccurred = false;
      service.testConnection$(mockCfg).subscribe(
        () => {},
        () => {
          errorOccurred = true;
          done();
        },
      );

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      req.error(new ErrorEvent('Network error'));
      expect(errorOccurred).toBe(true);
    });

    it('should handle generic API errors', (done) => {
      let errorOccurred = false;
      service.testConnection$(mockCfg).subscribe(
        () => {},
        () => {
          errorOccurred = true;
          done();
        },
      );

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      req.flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
      expect(errorOccurred).toBe(true);
    });
  });

  describe('HTTP parameters', () => {
    it('should include api key in query parameters', (done) => {
      service.testConnection$(mockCfg).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/boards/'));
      expect(req.request.urlWithParams).toContain('key=test-api-key');
      req.flush({ id: mockCfg.boardId });
    });

    it('should properly encode search terms', (done) => {
      service.issuePicker$('test & special', mockCfg).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/search'));
      expect(req.request.urlWithParams).toContain('query=test');
      expect(req.request.urlWithParams).toContain('%26');
      req.flush({ cards: [] });
    });
  });
});
