import { signal, WritableSignal } from '@angular/core';
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

  /**
   * Lets the revision-triggered live refresh settle. The service coalesces
   * mutation bursts with a 100ms `auditTime` window, so this waits past it
   * (plus the async journal read).
   */
  const flushAsync = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 160));

  /**
   * Polls until `predicate` holds instead of sleeping a fixed window. The live
   * refresh runs on a real 100ms `auditTime` timer plus an async journal read;
   * a fixed sleep leaves only a few ms of slack and flakes on the slow/contended
   * macOS CI runner (the trailing refresh hasn't fired yet when the assertion
   * runs). Polling waits for the actual outcome, so it is robust regardless of
   * runner speed.
   */
  const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > timeoutMs) {
        throw new Error('waitFor: timed out waiting for condition');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  beforeEach(() => {
    bannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss', 'isShown']);
    bannerService.isShown.and.returnValue(false);
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

  it('refreshes the OPEN banner counts when entries are reviewed in-page (SPAP-35)', async () => {
    const a = makeEntry({ winner: 'remote' });
    const b = makeEntry({ winner: 'local' });
    await journal.record(a);
    await journal.record(b);
    await service.maybeShowSummaryBanner();
    expect(bannerService.open.calls.mostRecent().args[0].translateParams).toEqual({
      count: 2,
      remoteWins: 1,
      localWins: 1,
    });

    bannerService.isShown.and.returnValue(true); // banner still on screen
    await journal.markKept(a.id);
    await waitFor(() => bannerService.open.calls.count() >= 2);

    expect(bannerService.open.calls.mostRecent().args[0].translateParams).toEqual({
      count: 1,
      remoteWins: 0,
      localWins: 1,
    });
  });

  it('dismisses the OPEN banner when the last entry is reviewed in-page (SPAP-35)', async () => {
    const a = makeEntry({ winner: 'remote' });
    await journal.record(a);
    await service.maybeShowSummaryBanner();
    expect(bannerService.open).toHaveBeenCalledTimes(1);

    bannerService.isShown.and.returnValue(true);
    await journal.markKept(a.id);
    await waitFor(() => bannerService.dismiss.calls.count() >= 1);

    expect(bannerService.dismiss).toHaveBeenCalledWith(
      BannerId.SyncConflictsAutoResolved,
    );
  });

  it('does NOT resurrect a banner the user dismissed when the count changes (SPAP-35)', async () => {
    const a = makeEntry({ winner: 'remote' });
    const b = makeEntry({ winner: 'local' });
    await journal.record(a);
    await journal.record(b);
    await service.maybeShowSummaryBanner();
    expect(bannerService.open).toHaveBeenCalledTimes(1);

    bannerService.isShown.and.returnValue(false); // user hit DISMISS
    await journal.markKept(a.id);
    await flushAsync();

    expect(bannerService.open).toHaveBeenCalledTimes(1); // no re-open
  });

  // --- Concurrency guards (SPAP-35 review hardening) ---
  // The refresh does an async journal read between "is the banner shown?" and
  // open()/dismiss(). These cover the three ways that gap can misbehave.

  it('does NOT resurrect the banner when the user dismisses while a refresh read is in flight (SPAP-35)', async () => {
    const a = makeEntry({ winner: 'remote' });
    const b = makeEntry({ winner: 'local' });
    await journal.record(a);
    await journal.record(b);
    await service.maybeShowSummaryBanner();
    expect(bannerService.open).toHaveBeenCalledTimes(1);

    bannerService.isShown.and.returnValue(true); // banner on screen when review starts
    // Hold the refresh's journal read open so a dismiss can land mid-await.
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    const realList = journal.list.bind(journal);
    spyOn(journal, 'list').and.callFake((view) => readGate.then(() => realList(view)));

    await journal.markKept(a.id); // count 2 -> 1: refresh starts, read now pending
    await flushAsync();
    bannerService.isShown.and.returnValue(false); // user clicks the banner's DISMISS (X)
    releaseRead();
    await flushAsync();
    await flushAsync();

    // One entry still unreviewed (count 1 > 0), but the banner was dismissed:
    // the post-await isShown() re-check must stop it re-opening.
    expect(bannerService.open).toHaveBeenCalledTimes(1);
  });

  it('drops a stale in-flight refresh when a newer count change supersedes it (SPAP-35)', async () => {
    const a = makeEntry({ winner: 'remote' });
    const b = makeEntry({ winner: 'local' });
    const c = makeEntry({ winner: 'remote' });
    await journal.record(a);
    await journal.record(b);
    await journal.record(c);
    await service.maybeShowSummaryBanner();
    bannerService.isShown.and.returnValue(true);

    // Two refreshes fire; force the OLDER read to resolve LAST with a stale set.
    let resolveOld!: (v: ConflictJournalEntry[]) => void;
    let resolveNew!: (v: ConflictJournalEntry[]) => void;
    const oldRead = new Promise<ConflictJournalEntry[]>((r) => (resolveOld = r));
    const newRead = new Promise<ConflictJournalEntry[]>((r) => (resolveNew = r));
    spyOn(journal, 'list').and.returnValues(oldRead, newRead);

    await journal.markKept(a.id); // count 3 -> 2: refresh #0 (awaits oldRead)
    await flushAsync();
    await journal.markKept(b.id); // count 2 -> 1: refresh #1 (awaits newRead)
    await flushAsync();

    resolveNew([c]); // newer refresh completes first -> renders count 1
    await flushAsync();
    resolveOld([a, b, c]); // stale older refresh resolves last with count 3
    await flushAsync();
    await flushAsync();

    // The sequence guard must drop the stale refresh: last render stays at count 1.
    expect(bannerService.open.calls.mostRecent().args[0].translateParams).toEqual({
      count: 1,
      remoteWins: 1,
      localWins: 0,
    });
  });

  it('does NOT dismiss the banner on a phantom zero from a failed journal read (SPAP-35)', async () => {
    const a = makeEntry({ winner: 'remote' });
    const b = makeEntry({ winner: 'local' });
    await journal.record(a);
    await journal.record(b);
    await service.maybeShowSummaryBanner();
    expect(bannerService.open).toHaveBeenCalledTimes(1);

    bannerService.isShown.and.returnValue(true);
    bannerService.dismiss.calls.reset();
    // list() degrades to [] on a transient DB error — a real entry still remains.
    spyOn(journal, 'list').and.resolveTo([]);

    await journal.markKept(a.id); // count 2 -> 1 emitted; read (falsely) sees []
    await flushAsync();
    await flushAsync();

    // count stream says 1 (> 0) but the read is empty: don't dismiss a valid banner.
    expect(bannerService.dismiss).not.toHaveBeenCalled();
  });

  it('coalesces a burst of reviews into a bounded number of journal scans (#8946)', async () => {
    const entries = Array.from({ length: 12 }, () => makeEntry({ winner: 'remote' }));
    for (const e of entries) {
      await journal.record(e);
    }
    await service.maybeShowSummaryBanner();

    bannerService.isShown.and.returnValue(true);
    // Spy AFTER the open so only refresh-driven reads are counted.
    const listSpy = spyOn(journal, 'list').and.callThrough();

    // Bulk "Keep All": a burst of mutations. Each bumps the journal revision.
    for (const e of entries) {
      await journal.markKept(e.id);
    }
    await flushAsync();

    // Coalesced: the whole burst collapses to a single trailing refresh (one
    // scan), not one full journal scan per entry.
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SyncConflictBannerService — mutation-aware trigger (#8946)', () => {
  let bannerService: jasmine.SpyObj<BannerService>;
  let revision: WritableSignal<number>;
  let unreviewedCount: WritableSignal<number>;
  let listSpy: jasmine.Spy;

  // The live refresh coalesces bursts with a 100ms auditTime window.
  const flushAsync = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 160));

  beforeEach(() => {
    bannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss', 'isShown']);
    bannerService.isShown.and.returnValue(false);
    revision = signal(0);
    unreviewedCount = signal(0);
    listSpy = jasmine.createSpy('list').and.resolveTo([]);

    // Mock journal: revision and unreviewedCount are controlled independently so
    // the count-race is reproducible deterministically (both count queries run
    // after both writes -> the count is unchanged while the content changed).
    const mockJournal = {
      revision: revision.asReadonly(),
      unreviewedCount: unreviewedCount.asReadonly(),
      list: listSpy,
    } as unknown as ConflictJournalService;

    TestBed.configureTestingModule({
      providers: [
        SyncConflictBannerService,
        { provide: ConflictJournalService, useValue: mockJournal },
        { provide: BannerService, useValue: bannerService },
        {
          provide: Router,
          useValue: jasmine.createSpyObj('Router', ['navigate']),
        },
      ],
    });
  });

  it('refreshes the breakdown on an equal-total composition change (count stays 1, remote -> local)', async () => {
    const service = TestBed.inject(SyncConflictBannerService);
    // Let the initial revision emission flush so skip(1) consumes it here (not a
    // later, meaningful change).
    await flushAsync();

    // Open with a single remote-win.
    listSpy.and.resolveTo([makeEntry({ winner: 'remote' })]);
    unreviewedCount.set(1);
    await service.maybeShowSummaryBanner();
    expect(bannerService.open.calls.mostRecent().args[0].translateParams).toEqual({
      count: 1,
      remoteWins: 1,
      localWins: 0,
    });

    bannerService.isShown.and.returnValue(true);
    // Drain any count-driven refresh (a count-keyed trigger would have fired one
    // when the count went 0 -> 1 above) while the content is still the remote-win,
    // so the change below is revision-only and the two triggers are distinguished.
    await flushAsync();
    await flushAsync();

    // The race: one remote-win reviewed AND one local-win recorded, with both
    // count queries observing the post-both-writes state -> unreviewedCount stays
    // 1 (UNCHANGED) while the content flipped to one local-win. A trigger keyed on
    // the count suppresses this refresh; keyed on the revision it must fire.
    listSpy.and.resolveTo([makeEntry({ winner: 'local' })]);
    revision.set(1); // NOTE: unreviewedCount deliberately left at 1
    await flushAsync();
    await flushAsync();

    expect(bannerService.open.calls.mostRecent().args[0].translateParams).toEqual({
      count: 1,
      remoteWins: 0,
      localWins: 1,
    });
  });
});
