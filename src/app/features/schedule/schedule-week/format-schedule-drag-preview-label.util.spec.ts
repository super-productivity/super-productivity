import { formatScheduleDragPreviewLabel } from './format-schedule-drag-preview-label.util';

describe('formatScheduleDragPreviewLabel', () => {
  const formatTime = (timestamp: number): string =>
    new Date(timestamp).toISOString().slice(11, 16);

  it('should return the start time when duration is missing', () => {
    const startTimestamp = Date.UTC(2026, 2, 20, 9, 0, 0);

    expect(
      formatScheduleDragPreviewLabel({
        startTimestamp,
        formatTime,
      }),
    ).toBe('09:00');
  });

  it('should include the end time and task duration for scheduled drags', () => {
    const startTimestamp = Date.UTC(2026, 2, 20, 9, 0, 0);

    expect(
      formatScheduleDragPreviewLabel({
        startTimestamp,
        durationInHours: 1.5,
        formatTime,
      }),
    ).toBe('09:00 - 10:30 (1h 30m)');
  });

  it('should support short durations without adding an hours part', () => {
    const startTimestamp = Date.UTC(2026, 2, 20, 9, 15, 0);

    expect(
      formatScheduleDragPreviewLabel({
        startTimestamp,
        durationInHours: 0.75,
        formatTime,
      }),
    ).toBe('09:15 - 10:00 (45m)');
  });
});
