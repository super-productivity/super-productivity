import { DEFAULT_TRELLO_CFG, TRELLO_CONFIG_FORM } from './trello.const';

describe('Trello Config', () => {
  it('should have filterUsername set to null by default', () => {
    expect((DEFAULT_TRELLO_CFG as any).filterUsername).toBe(null);
  });

  it('should include filterUsername in the configuration form at the root level', () => {
    const filterUsernameField = TRELLO_CONFIG_FORM.find(
      (field) => field.key === 'filterUsername',
    );
    expect(filterUsernameField).toBeDefined();
    expect(filterUsernameField?.props?.label).toContain('Filter by Trello Username');
  });
});
