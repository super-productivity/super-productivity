import { describeOpForLog } from './describe-op-for-log.util';
import { MAX_DATA_LENGTH } from '../../core/log';

describe('describeOpForLog', () => {
  it('returns ids and types and leaves the payload out', () => {
    const op = {
      id: 'op-1',
      actionType: '[Task] Update Task',
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { task: { id: 'task-1', changes: { title: 'Call Anna' } } },
    };

    expect(describeOpForLog(op)).toEqual({
      opId: 'op-1',
      actionType: '[Task] Update Task',
      entityType: 'TASK',
      entityIds: ['task-1'],
      entityCount: 1,
    });
  });

  it('caps the listed entity ids but keeps the full count', () => {
    const result = describeOpForLog({
      id: 'op-1',
      actionType: '[Task Shared] Delete Tasks',
      entityType: 'TASK',
      entityIds: ['t1', 't2', 't3', 't4', 't5'],
    });

    expect(result.entityIds).toEqual(['t1', 't2', 't3']);
    expect(result.entityCount).toBe(5);
  });

  it('fits one exported log arg for a bulk op with real-sized ids', () => {
    // UUIDv7 op id (36 chars), nanoid entity ids (21 chars), a long action type.
    const result = describeOpForLog({
      id: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      actionType: '[Task Shared] Move To Other Project With Sub Tasks And Reminders',
      entityType: 'ISSUE_PROVIDER',
      entityIds: Array.from({ length: 500 }, (_, i) => `V1StGXR8_Z5jdHi6B-${i}`),
    });

    expect(JSON.stringify(result).length).toBeLessThan(MAX_DATA_LENGTH);
  });
});
