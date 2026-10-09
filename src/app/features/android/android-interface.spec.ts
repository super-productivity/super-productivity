import { parseReminderTapQueue } from './android-interface';

describe('parseReminderTapQueue', () => {
  it('keeps a plain task id as a string', () => {
    expect(parseReminderTapQueue('task-1')).toBe('task-1');
  });

  it('parses a deadline tap payload', () => {
    expect(
      parseReminderTapQueue('{"taskId":"task-1","reminderType":"DEADLINE"}'),
    ).toEqual({ taskId: 'task-1', reminderType: 'DEADLINE' });
  });
});
