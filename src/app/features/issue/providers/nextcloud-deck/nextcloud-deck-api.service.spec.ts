import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { NextcloudDeckCfg } from './nextcloud-deck.model';

describe('NextcloudDeckApiService', () => {
  let service: NextcloudDeckApiService;
  let httpMock: HttpTestingController;

  const mockCfg: NextcloudDeckCfg = {
    isEnabled: true,
    nextcloudBaseUrl: 'https://nc.example.com',
    username: 'user',
    password: 'pass',
    selectedBoardId: 1,
    selectedBoardTitle: 'Board',
    importStackIds: null,
    doneStackId: null,
    isTransitionIssuesEnabled: false,
    filterByAssignee: false,
    titleTemplate: null,
    pollIntervalMinutes: 5,
  };

  const stacksUrl = 'https://nc.example.com/index.php/apps/deck/api/v1.0/boards/1/stacks';

  // A raw card as returned by the Deck REST API. `done` is a completion
  // timestamp (or null) — NOT a boolean (see issue #8436).
  const rawCard = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 42,
    title: 'A card',
    description: '',
    duedate: null,
    lastModified: 123,
    archived: false,
    done: null,
    order: 0,
    labels: [],
    assignedUsers: [],
    ...overrides,
  });

  beforeEach(() => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        NextcloudDeckApiService,
        { provide: SnackService, useValue: snackServiceSpy },
      ],
    });

    service = TestBed.inject(NextcloudDeckApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('done normalization (issue #8436)', () => {
    it('getOpenCards$ maps a not-done card (done: null) to boolean false', (done) => {
      service.getOpenCards$(mockCfg).subscribe((cards) => {
        expect(cards.length).toBe(1);
        expect(cards[0].done).toBe(false);
        expect(typeof cards[0].done).toBe('boolean');
        done();
      });

      httpMock
        .expectOne(stacksUrl)
        .flush([{ id: 1, title: 'Stack', boardId: 1, cards: [rawCard()] }]);
    });

    it('getById$ maps done: null to boolean false', (done) => {
      service.getById$(42, mockCfg).subscribe((issue) => {
        expect(issue).not.toBeNull();
        expect(issue!.done).toBe(false);
        expect(typeof issue!.done).toBe('boolean');
        done();
      });

      httpMock
        .expectOne(stacksUrl)
        .flush([{ id: 1, title: 'Stack', boardId: 1, cards: [rawCard()] }]);
    });

    it('getById$ maps a completion timestamp to boolean true', (done) => {
      service.getById$(42, mockCfg).subscribe((issue) => {
        expect(issue).not.toBeNull();
        expect(issue!.done).toBe(true);
        expect(typeof issue!.done).toBe('boolean');
        done();
      });

      httpMock.expectOne(stacksUrl).flush([
        {
          id: 1,
          title: 'Stack',
          boardId: 1,
          cards: [rawCard({ done: '2024-01-01T00:00:00+00:00' })],
        },
      ]);
    });
  });
});
