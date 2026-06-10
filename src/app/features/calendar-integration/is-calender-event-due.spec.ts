import { isCalenderEventDue } from './is-calender-event-due';
import { IssueProviderCalendar } from '../issue/issue.model';

describe('isCalenderEventDue()', () => {
  it('should be true if event starts now', () => {
    expect(
      isCalenderEventDue(
        {
          id: 'CID',
          calProviderId: 'PR',
          start: 5,
          title: 'T',
          duration: 1,
          issueProviderKey: 'ICAL',
        },
        {
          showBannerBeforeThreshold: 0,
        } as IssueProviderCalendar,
        [],
        5,
      ),
    ).toBe(true);
  });

  it('should be true if event starts within provider threshold', () => {
    expect(
      isCalenderEventDue(
        {
          id: 'CID',
          calProviderId: 'PR',
          start: 5,
          title: 'T',
          duration: 1,
          issueProviderKey: 'ICAL',
        },
        {
          showBannerBeforeThreshold: 2,
        } as IssueProviderCalendar,
        [],
        3,
      ),
    ).toBe(true);
  });

  it('should be false if event starts outside the provider threshold', () => {
    expect(
      isCalenderEventDue(
        {
          id: 'CID',
          calProviderId: 'PR',
          start: 5,
          title: 'T',
          duration: 1,
          issueProviderKey: 'ICAL',
        },
        {
          showBannerBeforeThreshold: 2,
        } as IssueProviderCalendar,
        [],
        1,
      ),
    ).toBe(false);
  });

  it('should be false if event has NOT started yet and there is NO provider threshold', () => {
    expect(
      isCalenderEventDue(
        {
          id: 'CID',
          calProviderId: 'PR',
          start: 5,
          title: 'T',
          duration: 1,
          issueProviderKey: 'ICAL',
        },
        {
          showBannerBeforeThreshold: null,
        } as IssueProviderCalendar,
        [],
        4,
      ),
    ).toBe(false);
  });

  it('should be if false if event was skipped', () => {
    expect(
      isCalenderEventDue(
        {
          id: 'CID',
          calProviderId: 'PR',
          start: 5,
          title: 'T',
          duration: 1,
          issueProviderKey: 'ICAL',
        },
        {
          showBannerBeforeThreshold: 0,
        } as IssueProviderCalendar,
        ['CID'],
        0,
      ),
    ).toBe(false);
  });

  it('should be if false if event is in the far future', () => {
    expect(
      isCalenderEventDue(
        {
          id: 'CID',
          calProviderId: 'PR',
          start: 6,
          title: 'T',
          duration: 88,
          issueProviderKey: 'ICAL',
        },
        {
          showBannerBeforeThreshold: 0,
        } as IssueProviderCalendar,
        [],
        1,
      ),
    ).toBe(false);
  });
});
