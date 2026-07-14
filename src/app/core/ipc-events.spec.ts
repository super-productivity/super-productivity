import { parseAddTaskFromAppUriPayload } from './ipc-events';

describe('parseAddTaskFromAppUriPayload', () => {
  it('accepts a payload with a title', () => {
    expect(parseAddTaskFromAppUriPayload({ title: 'Test Task' })).toEqual({
      title: 'Test Task',
    });
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
