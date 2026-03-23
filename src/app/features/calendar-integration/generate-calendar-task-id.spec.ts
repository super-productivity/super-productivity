import { generateCalendarTaskId } from './generate-calendar-task-id';

describe('generateCalendarTaskId', () => {
  it('should return a deterministic ID for the same inputs', () => {
    const id1 = generateCalendarTaskId('provider-abc', 'event-123@google.com');
    const id2 = generateCalendarTaskId('provider-abc', 'event-123@google.com');
    expect(id1).toBe(id2);
  });

  it('should return different IDs for different provider IDs', () => {
    const id1 = generateCalendarTaskId('provider-abc', 'event-123');
    const id2 = generateCalendarTaskId('provider-xyz', 'event-123');
    expect(id1).not.toBe(id2);
  });

  it('should return different IDs for different event IDs', () => {
    const id1 = generateCalendarTaskId('provider-abc', 'event-123');
    const id2 = generateCalendarTaskId('provider-abc', 'event-456');
    expect(id1).not.toBe(id2);
  });

  it('should start with cal_ prefix', () => {
    const id = generateCalendarTaskId('provider-abc', 'event-123');
    expect(id).toMatch(/^cal_/);
  });

  it('should include provider and event IDs for debuggability', () => {
    const id = generateCalendarTaskId('provider-abc', 'event-123');
    expect(id).toContain('provider-abc');
    expect(id).toContain('event-123');
  });

  it('should handle recurring event IDs with timestamps', () => {
    const id1 = generateCalendarTaskId('prov1', 'uid123_1709251200');
    const id2 = generateCalendarTaskId('prov1', 'uid123_1709337600');
    expect(id1).not.toBe(id2);
  });

  it('should produce a stable known value to guard against algorithm changes', () => {
    const id = generateCalendarTaskId('provider-abc', 'event-123');
    expect(id).toBe('cal_provider-abc_event-123');
  });
});
