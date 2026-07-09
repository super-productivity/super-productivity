import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  SyncConflictBannerService,
  SYNC_CONFLICTS_ROUTE,
} from './sync-conflict-banner.service';
import { ConflictJournalService } from './conflict-journal.service';
import { ConflictJournalEntry } from './conflict-journal.model';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { EntityType } from '../core/operation.types';
import { T } from '../../t.const';

const makeEntry = (over: Partial<ConflictJournalEntry> = {}): ConflictJournalEntry => ({
  id: Math.random().toString(36).slice(2),
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  entityTitle: 'Test Task',
  resolvedAt: Date.now(),
  winner: 'remote',
  reason: 'newer',
  fieldDiffs: [],
  localClientId: 'A',
  remoteClientId: 'B',
  localTs: 1000,
  remoteTs: 2000,
  status: 'unreviewed',
  ...over,
});

describe('SyncConflictBannerService', () => {
  let service: SyncConflictBannerService;
  let journal: ConflictJournalService;
  let bannerService: jasmine.SpyObj<BannerService>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    bannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);
    router = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        SyncConflictBannerService,
        ConflictJournalService,
        { provide: BannerService, useValue: bannerService },
        { provide: Router, useValue: router },
      ],
    });

    service = TestBed.inject(SyncConflictBannerService);
    journal = TestBed.inject(ConflictJournalService);
  });

  it('opens the banner with correct win counts when there are unreviewed conflicts', async () => {
    await journal.record(makeEntry({ winner: 'remote' }));
    await journal.record(makeEntry({ winner: 'remote' }));
    await journal.record(makeEntry({ winner: 'local' }));

    await service.maybeShowSummaryBanner();

    expect(bannerService.open).toHaveBeenCalledTimes(1);
    const banner = bannerService.open.calls.mostRecent().args[0];
    expect(banner.id).toBe(BannerId.SyncConflictsAutoResolved);
    expect(banner.msg).toBe(T.F.SYNC.CONFLICT_REVIEW.BANNER_MSG);
    expect(banner.translateParams).toEqual({ count: 3, remoteWins: 2, localWins: 1 });
    expect(banner.action?.label).toBe(T.F.SYNC.CONFLICT_REVIEW.BANNER_REVIEW);
  });

  it('does NOT open the banner when there are no unreviewed conflicts', async () => {
    // Only reviewed/info entries — nothing to surface.
    await journal.record(makeEntry({ status: 'kept' }));
    await journal.record(makeEntry({ status: 'info', winner: 'merged' }));

    await service.maybeShowSummaryBanner();

    expect(bannerService.open).not.toHaveBeenCalled();
    expect(bannerService.dismiss).toHaveBeenCalledWith(
      BannerId.SyncConflictsAutoResolved,
    );
  });

  it('REVIEW action navigates to the conflicts page', async () => {
    await journal.record(makeEntry());
    await service.maybeShowSummaryBanner();

    const banner = bannerService.open.calls.mostRecent().args[0];
    banner.action?.fn();

    expect(router.navigate).toHaveBeenCalledWith([SYNC_CONFLICTS_ROUTE]);
  });
});
