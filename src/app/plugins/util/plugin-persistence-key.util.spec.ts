import {
  assertPluginPersistenceKey,
  composeId,
  isPluginIdMatch,
  MAX_PLUGIN_PERSISTENCE_KEY_LENGTH,
} from './plugin-persistence-key.util';

describe('composeId', () => {
  it('returns pluginId unchanged when no key is provided', () => {
    expect(composeId('plugin-a')).toBe('plugin-a');
  });

  it('returns pluginId unchanged when key is undefined', () => {
    expect(composeId('plugin-a', undefined)).toBe('plugin-a');
  });

  it('treats empty key as undefined (no colon appended)', () => {
    expect(composeId('plugin-a', '')).toBe('plugin-a');
  });

  it('joins pluginId and key with ":"', () => {
    expect(composeId('plugin-a', 'doc-1')).toBe('plugin-a:doc-1');
  });

  it('allows keys that themselves contain colons (delimiter only applies to pluginId)', () => {
    expect(composeId('plugin-a', 'doc:nested:1')).toBe('plugin-a:doc:nested:1');
  });

  it('throws synchronously when pluginId contains ":"', () => {
    expect(() => composeId('bad:plugin')).toThrowError(/must not contain ':'/);
    expect(() => composeId('bad:plugin', 'k')).toThrowError(/must not contain ':'/);
  });
});

describe('assertPluginPersistenceKey', () => {
  it('accepts undefined (legacy keyless form)', () => {
    expect(() => assertPluginPersistenceKey(undefined)).not.toThrow();
  });

  it('accepts ordinary strings', () => {
    expect(() => assertPluginPersistenceKey('')).not.toThrow();
    expect(() => assertPluginPersistenceKey('doc-1')).not.toThrow();
    expect(() => assertPluginPersistenceKey('a'.repeat(100))).not.toThrow();
  });

  it('accepts a key at exactly the length cap', () => {
    expect(() =>
      assertPluginPersistenceKey('a'.repeat(MAX_PLUGIN_PERSISTENCE_KEY_LENGTH)),
    ).not.toThrow();
  });

  it('throws on a key over the length cap', () => {
    expect(() =>
      assertPluginPersistenceKey('a'.repeat(MAX_PLUGIN_PERSISTENCE_KEY_LENGTH + 1)),
    ).toThrowError(/exceeds maximum length/);
  });

  it('throws on non-string input', () => {
    expect(() => assertPluginPersistenceKey(null)).toThrowError(
      /must be a string or undefined/,
    );
    expect(() => assertPluginPersistenceKey(42)).toThrowError(
      /must be a string or undefined/,
    );
    expect(() => assertPluginPersistenceKey({ toString: () => 'x' })).toThrowError(
      /must be a string or undefined/,
    );
  });
});

describe('isPluginIdMatch', () => {
  it('matches the legacy entry', () => {
    expect(isPluginIdMatch('plugin-a', 'plugin-a')).toBe(true);
  });

  it('matches keyed entries by prefix', () => {
    expect(isPluginIdMatch('plugin-a:doc-1', 'plugin-a')).toBe(true);
    expect(isPluginIdMatch('plugin-a:doc:nested', 'plugin-a')).toBe(true);
  });

  it('rejects unrelated plugin entries', () => {
    expect(isPluginIdMatch('plugin-b', 'plugin-a')).toBe(false);
    expect(isPluginIdMatch('plugin-b:doc', 'plugin-a')).toBe(false);
  });

  it('rejects plugin ids that share a prefix without the delimiter', () => {
    // 'plugin-abc' should NOT match cleanup for 'plugin-a'.
    expect(isPluginIdMatch('plugin-abc', 'plugin-a')).toBe(false);
    expect(isPluginIdMatch('plugin-abc:doc', 'plugin-a')).toBe(false);
  });
});
