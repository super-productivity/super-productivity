import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { NextcloudDeckCfg } from './nextcloud-deck.model';

describe('NextcloudDeckApiService', () => {
  let service: NextcloudDeckApiService;
  let httpMock: HttpTestingController;

  const baseUrl = 'https://cloud.example.com/index.php/apps/deck/api/v1.0';
  const mockCfg: NextcloudDeckCfg = {
    isEnabled: true,
    nextcloudBaseUrl: 'https://cloud.example.com',
    username: 'user',
    password: 'pass',
    selectedBoardId: 10,
    selectedBoardTitle: 'Board',
    importStackIds: null,
    doneStackId: 30,
    isTransitionIssuesEnabled: true,
    filterByAssignee: false,
    titleTemplate: null,
    pollIntervalMinutes: 5,
  };

  const card = {
    id: 7,
    title: 'Important Card',
    description: 'Details',
    duedate: null,
    lastModified: 1710000000,
    archived: false,
    done: false,
    order: 1,
    labels: [{ id: 1, title: 'Bug', color: 'ff0000' }],
    assignedUsers: [{ participant: { uid: 'user', displayname: 'User' } }],
  };

  beforeEach(() => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        NextcloudDeckApiService,
        {
          provide: SnackService,
          useValue: snackServiceSpy,
        },
      ],
    });

    service = TestBed.inject(NextcloudDeckApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('searchOpenCards$', () => {
    it('fetches stack details when the stacks response omits cards', (done) => {
      service.searchOpenCards$('important', mockCfg).subscribe((results) => {
        expect(results.length).toBe(1);
        expect(results[0].title).toBe('Important Card');
        expect(results[0].issueData).toEqual(
          jasmine.objectContaining({
            id: 7,
            title: 'Important Card',
            stackId: 20,
            stackTitle: 'To do',
          }),
        );
        done();
      });

      const stacksReq = httpMock.expectOne(`${baseUrl}/boards/10/stacks`);
      expect(stacksReq.request.method).toBe('GET');
      stacksReq.flush([
        {
          id: 20,
          title: 'To do',
          boardId: 10,
        },
        {
          id: 30,
          title: 'Done',
          boardId: 10,
        },
      ]);

      const stackReq = httpMock.expectOne(`${baseUrl}/boards/10/stacks/20`);
      expect(stackReq.request.method).toBe('GET');
      stackReq.flush({
        id: 20,
        title: 'To do',
        boardId: 10,
        cards: [card],
      });
    });

    it('does not refetch stacks that already contain cards', (done) => {
      service.searchOpenCards$('important', mockCfg).subscribe((results) => {
        expect(results.length).toBe(1);
        done();
      });

      const stacksReq = httpMock.expectOne(`${baseUrl}/boards/10/stacks`);
      stacksReq.flush([
        {
          id: 20,
          title: 'To do',
          boardId: 10,
          cards: [card],
        },
      ]);

      httpMock.expectNone(`${baseUrl}/boards/10/stacks/20`);
    });

    it('only fetches configured import stacks when cards are missing', (done) => {
      service
        .searchOpenCards$('important', {
          ...mockCfg,
          importStackIds: [20],
          doneStackId: null,
        })
        .subscribe((results) => {
          expect(results.length).toBe(1);
          done();
        });

      const stacksReq = httpMock.expectOne(`${baseUrl}/boards/10/stacks`);
      stacksReq.flush([
        {
          id: 20,
          title: 'To do',
          boardId: 10,
        },
        {
          id: 40,
          title: 'Later',
          boardId: 10,
        },
      ]);

      const stackReq = httpMock.expectOne(`${baseUrl}/boards/10/stacks/20`);
      stackReq.flush({
        id: 20,
        title: 'To do',
        boardId: 10,
        cards: [card],
      });
      httpMock.expectNone(`${baseUrl}/boards/10/stacks/40`);
    });
  });

  describe('getById$', () => {
    it('fetches stack details before looking up a card by id', (done) => {
      service.getById$(7, mockCfg).subscribe((issue) => {
        expect(issue).toEqual(
          jasmine.objectContaining({
            id: 7,
            title: 'Important Card',
            description: 'Details',
            stackId: 20,
            stackTitle: 'To do',
            boardId: 10,
          }),
        );
        done();
      });

      const stacksReq = httpMock.expectOne(`${baseUrl}/boards/10/stacks`);
      stacksReq.flush([
        {
          id: 20,
          title: 'To do',
          boardId: 10,
        },
      ]);

      const stackReq = httpMock.expectOne(`${baseUrl}/boards/10/stacks/20`);
      stackReq.flush({
        id: 20,
        title: 'To do',
        boardId: 10,
        cards: [card],
      });
    });
  });
});
