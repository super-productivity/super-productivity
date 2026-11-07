import { unzipSync, strFromU8 } from 'fflate';
import {
  buildPluginErrorReport,
  buildPluginPrompt,
  createPluginZipFile,
  parsePluginAnswer,
} from './build-plugin.util';

const FENCE = '```';

const answerOf = (...blocks: [string, string][]): string =>
  'Here is your plugin!\n\n' +
  blocks.map(([lang, body]) => `${FENCE}${lang}\n${body}\n${FENCE}`).join('\n\nAnd:\n\n');

describe('buildPluginPrompt', () => {
  it('embeds the API types, so an AI without web access needs no second round', () => {
    const prompt = buildPluginPrompt(
      '  Beep on task complete \n',
      '19.3.1',
      'export interface PluginAPI {}\n',
    );

    expect(prompt).toContain('```ts\nexport interface PluginAPI {}\n```');
    expect(prompt).toContain('should:\n\nBeep on task complete\n');
    expect(prompt).toContain('"minSupVersion": "19.3.1"');
    expect(prompt).not.toContain('raw.githubusercontent.com');
    // cheap models asked whether an empty manifest "hooks" list blocks registerHook
    expect(prompt).toContain('registerHook works without listing hooks there');
  });

  it('links the API types of the app version when they could not be loaded', () => {
    const prompt = buildPluginPrompt('Beep', '19.3.1', null);

    expect(prompt).toContain(
      'https://raw.githubusercontent.com/super-productivity/super-productivity/v19.3.1/packages/plugin-api/src/types.ts',
    );
    expect(prompt).toContain('ask me to paste the file instead of guessing');
    expect(prompt).not.toContain('```ts');
  });
});

describe('parsePluginAnswer', () => {
  it('extracts manifest, plugin.js and index.html from a markdown answer', () => {
    const result = parsePluginAnswer(
      answerOf(
        [
          'json',
          '{ "id": "focus-beep", "name": "Focus Beep", "version": "0.2.0", "manifestVersion": 1, "minSupVersion": "19.0.0", "hooks": [], "permissions": ["http"], "iFrame": false }',
        ],
        ['javascript', 'PluginAPI.log("hi");'],
        ['html', '<p>UI</p>'],
      ),
      '19.3.1',
    );

    expect(result).toEqual({
      files: {
        manifest: {
          id: 'focus-beep',
          name: 'Focus Beep',
          version: '0.2.0',
          manifestVersion: 1,
          minSupVersion: '19.0.0',
          hooks: [],
          permissions: ['http'],
          iFrame: false,
        },
        pluginJs: 'PluginAPI.log("hi");\n',
        indexHtml: '<p>UI</p>\n',
      },
    });
  });

  it('fills fields the AI left out', () => {
    const result = parsePluginAnswer(
      answerOf(['json', '{ "name": "My Cool Plugin!" }'], ['html', '<p>UI</p>']),
      '19.3.1',
    );

    expect(result).toEqual({
      files: {
        manifest: {
          id: 'my-cool-plugin',
          name: 'My Cool Plugin!',
          version: '1.0.0',
          manifestVersion: 1,
          minSupVersion: '19.3.1',
          hooks: [],
          permissions: [],
          iFrame: true,
        },
        pluginJs: undefined,
        indexHtml: '<p>UI</p>\n',
      },
    });
  });

  it('keeps the first block of a kind', () => {
    const result = parsePluginAnswer(
      answerOf(
        ['json', '{ "id": "a", "name": "A" }'],
        ['js', 'first();'],
        ['js', 'usageExample();'],
      ),
      '19.3.1',
    );

    expect('files' in result && result.files.pluginJs).toBe('first();\n');
  });

  it('keeps backticks inside the code instead of ending the block there', () => {
    const result = parsePluginAnswer(
      answerOf(
        ['json', '{ "name": "Md" }'],
        ['js', `const fence = "${FENCE}";\nexport();`],
      ),
      '19.3.1',
    );

    expect('files' in result && result.files.pluginJs).toBe(
      `const fence = "${FENCE}";\nexport();\n`,
    );
  });

  // ChatGPT's copy button drops the language tags of its code blocks
  it('recognizes code blocks without a language tag by their content', () => {
    const answer =
      '### manifest.json\n\n' +
      `${FENCE}\n\n{\n  "id": "siren",\n  "name": "Siren"\n}\n\n${FENCE}\n\n` +
      '### plugin.js\n\n' +
      `${FENCE}\n\nPluginAPI.onReady(async () => {});\n\n${FENCE}\n\n` +
      '### index.html\n\n' +
      `${FENCE}\n<!doctype html>\n<p>Hi</p>\n${FENCE}`;

    const result = parsePluginAnswer(answer, '20.0.0');

    expect('files' in result && result.files.manifest.id).toBe('siren');
    expect('files' in result && result.files.pluginJs).toBe(
      '\nPluginAPI.onReady(async () => {});\n\n',
    );
    expect('files' in result && result.files.indexHtml).toBe(
      '<!doctype html>\n<p>Hi</p>\n',
    );
  });

  it('prefers tagged code blocks over untagged ones, like a file tree', () => {
    const result = parsePluginAnswer(
      answerOf(
        ['', 'siren/\n  plugin.js'],
        ['json', '{ "name": "Siren" }'],
        ['js', 'beep();'],
      ),
      '20.0.0',
    );

    expect('files' in result && result.files.pluginJs).toBe('beep();\n');
  });

  it('ignores untagged blocks that are no plugin code', () => {
    const result = parsePluginAnswer(
      answerOf(
        ['', 'zip -r siren.zip .'],
        ['json', '{ "name": "Siren" }'],
        ['html', '<p>Hi</p>'],
      ),
      '20.0.0',
    );

    expect('files' in result && result.files.pluginJs).toBeUndefined();
  });

  it('reads file names and JSON dialects as language tags', () => {
    const result = parsePluginAnswer(
      answerOf(['manifest.json', '{ "name": "Siren" }'], ['plugin.js', 'beep();']),
      '20.0.0',
    );
    const jsonc = parsePluginAnswer(
      answerOf(['jsonc', '{ "name": "Siren" }'], ['js', 'beep();']),
      '20.0.0',
    );

    expect('files' in result && result.files.pluginJs).toBe('beep();\n');
    expect('files' in jsonc && jsonc.files.manifest.name).toBe('Siren');
  });

  it('ignores a file name comment above the manifest', () => {
    const tagged = parsePluginAnswer(
      answerOf(['json', '// manifest.json\n{ "name": "Siren" }'], ['js', 'beep();']),
      '20.0.0',
    );
    const untagged = parsePluginAnswer(
      answerOf(['', '// manifest.json\n{ "name": "Siren" }'], ['js', 'beep();']),
      '20.0.0',
    );

    expect('files' in tagged && tagged.files.manifest.name).toBe('Siren');
    expect('files' in untagged && untagged.files.manifest.name).toBe('Siren');
  });

  it('reports what is missing', () => {
    expect(parsePluginAnswer('PluginAPI.log("no fences");', '19.3.1')).toEqual({
      errorKey: 'NO_CODE_BLOCKS',
    });
    expect(parsePluginAnswer(answerOf(['js', 'x();']), '19.3.1')).toEqual({
      errorKey: 'NO_MANIFEST',
    });
    expect(
      parsePluginAnswer(answerOf(['json', '{ name: "x" }'], ['js', 'x();']), '19.3.1'),
    ).toEqual({ errorKey: 'INVALID_MANIFEST' });
    expect(
      parsePluginAnswer(
        answerOf(['json', '{ "version": "1.0.0" }'], ['js', 'x();']),
        '19.3.1',
      ),
    ).toEqual({ errorKey: 'NO_NAME' });
    expect(parsePluginAnswer(answerOf(['json', '{ "name": "x" }']), '19.3.1')).toEqual({
      errorKey: 'NO_PLUGIN_CODE',
    });
  });
});

describe('createPluginZipFile', () => {
  it('packs a flat ZIP with only the provided files', async () => {
    const file = await createPluginZipFile({
      manifest: { id: 'focus-beep', name: 'Focus Beep' } as never,
      pluginJs: 'run();',
    });

    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    expect(file.name).toBe('focus-beep.zip');
    expect(Object.keys(entries).sort()).toEqual(['manifest.json', 'plugin.js']);
    expect(JSON.parse(strFromU8(entries['manifest.json']))).toEqual({
      id: 'focus-beep',
      name: 'Focus Beep',
    });
    expect(strFromU8(entries['plugin.js'])).toBe('run();');
  });
});

describe('buildPluginErrorReport', () => {
  it('names the closest real methods for an invented PluginAPI method', () => {
    const report = buildPluginErrorReport(
      'PluginAPI.showSnackbar is not a function',
      '19.3.1',
      'focus-beep',
    );

    expect(report).toContain('PluginAPI.showSnackbar is not a function\n');
    expect(report).toContain('PluginAPI.showSnackbar does not exist. Did you mean:');
    expect(report).toContain('showSnack');
    expect(report).toContain('/v19.3.1/packages/plugin-api/src/types.ts');
  });

  it('passes other errors through without a hint', () => {
    const report = buildPluginErrorReport("Unexpected token '}'", '19.3.1', 'x');

    expect(report).toContain("with this error:\n\nUnexpected token '}'\n\nPlease fix it");
    expect(report).not.toContain('does not exist');
  });

  it('asks to keep the plugin id, so the fix replaces the installed plugin', () => {
    const report = buildPluginErrorReport('boom', '19.3.1', 'focus-beep');

    expect(report).toContain('Keep "id": "focus-beep" in manifest.json');
  });

  it('asks for no id when nothing was installed yet', () => {
    expect(buildPluginErrorReport('boom', '19.3.1', null)).not.toContain('Keep "id"');
  });
});
