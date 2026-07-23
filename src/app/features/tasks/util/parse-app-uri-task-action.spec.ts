import { parseAppUriTaskAction } from './parse-app-uri-task-action';

describe('parseAppUriTaskAction', () => {
  it('parses a create-task action with only a title', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://create-task?title=Buy%20milk'),
    ).toEqual({ type: 'add', title: 'Buy milk' });
  });

  it('parses a create-task action with notes and projectId', () => {
    expect(
      parseAppUriTaskAction(
        'com.super-productivity.app://create-task?title=Buy%20milk&notes=2%25%20fat&projectId=proj-1',
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
      parseAppUriTaskAction('com.super-productivity.app://Create-Task?title=Buy%20milk'),
    ).toEqual({ type: 'add', title: 'Buy milk' });
  });

  it('returns null when the title query param is missing', () => {
    expect(parseAppUriTaskAction('com.super-productivity.app://create-task')).toBeNull();
  });

  // A present-but-empty `title=` is forwarded (not nulled) so the service
  // surfaces the empty-title error snack, matching the desktop path. Only a
  // completely missing param yields no action.
  it('forwards a present-but-empty title (title=) for the service to reject', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://create-task?title='),
    ).toEqual({ type: 'add', title: '' });
  });

  // A present-but-whitespace-only title is forwarded (not nulled) so the service
  // surfaces the empty-title error snack — matching the desktop path, which
  // forwards a truthy ' '. The service does the trimming/rejection.
  it('forwards a whitespace-only title (%20) for the service to reject', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://create-task?title=%20'),
    ).toEqual({ type: 'add', title: ' ' });
  });

  it('forwards a lone "+" title (decodes to a space) for the service to reject', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://create-task?title=+'),
    ).toEqual({ type: 'add', title: ' ' });
  });

  it('forwards a whitespace-only complete-task title for the service to reject', () => {
    expect(
      parseAppUriTaskAction('com.super-productivity.app://complete-task?title=%20%20'),
    ).toEqual({ type: 'complete', title: '  ' });
  });

  it('forwards the title untrimmed (the service trims)', () => {
    expect(
      parseAppUriTaskAction(
        'com.super-productivity.app://create-task?title=%20Buy%20milk%20',
      ),
    ).toEqual({ type: 'add', title: ' Buy milk ' });
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
