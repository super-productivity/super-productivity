import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { skipWhileApplyingRemoteOps, skipDuringSync } from './skip-during-sync.operator';
import { HydrationStateService } from '../op-log/apply/hydration-state.service';

describe('skipWhileApplyingRemoteOps', () => {
  let hydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let source$: Subject<number>;

  beforeEach(() => {
    hydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
    ]);
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [{ provide: HydrationStateService, useValue: hydrationStateService }],
    });

    source$ = new Subject<number>();
  });

  it('should pass emissions when not applying remote ops', (done) => {
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);

    TestBed.runInInjectionContext(() => {
      const results: number[] = [];
      source$.pipe(skipWhileApplyingRemoteOps()).subscribe({
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

  it('should skip emissions when applying remote ops', (done) => {
    hydrationStateService.isApplyingRemoteOps.and.returnValue(true);

    TestBed.runInInjectionContext(() => {
      const results: number[] = [];
      source$.pipe(skipWhileApplyingRemoteOps()).subscribe({
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

  it('should dynamically filter based on current state', (done) => {
    TestBed.runInInjectionContext(() => {
      const results: number[] = [];
      source$.pipe(skipWhileApplyingRemoteOps()).subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([1, 3, 5]);
          done();
        },
      });
    });

    // Not syncing - should pass
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);
    source$.next(1);

    // Start syncing - should skip
    hydrationStateService.isApplyingRemoteOps.and.returnValue(true);
    source$.next(2);

    // Still syncing - should skip
    source$.next(2.5);

    // Stop syncing - should pass
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);
    source$.next(3);

    // Start syncing again - should skip
    hydrationStateService.isApplyingRemoteOps.and.returnValue(true);
    source$.next(4);

    // Stop syncing - should pass
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);
    source$.next(5);

    source$.complete();
  });

  it('should work with different value types', (done) => {
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);

    TestBed.runInInjectionContext(() => {
      const stringSource$ = new Subject<string>();
      const results: string[] = [];

      stringSource$.pipe(skipWhileApplyingRemoteOps()).subscribe({
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
});

describe('skipDuringSync (deprecated alias)', () => {
  let hydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let source$: Subject<number>;

  beforeEach(() => {
    hydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
    ]);
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [{ provide: HydrationStateService, useValue: hydrationStateService }],
    });

    source$ = new Subject<number>();
  });

  it('should work identically to skipWhileApplyingRemoteOps', (done) => {
    hydrationStateService.isApplyingRemoteOps.and.returnValue(false);

    TestBed.runInInjectionContext(() => {
      const results: number[] = [];
      source$.pipe(skipDuringSync()).subscribe({
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

  it('should skip emissions when applying remote ops', (done) => {
    hydrationStateService.isApplyingRemoteOps.and.returnValue(true);

    TestBed.runInInjectionContext(() => {
      const results: number[] = [];
      source$.pipe(skipDuringSync()).subscribe({
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
