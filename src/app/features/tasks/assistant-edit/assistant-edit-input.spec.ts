import {
  parseAssistantLogTime,
  parseAssistantTaskId,
  parseAssistantTaskUpdate,
} from './assistant-edit-input';

describe('assistant edit input', () => {
  describe('parseAssistantTaskUpdate', () => {
    it('reads days, times, clears and the other fields', () => {
      expect(
        parseAssistantTaskUpdate({
          id: 't1',
          title: '  Call Anna  ',
          isDone: false,
          dueDate: '2026-11-21',
          dueTime: '09:05',
          deadlineDate: null,
          estimateMinutes: 0,
          tagIds: ['a', 'a', 'b'],
        }),
      ).toEqual({
        id: 't1',
        title: 'Call Anna',
        isDone: false,
        due: { day: '2026-11-21', time: [9, 5] },
        deadline: null,
        estimateMinutes: 0,
        tagIds: ['a', 'b'],
      });
      expect(parseAssistantTaskUpdate({ id: 't1', deadlineDate: '2026-11-21' })).toEqual({
        id: 't1',
        deadline: { day: '2026-11-21' },
      });
    });

    it('rejects notes, unknown fields, empty changes and malformed values', () => {
      for (const body of [
        null,
        { id: 't1' },
        { id: 't1', notes: 'x' },
        { id: 't1', projectId: 'p' },
        { id: '../x', isDone: true },
        { id: 't1', title: ' ' },
        { id: 't1', title: 'x'.repeat(501) },
        { id: 't1', isDone: 'yes' },
        { id: 't1', dueTime: '10:00' },
        { id: 't1', dueDate: null, dueTime: '10:00' },
        { id: 't1', dueDate: '2026-02-30' },
        { id: 't1', dueDate: '0999-01-01' },
        { id: 't1', dueDate: '2026-11-21', dueTime: '24:00' },
        { id: 't1', estimateMinutes: 1.5 },
        { id: 't1', estimateMinutes: 10081 },
        { id: 't1', tagIds: 'a' },
        { id: 't1', tagIds: ['a/b'] },
      ]) {
        expect(parseAssistantTaskUpdate(body))
          .withContext(JSON.stringify(body))
          .toBeUndefined();
      }
    });
  });

  it('parseAssistantTaskId takes exactly an id', () => {
    expect(parseAssistantTaskId({ id: 't1' })).toBe('t1');
    expect(parseAssistantTaskId({ id: 't1', extra: 1 })).toBeUndefined();
    expect(parseAssistantTaskId({})).toBeUndefined();
  });

  it('parseAssistantLogTime needs a minute to add and allows 0 to set', () => {
    expect(
      parseAssistantLogTime({ id: 't1', date: '2026-11-20', minutes: 0, mode: 'set' }),
    ).toEqual({ id: 't1', date: '2026-11-20', minutes: 0, mode: 'set' });
    expect(
      parseAssistantLogTime({ id: 't1', date: '2026-11-20', minutes: 0, mode: 'add' }),
    ).toBeUndefined();
    expect(
      parseAssistantLogTime({ id: 't1', date: '2026-11-20', minutes: 1441, mode: 'set' }),
    ).toBeUndefined();
    expect(
      parseAssistantLogTime({ id: 't1', date: '2026-11-20', minutes: 5 }),
    ).toBeUndefined();
  });
});
