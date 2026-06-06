import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { T } from '../../t.const';
import {
  DailySummaryComponent,
  FINISH_DAY_FINAL_SYNC_TIMEOUT_MS,
} from './daily-summary.component';

const callFinishDayForGood = (
  receiver: DailySummaryComponent,
  cb?: () => void,
): Promise<void> =>
  (
    DailySummaryComponent.prototype as unknown as {
      _finishDayForGood: (cb?: () => void) => Promise<void>;
    }
  )._finishDayForGood.call(receiver, cb);

const buildFinishDayForGoodReceiver = (
  sync: () => Promise<unknown>,
): {
  receiver: DailySummaryComponent;
  sync: jasmine.Spy;
  flushPendingWrites: jasmine.Spy;
  snackOpen: jasmine.Spy;
} => {
  const syncSpy = jasmine.createSpy('sync').and.callFake(sync);
  const flushPendingWrites = jasmine
    .createSpy('flushPendingWrites')
    .and.resolveTo(undefined);
  const snackOpen = jasmine.createSpy('snackOpen');
  const receiver = Object.assign(Object.create(DailySummaryComponent.prototype), {
    configService: {
      cfg: () => ({
        sync: {
          isEnabled: true,
        },
      }),
    },
    _operationWriteFlushService: {
      flushPendingWrites,
    },
    _syncWrapperService: {
      sync: syncSpy,
    },
    _snackService: {
      open: snackOpen,
    },
  }) as DailySummaryComponent;

  return {
    receiver,
    sync: syncSpy,
    flushPendingWrites,
    snackOpen,
  };
};

describe('DailySummaryComponent', () => {
  describe('finishDay()', () => {
    it('should wait for sync to complete before archiving tasks', async () => {
      const syncDone$ = new Subject<void>();
      const callOrder: string[] = [];
      const moveDoneToArchive = jasmine
        .createSpy('moveDoneToArchive')
        .and.callFake(() => {
          callOrder.push('archive');
          return Promise.resolve();
        });
      const finishDayForGood = jasmine.createSpy('finishDayForGood').and.callFake(() => {
        callOrder.push('finish');
        return Promise.resolve();
      });

      const receiver = {
        _beforeFinishDayService: {
          executeActions: jasmine.createSpy('executeActions').and.callFake(() => {
            callOrder.push('before');
            return Promise.resolve();
          }),
        },
        _syncWrapperService: {
          afterCurrentSyncDoneOrSyncDisabled$: syncDone$,
        },
        _moveDoneToArchive: moveDoneToArchive,
        _finishDayForGood: finishDayForGood,
        _snackService: { open: jasmine.createSpy('open') },
        _matDialog: { open: jasmine.createSpy('open') },
        _router: { navigate: jasmine.createSpy('navigate') },
        isForToday: true,
      } as unknown as DailySummaryComponent;

      const finishPromise = DailySummaryComponent.prototype.finishDay.call(receiver);
      await Promise.resolve();

      expect(moveDoneToArchive).not.toHaveBeenCalled();
      expect(callOrder).toEqual(['before']);

      syncDone$.next();
      syncDone$.complete();
      await finishPromise;

      expect(callOrder).toEqual(['before', 'archive', 'finish']);
    });

    it('should not archive when before-finish actions fail', async () => {
      const moveDoneToArchive = jasmine
        .createSpy('moveDoneToArchive')
        .and.resolveTo(undefined);
      const snackOpen = jasmine.createSpy('snackOpen');
      const receiver = {
        _beforeFinishDayService: {
          executeActions: jasmine
            .createSpy('executeActions')
            .and.rejectWith(new Error('precondition failed')),
        },
        _syncWrapperService: {
          afterCurrentSyncDoneOrSyncDisabled$: new Subject<void>(),
        },
        _moveDoneToArchive: moveDoneToArchive,
        _finishDayForGood: jasmine.createSpy('finishDayForGood'),
        _snackService: { open: snackOpen },
        _matDialog: { open: jasmine.createSpy('open') },
        _router: { navigate: jasmine.createSpy('navigate') },
        isForToday: true,
      } as unknown as DailySummaryComponent;

      await DailySummaryComponent.prototype.finishDay.call(receiver);

      expect(moveDoneToArchive).not.toHaveBeenCalled();
      expect(snackOpen).toHaveBeenCalledWith({
        msg: T.F.SYNC.S.FINISH_DAY_SYNC_ERROR,
        type: 'ERROR',
      });
    });
  });

  describe('_finishDayForGood()', () => {
    it('should still execute the callback when the final sync fails', async () => {
      const cb = jasmine.createSpy('cb');
      const { receiver, sync, flushPendingWrites, snackOpen } =
        buildFinishDayForGoodReceiver(() => Promise.reject(new Error('sync failed')));

      await callFinishDayForGood(receiver, cb);

      expect(flushPendingWrites).toHaveBeenCalled();
      expect(sync).toHaveBeenCalled();
      expect(cb).toHaveBeenCalled();
      expect(snackOpen).toHaveBeenCalledWith({
        msg: T.F.SYNC.S.FINISH_DAY_SYNC_ERROR,
        type: 'ERROR',
      });
    });

    it('should not execute the callback when pending operation writes cannot be flushed', async () => {
      const cb = jasmine.createSpy('cb');
      const { receiver, sync, flushPendingWrites, snackOpen } =
        buildFinishDayForGoodReceiver(() => Promise.resolve());
      flushPendingWrites.and.rejectWith(new Error('flush failed'));

      await callFinishDayForGood(receiver, cb);

      expect(flushPendingWrites).toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
      expect(cb).not.toHaveBeenCalled();
      expect(snackOpen).toHaveBeenCalledWith({
        msg: T.F.SYNC.S.FINISH_DAY_SYNC_ERROR,
        type: 'ERROR',
      });
    });

    it('should still execute the callback when the final sync times out', fakeAsync(() => {
      const cb = jasmine.createSpy('cb');
      let isResolved = false;
      const { receiver, sync, flushPendingWrites, snackOpen } =
        buildFinishDayForGoodReceiver(() => new Promise(() => undefined));

      callFinishDayForGood(receiver, cb).then(() => {
        isResolved = true;
      });
      flushMicrotasks();

      expect(flushPendingWrites).toHaveBeenCalled();
      expect(sync).toHaveBeenCalled();
      expect(cb).not.toHaveBeenCalled();
      expect(isResolved).toBeFalse();

      tick(FINISH_DAY_FINAL_SYNC_TIMEOUT_MS - 1);
      flushMicrotasks();

      expect(cb).not.toHaveBeenCalled();
      expect(isResolved).toBeFalse();

      tick(1);
      flushMicrotasks();

      expect(cb).toHaveBeenCalled();
      expect(isResolved).toBeTrue();
      expect(snackOpen).toHaveBeenCalledWith({
        msg: T.F.SYNC.S.FINISH_DAY_SYNC_ERROR,
        type: 'ERROR',
      });
    }));
  });
});

describe('DailySummaryComponent moment replacement', () => {
  describe('date time parsing', () => {
    it('should parse date and time to timestamp', () => {
      const testCases = [
        {
          dayStr: '2023-10-15',
          timeStr: '09:30',
          expectedMs: new Date(2023, 9, 15, 9, 30).getTime(),
        },
        {
          dayStr: '2023-12-25',
          timeStr: '14:45',
          expectedMs: new Date(2023, 11, 25, 14, 45).getTime(),
        },
        {
          dayStr: '2024-01-01',
          timeStr: '00:00',
          expectedMs: new Date(2024, 0, 1, 0, 0).getTime(),
        },
        {
          dayStr: '2024-02-29',
          timeStr: '23:59',
          expectedMs: new Date(2024, 1, 29, 23, 59).getTime(),
        },
      ];

      testCases.forEach(({ dayStr, timeStr, expectedMs }) => {
        const dateTimeStr = `${dayStr} ${timeStr}`;
        const timestamp = new Date(dateTimeStr).getTime();
        expect(timestamp).toBe(expectedMs);
      });
    });
  });
});
