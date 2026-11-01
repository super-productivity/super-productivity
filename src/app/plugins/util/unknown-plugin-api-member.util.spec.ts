import {
  PLUGIN_API_MEMBER_NAMES,
  PLUGIN_API_TYPES_URL,
  unknownPluginApiMemberMessage,
  withUnknownMemberWarning,
} from './unknown-plugin-api-member.util';

const suggestionsOf = (msg: string): string[] =>
  (msg.match(/Did you mean: ([^?]+)\?/)?.[1] ?? '').split(', ').filter(Boolean);

describe('unknownPluginApiMemberMessage', () => {
  const message = (name: string): string =>
    unknownPluginApiMemberMessage(name, PLUGIN_API_MEMBER_NAMES, PLUGIN_API_TYPES_URL);

  it('suggests real show* methods for an invented showIframe (#7173)', () => {
    const msg = message('showIframe');
    expect(msg).toContain('PluginAPI.showIframe does not exist.');
    const suggestions = suggestionsOf(msg);
    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((s) => expect(s.startsWith('show')).toBe(true));
  });

  it('ranks the method sharing the most words first', () => {
    expect(suggestionsOf(message('getProjects'))[0]).toBe('getAllProjects');
  });

  it('suggests close spellings', () => {
    expect(suggestionsOf(message('getTask'))).toContain('getTasks');
  });

  it('omits the hint when nothing is close, but always links the full API', () => {
    const msg = message('zzz');
    expect(msg).not.toContain('Did you mean');
    expect(msg).toContain(PLUGIN_API_TYPES_URL);
  });

  it('works when embedded as source text, as the iframe bridge does', () => {
    const embedded = new Function(
      `return (${unknownPluginApiMemberMessage.toString()})`,
    )();
    expect(embedded('getProjects', PLUGIN_API_MEMBER_NAMES, 'url')).toBe(
      unknownPluginApiMemberMessage('getProjects', PLUGIN_API_MEMBER_NAMES, 'url'),
    );
  });
});

describe('withUnknownMemberWarning', () => {
  class FakeApi {
    #secret = 'ok';
    cfg = { theme: 'dark' };

    getTasks(): string {
      return this.#secret;
    }
  }

  let warn: jasmine.Spy;
  let api: Record<string, unknown>;

  beforeEach(() => {
    warn = jasmine.createSpy('warn');
    api = withUnknownMemberWarning(new FakeApi(), warn) as unknown as Record<
      string,
      unknown
    >;
  });

  it('warns once per unknown member and still returns undefined', () => {
    expect(api['showIframe']).toBeUndefined();
    expect(api['showIframe']).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.calls.mostRecent().args[0]).toContain('PluginAPI.showIframe');
  });

  it('keeps methods that read #private fields working', () => {
    expect((api['getTasks'] as () => string)()).toBe('ok');
    expect(api['getTasks']).toBe(api['getTasks']);
    expect(api['cfg']).toEqual({ theme: 'dark' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when feature-detecting an API member the host omits', () => {
    expect(api['executeNodeScript']).toBeUndefined();
    expect(api['onWindowFocusChange']).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn for runtime probes', () => {
    expect(api['then']).toBeUndefined();
    expect(JSON.stringify(api)).toContain('dark');
    expect(warn).not.toHaveBeenCalled();
  });
});
