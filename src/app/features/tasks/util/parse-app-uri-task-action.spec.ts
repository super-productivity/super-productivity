import { parseAppUriTaskAction } from './parse-app-uri-task-action';

describe('parseAppUriTaskAction', () => {
  it('parses an add-task action with only a title', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://add-task?title=Buy%20milk'),
    ).toEqual({ type: 'add', title: 'Buy milk' });
  });

  it('parses an add-task action with notes and projectId', () => {
    expect(
      parseAppUriTaskAction(
        'com.super-productivity.app://add-task?title=Buy%20milk&notes=2%25%20fat&projectId=proj-1',
      ),
    ).toEqual({
      type: 'add',
      title: 'Buy milk',
      notes: '2% fat',
      projectId: 'proj-1',
    });
  });

  it('parses a complete-task action', () => {
    expect(
      parseAppUriTaskAction(
        'com.super-productivity.app://complete-task?title=Buy%20milk',
      ),
    ).toEqual({ type: 'complete', title: 'Buy milk' });
  });

  it('is case-insensitive on the action name', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://Add-Task?title=Buy%20milk'),
    ).toEqual({ type: 'add', title: 'Buy milk' });
  });

  it('returns null when the title query param is missing', () => {
    expect(parseAppUriTaskAction('com.super-productivity.app://add-task')).toBeNull();
  });

  it('returns null when the title query param is empty', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://add-task?title='),
    ).toBeNull();
  });

  it('returns null for unrelated actions (e.g. the existing oauth-callback)', () => {
    expect(
      parseAppUriTaskAction(
        'com.super-productivity.app://oauth-callback?code=abc&provider=dropbox',
      ),
    ).toBeNull();
  });

  it('returns null for an unparseable URL', () => {
    expect(parseAppUriTaskAction('not a url')).toBeNull();
  });
});
