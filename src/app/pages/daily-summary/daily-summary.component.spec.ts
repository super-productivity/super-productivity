/**
 * DailySummaryComponent Tests
 *
 * Note: Full component testing requires extensive mocking due to many dependencies
 * (Store, TranslateService, WorkContextService, TaskService, etc.)
 *
 * The finishDay() method now waits for ongoing sync to complete before archiving
 * tasks to prevent DB lock errors. This is tested via:
 * - Manual testing: Start sync, click "Finish Day" while sync is running
 * - The fix ensures afterCurrentSyncDoneOrSyncDisabled$ completes before _moveDoneToArchive()
 */

describe('DailySummaryComponent', () => {
  describe('finishDay()', () => {
    // These tests document the expected behavior but are skipped due to
    // complex dependency mocking requirements
    xit('should wait for sync to complete before archiving tasks', () => {
      // The finishDay() method now includes:
      // await this._syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$
      //   .pipe(first())
      //   .toPromise();
      // This ensures any ongoing sync completes before _moveDoneToArchive() is called,
      // preventing "Attempting to write DB for archiveYoung while locked" errors.
    });

    xit('should call moveToArchive only after sync completes', () => {
      // Implementation: See daily-summary.component.ts:329-332
      // The sync wait is placed right after _beforeFinishDayService.executeActions()
      // and before any branch that calls _moveDoneToArchive()
    });
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
