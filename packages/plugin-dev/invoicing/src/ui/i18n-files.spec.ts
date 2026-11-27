import * as fs from 'fs';
import * as path from 'path';
import manifest from '../manifest.json';

const DIR = path.join(__dirname, '../../i18n');

const flatten = (value: object, prefix = ''): Record<string, string> =>
  Object.entries(value).reduce<Record<string, string>>(
    (acc, [key, nested]) =>
      typeof nested === 'string'
        ? { ...acc, [`${prefix}${key}`]: nested }
        : { ...acc, ...flatten(nested, `${prefix}${key}.`) },
    {},
  );

const read = (lang: string): Record<string, string> =>
  flatten(JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), 'utf8')));

const placeholders = (text: string): string[] => (text.match(/{{\w+}}/g) ?? []).sort();

describe('i18n files', () => {
  const english = read('en');

  it('ships a file for every language the manifest lists, and no other', () => {
    const files = fs.readdirSync(DIR).map((f) => f.replace(/\.json$/, ''));
    expect(files.sort()).toEqual([...manifest.i18n.languages].sort());
  });

  it.each(manifest.i18n.languages)(
    '%s has every key, non-empty, with the same placeholders',
    (lang) => {
      const translated = read(lang);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
      for (const [key, text] of Object.entries(english)) {
        expect(translated[key].trim()).not.toBe('');
        expect([key, placeholders(translated[key])]).toEqual([key, placeholders(text)]);
      }
    },
  );
});
