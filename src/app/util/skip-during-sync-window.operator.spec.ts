import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { skipDuringSyncWindow } from './skip-during-sync-window.operator';
import { HydrationStateService } from '../op-log/apply/hydration-state.service';
import { SyncTriggerService } from '../imex/sync/sync-trigger.service';

describe('skipDuringSyncWindow', () => {
  let hydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let syncTriggerService: jasmine.SpyObj<SyncTriggerService>;
  let source$: Subject<number>;

  beforeEach(() => {
    hydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'isInSyncWindow',
    ]);
    syncTriggerService = jasmine.createSpyObj('SyncTriggerService', [
      'isInitialSyncDoneSync',
    ]);

    // Default: initial sync done and not in sync window
    syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
    hydrationStateService.isInSyncWindow.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        { provide: HydrationStateService, useValue: hydrationStateService },
        { provide: SyncTriggerService, useValue: syncTriggerService },
      ],
    });

    source$ = new Subject<number>();
  });

  describe('initial sync check', () => {
    it('should skip emissions when initial sync is not done', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      hydrationStateService.isInSyncWindow.and.returnValue(false);

      TestBed.runInInjectionContext(() => {
        const results: number[] = [];
        source$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([]);
            done();
          },
        });
      });

      source$.next(1);
      source$.next(2);
      source$.next(3);
      source$.complete();
    });

    it('should pass emissions when initial sync is done and not in sync window', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      hydrationStateService.isInSyncWindow.and.returnValue(false);

      TestBed.runInInjectionContext(() => {
        const results: number[] = [];
        source$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([1, 2, 3]);
            done();
          },
        });
      });

      source$.next(1);
      source$.next(2);
      source$.next(3);
      source$.complete();
    });
  });

  describe('sync window check', () => {
    it('should skip emissions when in sync window', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      hydrationStateService.isInSyncWindow.and.returnValue(true);

      TestBed.runInInjectionContext(() => {
        const results: number[] = [];
        source$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([]);
            done();
          },
        });
      });

      source$.next(1);
      source$.next(2);
      source$.next(3);
      source$.complete();
    });

    it('should skip emissions when both initial sync not done AND in sync window', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      hydrationStateService.isInSyncWindow.and.returnValue(true);

      TestBed.runInInjectionContext(() => {
        const results: number[] = [];
        source$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([]);
            done();
          },
        });
      });

      source$.next(1);
      source$.next(2);
      source$.next(3);
      source$.complete();
    });
  });

  describe('dynamic state changes', () => {
    it('should dynamically filter based on initial sync state', (done) => {
      TestBed.runInInjectionContext(() => {
        const results: number[] = [];
        source$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([2, 3]);
            done();
          },
        });
      });

      // Initial sync not done - should skip
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      source$.next(1);

      // Initial sync done - should pass
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      source$.next(2);
      source$.next(3);

      source$.complete();
    });

    it('should dynamically filter based on sync window state', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);

      TestBed.runInInjectionContext(() => {
        const results: number[] = [];
        source$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([1, 3, 5]);
            done();
          },
        });
      });

      // Not in sync window - should pass
      hydrationStateService.isInSyncWindow.and.returnValue(false);
      source$.next(1);

      // Enter sync window - should skip
      hydrationStateService.isInSyncWindow.and.returnValue(true);
      source$.next(2);

      // Exit sync window - should pass
      hydrationStateService.isInSyncWindow.and.returnValue(false);
      source$.next(3);

      // Enter sync window again - should skip
      hydrationStateService.isInSyncWindow.and.returnValue(true);
      source$.next(4);

      // Exit sync window - should pass
      hydrationStateService.isInSyncWindow.and.returnValue(false);
      source$.next(5);

      source$.complete();
    });
  });

  describe('type preservation', () => {
    it('should work with different value types', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      hydrationStateService.isInSyncWindow.and.returnValue(false);

      TestBed.runInInjectionContext(() => {
        const stringSource$ = new Subject<string>();
        const results: string[] = [];

        stringSource$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual(['a', 'b', 'c']);
            done();
          },
        });

        stringSource$.next('a');
        stringSource$.next('b');
        stringSource$.next('c');
        stringSource$.complete();
      });
    });

    it('should work with object types', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      hydrationStateService.isInSyncWindow.and.returnValue(false);

      TestBed.runInInjectionContext(() => {
        const objectSource$ = new Subject<{ id: number }>();
        const results: { id: number }[] = [];

        objectSource$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([{ id: 1 }, { id: 2 }]);
            done();
          },
        });

        objectSource$.next({ id: 1 });
        objectSource$.next({ id: 2 });
        objectSource$.complete();
      });
    });
  });

  describe('realistic scenarios', () => {
    it('should block during initial startup until first sync completes', (done) => {
      // Simulate app startup scenario: initial sync not done, not in sync window
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      hydrationStateService.isInSyncWindow.and.returnValue(false);

      TestBed.runInInjectionContext(() => {
        const results: string[] = [];
        const events$ = new Subject<string>();

        events$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            // Only events after initial sync should pass
            expect(results).toEqual(['user-interaction-3', 'user-interaction-4']);
            done();
          },
        });

        // Effects fire during data load - should be blocked
        events$.next('effect-during-load-1');
        events$.next('effect-during-load-2');

        // Initial sync completes
        syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);

        // User interactions after sync - should pass
        events$.next('user-interaction-3');
        events$.next('user-interaction-4');

        events$.complete();
      });
    });

    it('should block during active sync operations', (done) => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);

      TestBed.runInInjectionContext(() => {
        const results: string[] = [];
        const events$ = new Subject<string>();

        events$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual(['before-sync', 'after-sync']);
            done();
          },
        });

        // Normal operation
        hydrationStateService.isInSyncWindow.and.returnValue(false);
        events$.next('before-sync');

        // Sync starts (e.g., tab focus triggers sync)
        hydrationStateService.isInSyncWindow.and.returnValue(true);
        events$.next('during-sync-1');
        events$.next('during-sync-2');

        // Sync finishes
        hydrationStateService.isInSyncWindow.and.returnValue(false);
        events$.next('after-sync');

        events$.complete();
      });
    });

    it('should handle rapid state changes correctly', (done) => {
      TestBed.runInInjectionContext(() => {
        const results: number[] = [];
        source$.pipe(skipDuringSyncWindow()).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            expect(results).toEqual([1, 4, 6]);
            done();
          },
        });

        // Allowed
        syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
        hydrationStateService.isInSyncWindow.and.returnValue(false);
        source$.next(1);

        // Blocked (initial sync flag flipped)
        syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
        source$.next(2);

        // Blocked (both flags wrong)
        hydrationStateService.isInSyncWindow.and.returnValue(true);
        source$.next(3);

        // Allowed (both flags correct)
        syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
        hydrationStateService.isInSyncWindow.and.returnValue(false);
        source$.next(4);

        // Blocked (sync window only)
        hydrationStateService.isInSyncWindow.and.returnValue(true);
        source$.next(5);

        // Allowed again
        hydrationStateService.isInSyncWindow.and.returnValue(false);
        source$.next(6);

        source$.complete();
      });
    });
  });
});
