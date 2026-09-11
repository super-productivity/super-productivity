import { readPluginTranslationsFromZip } from './read-plugin-translations-from-zip.util';

describe('readPluginTranslationsFromZip', () => {
  const NO_LIMIT = 10 * 1024 * 1024;

  /** Build a zip-entry map; object literals can't hold `i18n/en.json` style keys. */
  const zipEntries = (
    entries: [path: string, content: string][],
  ): Record<string, Uint8Array> => {
    const files: Record<string, Uint8Array> = {};
    for (const [path, content] of entries) {
      files[path] = new TextEncoder().encode(content);
    }
    return files;
  };

  it('reads the declared languages that ship a file', () => {
    const result = readPluginTranslationsFromZip(
      zipEntries([
        ['i18n/en.json', '{"A":"a"}'],
        ['i18n/de.json', '{"A":"b"}'],
        ['i18n/fr.json', '{"A":"c"}'],
      ]),
      ['en', 'de'],
      NO_LIMIT,
    );

    expect(result.translations).toEqual({ en: '{"A":"a"}', de: '{"A":"b"}' });
    expect(result.skipped).toEqual([]);
    expect(result.isOverLimit).toBeFalse();
  });

  it('counts a repeated language only once', () => {
    const content = `{"A":"${'x'.repeat(1000)}"}`;
    const result = readPluginTranslationsFromZip(
      zipEntries([['i18n/en.json', content]]),
      ['en', 'en', 'en'],
      NO_LIMIT,
    );

    expect(result.translations).toEqual({ en: content });
  });

  it('drops an unsupported language without reporting it (the validator warns)', () => {
    const result = readPluginTranslationsFromZip(
      zipEntries([
        ['i18n/en.json', '{}'],
        ['i18n/pt-BR.json', '{}'],
      ]),
      ['en', 'pt-BR'],
      NO_LIMIT,
    );

    expect(Object.keys(result.translations)).toEqual(['en']);
    expect(result.skipped).toEqual([]);
  });

  it('reports a declared language whose file is missing from the zip', () => {
    const result = readPluginTranslationsFromZip(
      zipEntries([['i18n/en.json', '{}']]),
      ['en', 'de'],
      NO_LIMIT,
    );

    expect(Object.keys(result.translations)).toEqual(['en']);
    expect(result.skipped).toEqual([{ lang: 'de', reason: 'file-missing' }]);
  });

  // These all parse, but PluginI18nService resolves every key to itself against
  // them — a "loaded successfully" report with #9459's exact behaviour.
  it('reports and excludes json that parses but is not an object', () => {
    for (const notAnObject of ['null', '"text"', '123', '[]', 'true']) {
      const result = readPluginTranslationsFromZip(
        zipEntries([['i18n/en.json', notAnObject]]),
        ['en'],
        NO_LIMIT,
      );

      expect(result.translations).withContext(`for content ${notAnObject}`).toEqual({});
      expect(result.skipped)
        .withContext(`for content ${notAnObject}`)
        .toEqual([{ lang: 'en', reason: 'not-a-utf8-json-object' }]);
    }
  });

  it('reports and excludes a language whose json does not parse', () => {
    const result = readPluginTranslationsFromZip(
      zipEntries([
        ['i18n/en.json', '{"A":"a"}'],
        ['i18n/de.json', '{ this is not json '],
      ]),
      ['en', 'de'],
      NO_LIMIT,
    );

    expect(result.translations).toEqual({ en: '{"A":"a"}' });
    expect(result.skipped).toEqual([{ lang: 'de', reason: 'not-a-utf8-json-object' }]);
    expect(result.isOverLimit).toBeFalse();
  });

  // Latin-1 `{"A":"é"}`. Without fatal decoding the 0xE9 becomes U+FFFD, JSON.parse
  // then SUCCEEDS, and the mojibake is cached and served as if it were the text.
  it('reports and excludes a file that is not valid UTF-8', () => {
    const latin1 = new Uint8Array([0x7b, 0x22, 0x41, 0x22, 0x3a, 0x22, 0xe9, 0x22, 0x7d]);
    const files: Record<string, Uint8Array> = {};
    files['i18n/en.json'] = latin1;

    const result = readPluginTranslationsFromZip(files, ['en'], NO_LIMIT);

    expect(result.translations).toEqual({});
    expect(result.skipped).toEqual([{ lang: 'en', reason: 'not-a-utf8-json-object' }]);
  });

  // Real editors emit BOMs; TextDecoder strips one even when fatal, so these must load.
  it('accepts a UTF-8 file with a byte-order mark', () => {
    const body = new TextEncoder().encode('{"A":"a"}');
    const withBom = new Uint8Array(3 + body.length);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(body, 3);
    const files: Record<string, Uint8Array> = {};
    files['i18n/en.json'] = withBom;

    const result = readPluginTranslationsFromZip(files, ['en'], NO_LIMIT);

    expect(result.translations).toEqual({ en: '{"A":"a"}' });
    expect(result.skipped).toEqual([]);
  });

  it('does not treat a nested translation file as the root one', () => {
    const result = readPluginTranslationsFromZip(
      zipEntries([['nested/i18n/en.json', '{}']]),
      ['en'],
      NO_LIMIT,
    );

    expect(result.translations).toEqual({});
    expect(result.skipped).toEqual([{ lang: 'en', reason: 'file-missing' }]);
  });

  it('reports over-limit and hands back nothing', () => {
    const big = `{"A":"${'x'.repeat(2000)}"}`;
    const result = readPluginTranslationsFromZip(
      zipEntries([
        ['i18n/en.json', big],
        ['i18n/de.json', big],
        ['i18n/fr.json', big],
      ]),
      ['en', 'de', 'fr'],
      big.length * 2,
    );

    expect(result.isOverLimit).toBeTrue();
    // The caller rejects the upload, so nothing is handed back.
    expect(result.translations).toEqual({});
  });

  it('accepts a set exactly at the combined limit', () => {
    const content = '{"A":"a"}';
    const result = readPluginTranslationsFromZip(
      zipEntries([['i18n/en.json', content]]),
      ['en'],
      content.length,
    );

    expect(result.isOverLimit).toBeFalse();
    expect(result.translations).toEqual({ en: content });
  });
});
