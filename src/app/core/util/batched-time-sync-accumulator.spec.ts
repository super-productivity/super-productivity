import { BatchedTimeSyncAccumulator } from './batched-time-sync-accumulator';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

describe('BatchedTimeSyncAccumulator', () => {
  let accumulator: BatchedTimeSyncAccumulator;
  let dispatchSpy: jasmine.Spy;

  beforeEach(() => {
    dispatchSpy = jasmine.createSpy('dispatchSync');
    accumulator = new BatchedTimeSyncAccumulator(FIVE_MINUTES_MS, dispatchSpy);
  });

  describe('accumulate', () => {
    it('should accumulate duration for same id and date', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.accumulate('entity1', 2000, '2024-01-15');
      accumulator.accumulate('entity1', 500, '2024-01-15');

      accumulator.flush();

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith('entity1', '2024-01-15', 3500);
    });

    it('should track multiple entities separately', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.accumulate('entity2', 2000, '2024-01-15');

      accumulator.flush();

      expect(dispatchSpy).toHaveBeenCalledTimes(2);
      expect(dispatchSpy).toHaveBeenCalledWith('entity1', '2024-01-15', 1000);
      expect(dispatchSpy).toHaveBeenCalledWith('entity2', '2024-01-15', 2000);
    });

    it('should flush old data when date changes', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.accumulate('entity1', 2000, '2024-01-16');

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith('entity1', '2024-01-15', 1000);

      accumulator.flush();

      expect(dispatchSpy).toHaveBeenCalledTimes(2);
      expect(dispatchSpy).toHaveBeenCalledWith('entity1', '2024-01-16', 2000);
    });

    it('should not dispatch if accumulated duration is zero on date change', () => {
      accumulator.accumulate('entity1', 0, '2024-01-15');
      accumulator.accumulate('entity1', 1000, '2024-01-16');

      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('shouldFlush', () => {
    it('should return false immediately after creation', () => {
      expect(accumulator.shouldFlush()).toBe(false);
    });

    it('should return true after interval has passed', () => {
      jasmine.clock().install();
      const now = Date.now();
      jasmine.clock().mockDate(new Date(now));

      accumulator = new BatchedTimeSyncAccumulator(FIVE_MINUTES_MS, dispatchSpy);

      expect(accumulator.shouldFlush()).toBe(false);

      jasmine.clock().mockDate(new Date(now + FIVE_MINUTES_MS));

      expect(accumulator.shouldFlush()).toBe(true);

      jasmine.clock().uninstall();
    });
  });

  describe('flush', () => {
    it('should dispatch all accumulated data', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.accumulate('entity2', 2000, '2024-01-15');

      accumulator.flush();

      expect(dispatchSpy).toHaveBeenCalledTimes(2);
    });

    it('should clear accumulated data after flush', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.flush();

      dispatchSpy.calls.reset();

      accumulator.flush();

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should not dispatch zero duration entries', () => {
      accumulator.accumulate('entity1', 0, '2024-01-15');

      accumulator.flush();

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should reset last sync time', () => {
      jasmine.clock().install();
      const now = Date.now();
      jasmine.clock().mockDate(new Date(now));

      accumulator = new BatchedTimeSyncAccumulator(FIVE_MINUTES_MS, dispatchSpy);

      jasmine.clock().mockDate(new Date(now + FIVE_MINUTES_MS));
      expect(accumulator.shouldFlush()).toBe(true);

      accumulator.flush();
      expect(accumulator.shouldFlush()).toBe(false);

      jasmine.clock().uninstall();
    });
  });

  describe('flushOne', () => {
    it('should flush only the specified entity', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.accumulate('entity2', 2000, '2024-01-15');

      accumulator.flushOne('entity1');

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith('entity1', '2024-01-15', 1000);
    });

    it('should remove flushed entity from accumulator', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');

      accumulator.flushOne('entity1');
      dispatchSpy.calls.reset();

      accumulator.flushOne('entity1');

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should not dispatch if entity has zero duration', () => {
      accumulator.accumulate('entity1', 0, '2024-01-15');

      accumulator.flushOne('entity1');

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should not dispatch if entity does not exist', () => {
      accumulator.flushOne('nonexistent');

      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('clearOne', () => {
    it('should remove entity without dispatching', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.accumulate('entity2', 2000, '2024-01-15');

      accumulator.clearOne('entity1');

      expect(dispatchSpy).not.toHaveBeenCalled();

      // Flush should only dispatch entity2
      accumulator.flush();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith('entity2', '2024-01-15', 2000);
    });

    it('should not error when clearing nonexistent entity', () => {
      expect(() => accumulator.clearOne('nonexistent')).not.toThrow();
    });

    it('should prevent subsequent flush for cleared entity', () => {
      accumulator.accumulate('entity1', 1000, '2024-01-15');
      accumulator.clearOne('entity1');

      accumulator.flush();

      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('resetSyncTime', () => {
    it('should reset the sync time', () => {
      jasmine.clock().install();
      const now = Date.now();
      jasmine.clock().mockDate(new Date(now));

      accumulator = new BatchedTimeSyncAccumulator(FIVE_MINUTES_MS, dispatchSpy);

      jasmine.clock().mockDate(new Date(now + FIVE_MINUTES_MS));
      expect(accumulator.shouldFlush()).toBe(true);

      accumulator.resetSyncTime();
      expect(accumulator.shouldFlush()).toBe(false);

      jasmine.clock().uninstall();
    });
  });
});
