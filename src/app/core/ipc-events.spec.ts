import {
  parseAddTaskFromAppUriPayload,
  parseBeforeCloseIdsPayload,
  parseCompleteTaskFromAppUriPayload,
  parseOpenTaskFromAppUriPayload,
} from './ipc-events';

describe('parseAddTaskFromAppUriPayload', () => {
  it('accepts a payload with a title', () => {
    expect(parseAddTaskFromAppUriPayload({ title: 'Test Task' })).toEqual({
      title: 'Test Task',
    });
  });

  it('accepts optional notes and projectId', () => {
    expect(
      parseAddTaskFromAppUriPayload({
        title: 'Test Task',
        notes: 'Some notes',
        projectId: 'project-1',
      }),
    ).toEqual({
      title: 'Test Task',
      notes: 'Some notes',
      projectId: 'project-1',
    });
  });

  it('ignores non-string notes/projectId instead of rejecting the whole payload', () => {
    expect(
      parseAddTaskFromAppUriPayload({ title: 'Test Task', notes: 123, projectId: null }),
    ).toEqual({ title: 'Test Task' });
  });

  it('rejects missing payload data', () => {
    expect(parseAddTaskFromAppUriPayload(undefined)).toBeNull();
  });

  it('rejects a payload without a title', () => {
    expect(parseAddTaskFromAppUriPayload({ notTitle: 'Test Task' })).toBeNull();
  });

  it('rejects a non-string title', () => {
    expect(parseAddTaskFromAppUriPayload({ title: 123 })).toBeNull();
  });
});

describe('parseCompleteTaskFromAppUriPayload', () => {
  it('accepts a payload with a title', () => {
    expect(parseCompleteTaskFromAppUriPayload({ title: 'Test Task' })).toEqual({
      title: 'Test Task',
    });
  });

  it('rejects missing payload data', () => {
    expect(parseCompleteTaskFromAppUriPayload(undefined)).toBeNull();
  });

  it('rejects a payload without a title', () => {
    expect(parseCompleteTaskFromAppUriPayload({ notTitle: 'Test Task' })).toBeNull();
  });

  it('rejects a non-string title', () => {
    expect(parseCompleteTaskFromAppUriPayload({ title: 123 })).toBeNull();
  });
});

describe('parseOpenTaskFromAppUriPayload', () => {
  it('should return the trimmed task id', () => {
    expect(parseOpenTaskFromAppUriPayload({ taskId: ' abc ' })).toBe('abc');
  });

  it('should reject a malformed payload', () => {
    expect(parseOpenTaskFromAppUriPayload(undefined)).toBeNull();
    expect(parseOpenTaskFromAppUriPayload('abc')).toBeNull();
    expect(parseOpenTaskFromAppUriPayload({ taskId: '' })).toBeNull();
    expect(parseOpenTaskFromAppUriPayload({ taskId: 42 })).toBeNull();
    expect(parseOpenTaskFromAppUriPayload({ taskId: 'x'.repeat(201) })).toBeNull();
  });
});

describe('parseBeforeCloseIdsPayload', () => {
  it('reads ids from the payload without an Electron event argument', () => {
    expect(parseBeforeCloseIdsPayload(['SYNC_BEFORE_CLOSE'])).toEqual([
      'SYNC_BEFORE_CLOSE',
    ]);
  });

  it('rejects malformed close payloads', () => {
    expect(parseBeforeCloseIdsPayload(undefined)).toEqual([]);
    expect(parseBeforeCloseIdsPayload(['valid', 123])).toEqual([]);
  });
});
