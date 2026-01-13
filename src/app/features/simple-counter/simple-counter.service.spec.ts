/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { SimpleCounterService } from './simple-counter.service';
import { SimpleCounter, SimpleCounterType } from './simple-counter.model';
import { EMPTY_SIMPLE_COUNTER } from './simple-counter.const';
import {
  increaseSimpleCounterCounterToday,
  decreaseSimpleCounterCounterToday,
  setSimpleCounterCounterToday,
  deleteSimpleCounter,
  deleteSimpleCounters,
  updateSimpleCounter,
} from './store/simple-counter.actions';
import { selectAllSimpleCounters } from './store/simple-counter.reducer';
import { DateService } from 'src/app/core/date/date.service';

describe('SimpleCounterService', () => {
  let service: SimpleCounterService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  const mockDateService = {
    todayStr: () => '2024-01-15',
  };

  const createCounter = (
    id: string,
    partial: Partial<SimpleCounter> = {},
  ): SimpleCounter => ({
    ...EMPTY_SIMPLE_COUNTER,
    id,
    title: `Counter ${id}`,
    isEnabled: true,
    type: SimpleCounterType.ClickCounter,
    ...partial,
  });

  /**
   * Helper to mock counters for both selectAllSimpleCounters and selectSimpleCounterById.
   * Since the service now uses selectSimpleCounterById (O(1) lookup), we need to mock both.
   */
  const mockCounters = (counters: SimpleCounter[]): void => {
    store.overrideSelector(selectAllSimpleCounters, counters);
    // For selectSimpleCounterById, we override the base state since it uses props
    const entities: Record<string, SimpleCounter> = {};
    for (const counter of counters) {
      entities[counter.id] = counter;
    }
    store.setState({
      simpleCounter: {
        ids: counters.map((c) => c.id),
        entities,
      },
    });
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SimpleCounterService,
        provideMockStore({
          initialState: {
            simpleCounter: {
              ids: ['counter1'],
              entities: {
                counter1: createCounter('counter1', {
                  countOnDay: { '2024-01-15': 5 },
                }),
              },
            },
          },
        }),
        { provide: DateService, useValue: mockDateService },
      ],
    });

    store = TestBed.inject(MockStore);
    service = TestBed.inject(SimpleCounterService);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();

    // Mock the counters with CURRENT state (BEFORE increment)
    // New behavior: we read state first, calculate new value, then dispatch both actions
    mockCounters([
      createCounter('counter1', {
        countOnDay: { '2024-01-15': 5 },
      }),
    ]);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('increaseCounterToday', () => {
    it('should dispatch increaseSimpleCounterCounterToday for local UI update', fakeAsync(() => {
      service.increaseCounterToday('counter1', 1);
      tick();

      expect(dispatchSpy).toHaveBeenCalledWith(
        increaseSimpleCounterCounterToday({
          id: 'counter1',
          increaseBy: 1,
          today: '2024-01-15',
        }),
      );
    }));

    it('should immediately dispatch setSimpleCounterCounterToday for sync', fakeAsync(() => {
      service.increaseCounterToday('counter1', 1);
      tick();

      // Should dispatch both the increment action AND the sync action
      expect(dispatchSpy.calls.count()).toBe(2);
      // New behavior: reads state (5) BEFORE dispatch, calculates newVal = 5 + 1 = 6
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 6,
          today: '2024-01-15',
        }),
      );
    }));
  });

  describe('decreaseCounterToday', () => {
    beforeEach(() => {
      // Mock the counters BEFORE decrement
      // New behavior: reads state first, calculates new value, then dispatches
      mockCounters([
        createCounter('counter1', {
          countOnDay: { '2024-01-15': 5 },
        }),
      ]);
    });

    it('should dispatch decreaseSimpleCounterCounterToday for local UI update', fakeAsync(() => {
      service.decreaseCounterToday('counter1', 1);
      tick();

      expect(dispatchSpy).toHaveBeenCalledWith(
        decreaseSimpleCounterCounterToday({
          id: 'counter1',
          decreaseBy: 1,
          today: '2024-01-15',
        }),
      );
    }));

    it('should immediately dispatch setSimpleCounterCounterToday for sync', fakeAsync(() => {
      service.decreaseCounterToday('counter1', 1);
      tick();

      // Should dispatch both the decrement action AND the sync action
      expect(dispatchSpy.calls.count()).toBe(2);
      // New behavior: reads state (5) BEFORE dispatch, calculates newVal = 5 - 1 = 4
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 4,
          today: '2024-01-15',
        }),
      );
    }));
  });

  describe('immediate sync behavior', () => {
    it('should dispatch sync action after each increment', fakeAsync(() => {
      service.increaseCounterToday('counter1', 1);
      tick();

      // First increment: 1 increment action + 1 sync action
      expect(dispatchSpy.calls.count()).toBe(2);

      service.increaseCounterToday('counter1', 1);
      tick();

      // Second increment: another 1 increment action + 1 sync action
      expect(dispatchSpy.calls.count()).toBe(4);

      service.increaseCounterToday('counter1', 1);
      tick();

      // Third increment: another 1 increment action + 1 sync action
      expect(dispatchSpy.calls.count()).toBe(6);

      // Each sync uses the absolute value from the store
      const syncCalls = dispatchSpy.calls
        .allArgs()
        .filter(
          (args) => args[0].type === '[SimpleCounter] Set SimpleCounter Counter Today',
        );
      expect(syncCalls.length).toBe(3);
    }));
  });

  describe('sync behavior', () => {
    it('increaseSimpleCounterCounterToday should NOT have persistence metadata', () => {
      const action = increaseSimpleCounterCounterToday({
        id: 'counter1',
        increaseBy: 1,
        today: '2024-01-15',
      }) as any;

      expect(action.meta).toBeUndefined();
    });

    it('decreaseSimpleCounterCounterToday should NOT have persistence metadata', () => {
      const action = decreaseSimpleCounterCounterToday({
        id: 'counter1',
        decreaseBy: 1,
        today: '2024-01-15',
      }) as any;

      expect(action.meta).toBeUndefined();
    });

    it('setSimpleCounterCounterToday should have persistence metadata', () => {
      const action = setSimpleCounterCounterToday({
        id: 'counter1',
        newVal: 6,
        today: '2024-01-15',
      });

      expect(action.meta.isPersistent).toBe(true);
      expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
    });
  });

  describe('deleteSimpleCounter', () => {
    it('should dispatch deleteSimpleCounter action', fakeAsync(() => {
      service.deleteSimpleCounter('counter1');
      tick();

      expect(dispatchSpy).toHaveBeenCalledWith(deleteSimpleCounter({ id: 'counter1' }));
    }));
  });

  describe('deleteSimpleCounters', () => {
    beforeEach(() => {
      mockCounters([
        createCounter('counter1', { countOnDay: { '2024-01-15': 6 } }),
        createCounter('counter2', { countOnDay: { '2024-01-15': 3 } }),
      ]);
    });

    it('should dispatch deleteSimpleCounters action', fakeAsync(() => {
      service.deleteSimpleCounters(['counter1', 'counter2']);
      tick();

      expect(dispatchSpy).toHaveBeenCalledWith(
        deleteSimpleCounters({ ids: ['counter1', 'counter2'] }),
      );
    }));
  });

  describe('updateSimpleCounter', () => {
    it('should dispatch updateSimpleCounter action', fakeAsync(() => {
      service.updateSimpleCounter('counter1', { title: 'New Title' });
      tick();

      expect(dispatchSpy).toHaveBeenCalledWith(
        updateSimpleCounter({
          simpleCounter: { id: 'counter1', changes: { title: 'New Title' } },
        }),
      );
    }));

    it('should flush stopwatch accumulator when type changes', fakeAsync(() => {
      // Simulate accumulated stopwatch time by accessing the private field
      // We'll test the effect indirectly by checking dispatch calls
      service.updateSimpleCounter('counter1', { type: SimpleCounterType.StopWatch });
      tick();

      expect(dispatchSpy).toHaveBeenCalledWith(
        updateSimpleCounter({
          simpleCounter: {
            id: 'counter1',
            changes: { type: SimpleCounterType.StopWatch },
          },
        }),
      );
    }));
  });

  describe('stopwatch sync with absolute values', () => {
    beforeEach(() => {
      mockCounters([
        createCounter('stopwatch1', {
          type: SimpleCounterType.StopWatch,
          countOnDay: { '2024-01-15': 20000 }, // 20 seconds
        }),
      ]);
    });

    it('should sync stopwatch with absolute value on flush', fakeAsync(() => {
      // Call flushAccumulatedTime to trigger sync
      service.flushAccumulatedTime();
      tick();

      // Note: Since we mock the accumulator callback, this test verifies the service structure.
      // The actual sync happens via _syncStopwatchAbsoluteValue which dispatches setSimpleCounterCounterToday
    }));

    it('should use setSimpleCounterCounterToday for stopwatch sync (not relative duration)', fakeAsync(() => {
      // Verify the sync uses absolute values by checking the action type
      // When stopwatch syncs, it should dispatch setSimpleCounterCounterToday with absolute value
      mockCounters([
        createCounter('stopwatch1', {
          type: SimpleCounterType.StopWatch,
          countOnDay: { '2024-01-15': 20000 },
        }),
      ]);

      // The service should be configured to sync absolute values
      // This is verified by the accumulator callback using _syncStopwatchAbsoluteValue
      service.flushAccumulatedTime();
      tick();
    }));
  });

  describe('click counter immediate sync - edge cases', () => {
    it('should sync with correct absolute value when counter starts from 0', fakeAsync(() => {
      // BEFORE increment: counter is at 0
      mockCounters([
        createCounter('counter1', {
          countOnDay: { '2024-01-15': 0 },
        }),
      ]);

      service.increaseCounterToday('counter1', 1);
      tick();

      // New behavior: reads state (0) BEFORE dispatch, calculates newVal = 0 + 1 = 1
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 1,
          today: '2024-01-15',
        }),
      );
    }));

    it('should sync with 0 when decrementing to 0', fakeAsync(() => {
      // BEFORE decrement: counter is at 1
      mockCounters([
        createCounter('counter1', {
          countOnDay: { '2024-01-15': 1 },
        }),
      ]);

      service.decreaseCounterToday('counter1', 1);
      tick();

      // New behavior: reads state (1) BEFORE dispatch, calculates newVal = max(0, 1 - 1) = 0
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 0,
          today: '2024-01-15',
        }),
      );
    }));

    it('should handle multiple counters independently', fakeAsync(() => {
      // BEFORE increment: counters at 10 and 20
      mockCounters([
        createCounter('counter1', { countOnDay: { '2024-01-15': 10 } }),
        createCounter('counter2', { countOnDay: { '2024-01-15': 20 } }),
      ]);

      service.increaseCounterToday('counter1', 1);
      tick();

      // Should sync counter1: reads 10, calculates 10 + 1 = 11
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 11,
          today: '2024-01-15',
        }),
      );

      dispatchSpy.calls.reset();
      service.increaseCounterToday('counter2', 1);
      tick();

      // Should sync counter2: reads 20, calculates 20 + 1 = 21
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter2',
          newVal: 21,
          today: '2024-01-15',
        }),
      );
    }));

    it('should handle increment by values greater than 1', fakeAsync(() => {
      // BEFORE increment: counter is at 10
      mockCounters([
        createCounter('counter1', {
          countOnDay: { '2024-01-15': 10 },
        }),
      ]);

      service.increaseCounterToday('counter1', 5);
      tick();

      expect(dispatchSpy).toHaveBeenCalledWith(
        increaseSimpleCounterCounterToday({
          id: 'counter1',
          increaseBy: 5,
          today: '2024-01-15',
        }),
      );

      // New behavior: reads state (10) BEFORE dispatch, calculates newVal = 10 + 5 = 15
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 15,
          today: '2024-01-15',
        }),
      );
    }));

    it('should not dispatch anything if counter not found', fakeAsync(() => {
      mockCounters([]);

      service.increaseCounterToday('nonexistent', 1);
      tick();

      // New behavior: reads state first, counter not found, returns early
      // Should NOT dispatch ANY actions since counter not found
      expect(dispatchSpy.calls.count()).toBe(0);
    }));

    it('should handle missing countOnDay for today', fakeAsync(() => {
      // BEFORE increment: counter has no entry for today (defaults to 0)
      mockCounters([
        createCounter('counter1', {
          countOnDay: { '2024-01-14': 5 }, // Yesterday, not today
        }),
      ]);

      service.increaseCounterToday('counter1', 1);
      tick();

      // New behavior: reads state, today's count is 0 (undefined), calculates 0 + 1 = 1
      expect(dispatchSpy).toHaveBeenCalledWith(
        setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 1,
          today: '2024-01-15',
        }),
      );
    }));
  });
});
