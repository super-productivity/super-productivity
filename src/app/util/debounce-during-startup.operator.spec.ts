import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { debounceDuringStartup } from './debounce-during-startup.operator';
import { SyncTriggerService } from '../imex/sync/sync-trigger.service';

describe('debounceDuringStartup', () => {
  let syncTriggerService: jasmine.SpyObj<SyncTriggerService>;
  let source$: Subject<number>;

  beforeEach(() => {
    syncTriggerService = jasmine.createSpyObj('SyncTriggerService', [
      'isInitialSyncDoneSync',
    ]);
    syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [{ provide: SyncTriggerService, useValue: syncTriggerService }],
    });

    source$ = new Subject<number>();
  });

  describe('when initial sync is done', () => {
    beforeEach(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
    });

    it('should pass emissions immediately (0ms debounce)', fakeAsync(() => {
      let result: number | undefined;

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup()).subscribe((val) => {
          result = val;
        });
      });

      source$.next(1);
      tick(0); // Minimal tick for the of(0) debounce
      expect(result).toBe(1);

      source$.next(2);
      tick(0);
      expect(result).toBe(2);
    }));

    it('should pass through all emissions when sync is done (0ms debounce)', fakeAsync(() => {
      const results: number[] = [];

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup()).subscribe((val) => {
          results.push(val);
        });
      });

      source$.next(1);
      tick(0);
      source$.next(2);
      tick(0);
      source$.next(3);
      tick(0);

      // All values pass through immediately when sync is done
      expect(results).toEqual([1, 2, 3]);
    }));
  });

  describe('when initial sync is not done', () => {
    beforeEach(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
    });

    it('should debounce emissions by default 500ms', fakeAsync(() => {
      let result: number | undefined;

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup()).subscribe((val) => {
          result = val;
        });
      });

      source$.next(1);
      tick(100);
      expect(result).toBeUndefined();

      tick(400); // Total 500ms
      expect(result).toBe(1);
    }));

    it('should debounce emissions by custom time', fakeAsync(() => {
      let result: number | undefined;

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(200)).subscribe((val) => {
          result = val;
        });
      });

      source$.next(1);
      tick(100);
      expect(result).toBeUndefined();

      tick(100); // Total 200ms
      expect(result).toBe(1);
    }));

    it('should reset debounce timer on new emissions', fakeAsync(() => {
      let result: number | undefined;

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(200)).subscribe((val) => {
          result = val;
        });
      });

      source$.next(1);
      tick(100);
      expect(result).toBeUndefined();

      // New emission resets the timer
      source$.next(2);
      tick(100);
      expect(result).toBeUndefined();

      tick(100); // 200ms after last emission
      expect(result).toBe(2);
    }));

    it('should emit only the latest value after debounce', fakeAsync(() => {
      const results: number[] = [];

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(200)).subscribe((val) => {
          results.push(val);
        });
      });

      source$.next(1);
      tick(50);
      source$.next(2);
      tick(50);
      source$.next(3);
      tick(200);

      expect(results).toEqual([3]);
    }));
  });

  describe('state transitions', () => {
    it('should switch from debounced to immediate when sync completes', fakeAsync(() => {
      const results: number[] = [];

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(200)).subscribe((val) => {
          results.push(val);
        });
      });

      // Initial sync not done - debounce
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      source$.next(1);
      tick(200);
      expect(results).toEqual([1]);

      // Sync completes - immediate
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      source$.next(2);
      tick(0);
      expect(results).toEqual([1, 2]);
    }));
  });

  describe('type preservation', () => {
    it('should work with different value types', fakeAsync(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      const stringSource$ = new Subject<string>();
      const results: string[] = [];

      TestBed.runInInjectionContext(() => {
        stringSource$.pipe(debounceDuringStartup()).subscribe((val) => {
          results.push(val);
        });
      });

      stringSource$.next('a');
      tick(0);
      stringSource$.next('b');
      tick(0);

      expect(results).toEqual(['a', 'b']);
    }));

    it('should work with object types', fakeAsync(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      const objectSource$ = new Subject<{ id: number }>();
      const results: { id: number }[] = [];

      TestBed.runInInjectionContext(() => {
        objectSource$.pipe(debounceDuringStartup()).subscribe((val) => {
          results.push(val);
        });
      });

      objectSource$.next({ id: 1 });
      tick(0);
      objectSource$.next({ id: 2 });
      tick(0);

      expect(results).toEqual([{ id: 1 }, { id: 2 }]);
    }));
  });

  describe('edge cases', () => {
    it('should handle zero debounce time parameter', fakeAsync(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      let result: number | undefined;

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(0)).subscribe((val) => {
          result = val;
        });
      });

      source$.next(1);
      tick(0);

      expect(result).toBe(1);
    }));

    it('should handle very long debounce time', fakeAsync(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      let result: number | undefined;

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(5000)).subscribe((val) => {
          result = val;
        });
      });

      source$.next(1);
      tick(2500);
      expect(result).toBeUndefined();

      tick(2500); // Total 5000ms
      expect(result).toBe(1);
    }));

    it('should emit last value when source completes during debounce', fakeAsync(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      const results: number[] = [];
      let completed = false;

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(500)).subscribe({
          next: (val) => results.push(val),
          complete: () => {
            completed = true;
          },
        });
      });

      source$.next(1);
      tick(100);
      source$.complete();
      tick(500);

      // RxJS debounce emits the last value on source completion
      expect(results).toEqual([1]);
      expect(completed).toBe(true);
    }));
  });

  describe('realistic scenarios', () => {
    it('should debounce rapid state changes during startup', fakeAsync(() => {
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      const results: string[] = [];

      TestBed.runInInjectionContext(() => {
        const events$ = new Subject<string>();
        events$.pipe(debounceDuringStartup(200)).subscribe((val) => {
          results.push(val);
        });

        // Rapid selector emissions during data load
        events$.next('state-1');
        tick(50);
        events$.next('state-2');
        tick(50);
        events$.next('state-3');
        tick(200);

        // Only the final settled state should emit
        expect(results).toEqual(['state-3']);
      });
    }));

    it('should allow immediate emissions after sync completes', fakeAsync(() => {
      const results: string[] = [];

      TestBed.runInInjectionContext(() => {
        const events$ = new Subject<string>();
        events$.pipe(debounceDuringStartup(200)).subscribe((val) => {
          results.push(val);
        });

        // During startup - debounced
        syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
        events$.next('startup-event');
        tick(200);
        expect(results).toEqual(['startup-event']);

        // After sync - immediate
        syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
        events$.next('user-action-1');
        tick(0);
        events$.next('user-action-2');
        tick(0);

        expect(results).toEqual(['startup-event', 'user-action-1', 'user-action-2']);
      });
    }));

    it('should handle sync state toggle during debounce period', fakeAsync(() => {
      const results: number[] = [];

      TestBed.runInInjectionContext(() => {
        source$.pipe(debounceDuringStartup(300)).subscribe((val) => {
          results.push(val);
        });
      });

      // Start with sync not done - start debouncing
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(false);
      source$.next(1);
      tick(100);

      // Sync completes mid-debounce
      syncTriggerService.isInitialSyncDoneSync.and.returnValue(true);
      tick(200); // Complete the original debounce

      expect(results).toEqual([1]);

      // Now emissions should be immediate
      source$.next(2);
      tick(0);
      expect(results).toEqual([1, 2]);
    }));
  });
});
