import {
  getCalendarEventIdCandidates,
  matchesAnyCalendarEventId,
  shareCalendarEventId,
} from './get-calendar-event-id-candidates';
import { CalendarIntegrationEvent } from './calendar-integration.model';

const baseEvent: CalendarIntegrationEvent = {
  id: 'event',
  calProviderId: 'provider',
  title: 'Event',
  start: 0,
  duration: 0,
  issueProviderKey: 'ICAL',
};

describe('getCalendarEventIdCandidates', () => {
  it('should include legacy IDs when present', () => {
    const ev: CalendarIntegrationEvent = {
      ...baseEvent,
      legacyIds: ['legacy-1', 'legacy-2'],
    };

    expect(getCalendarEventIdCandidates(ev)).toEqual(['event', 'legacy-1', 'legacy-2']);
  });

  it('should fall back to primary id when no legacy IDs exist', () => {
    expect(getCalendarEventIdCandidates(baseEvent)).toEqual(['event']);
  });
});

describe('matchesAnyCalendarEventId', () => {
  it('should match by legacy id as fallback', () => {
    const ev: CalendarIntegrationEvent = {
      ...baseEvent,
      id: 'event_new',
      legacyIds: ['event'],
    };

    expect(matchesAnyCalendarEventId(ev, ['event'])).toBe(true);
  });

  it('should not match when no ids overlap', () => {
    expect(matchesAnyCalendarEventId(baseEvent, ['x', 'y'])).toBe(false);
  });
});

describe('shareCalendarEventId', () => {
  it('should detect overlap via legacy ids', () => {
    const newEvent: CalendarIntegrationEvent = {
      ...baseEvent,
      id: 'event_new',
      legacyIds: ['event'],
    };
    expect(shareCalendarEventId(baseEvent, newEvent)).toBe(true);
  });

  it('should return false if no ids overlap', () => {
    const otherEvent: CalendarIntegrationEvent = {
      ...baseEvent,
      id: 'other',
      legacyIds: ['legacy'],
    };
    expect(shareCalendarEventId(baseEvent, otherEvent)).toBe(false);
  });
});
