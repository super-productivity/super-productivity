import { DateService } from '../../../core/date/date.service';
import { getDeadlineAutoPlanFields } from './get-deadline-auto-plan-fields';

describe('getDeadlineAutoPlanFields', () => {
  let dateService: jasmine.SpyObj<
    Pick<DateService, 'todayStr' | 'isToday' | 'getStartOfNextDayDiffMs'>
  >;

  beforeEach(() => {
    dateService = jasmine.createSpyObj('DateService', [
      'todayStr',
      'isToday',
      'getStartOfNextDayDiffMs',
    ]);
    dateService.todayStr.and.returnValue('2026-01-05');
    dateService.isToday.and.returnValue(false);
    dateService.getStartOfNextDayDiffMs.and.returnValue(123);
  });

  it('should include auto-plan context for a whole-day deadline today', () => {
    expect(getDeadlineAutoPlanFields(dateService, '2026-01-05')).toEqual({
      autoPlanToday: '2026-01-05',
      autoPlanStartOfNextDayDiffMs: 123,
    });
  });

  it('should include auto-plan context for a timed deadline today', () => {
    const deadlineWithTime = new Date('2026-01-05T12:00:00').getTime();
    dateService.isToday.and.returnValue(true);

    expect(getDeadlineAutoPlanFields(dateService, undefined, deadlineWithTime)).toEqual({
      autoPlanToday: '2026-01-05',
      autoPlanStartOfNextDayDiffMs: 123,
    });
    expect(dateService.isToday).toHaveBeenCalledWith(deadlineWithTime);
  });

  it('should return no auto-plan context for future deadlines', () => {
    const deadlineWithTime = new Date('2026-01-06T12:00:00').getTime();

    expect(getDeadlineAutoPlanFields(dateService, '2026-01-06')).toEqual({});
    expect(getDeadlineAutoPlanFields(dateService, undefined, deadlineWithTime)).toEqual(
      {},
    );
  });
});
