const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildStubs, docsUrl, slug, contributingPages } = require('./wiki-stubs');

const DOCS = 'https://super-productivity.com/docs';

test('docsUrl follows the website converter (sp-landing-page scripts/wiki-to-docs.mjs)', () => {
  // the same examples the landing page's tests pin
  assert.equal(docsUrl('Home'), `${DOCS}/`);
  assert.equal(docsUrl('1.00-Quickstarts'), `${DOCS}/tutorials/`);
  assert.equal(docsUrl('1.01-First-Steps'), `${DOCS}/tutorials/first-steps/`);
  assert.equal(
    docsUrl('2.01-Downloads and Install'),
    `${DOCS}/how-to/downloads-and-install/`,
  );
  assert.equal(docsUrl('2.03-Add-Tasks'), `${DOCS}/how-to/add-tasks/`);
  assert.equal(docsUrl('3.01-API'), `${DOCS}/reference/api/`);
  assert.equal(
    docsUrl('4.07a-Tags_Eat-the-Frog'),
    `${DOCS}/explanation/tags-eat-the-frog/`,
  );
  assert.equal(
    docsUrl(
      '2.11-Run-the-Development-Server',
      new Set(['2.11-Run-the-Development-Server']),
    ),
    `${DOCS}/contributing/run-the-development-server/`,
  );
  assert.equal(
    docsUrl('2.18-Contribute-Translations'),
    `${DOCS}/contributing/contribute-translations/`,
  );
});

test('docsUrl leaves out what the website does not publish', () => {
  assert.equal(docsUrl('0.01-Style-Guide'), undefined);
  assert.equal(docsUrl('4.22-Quick-History'), undefined);
  assert.equal(docsUrl('2.10-Configure-Obsidian-for-Wiki-Contributions'), undefined);
  assert.equal(docsUrl('9.01-Future-Section'), undefined);
  assert.equal(docsUrl('_Sidebar'), undefined);
});

test('slug matches github-slugger for wiki names', () => {
  assert.equal(slug('Tags: Ordinal-Priorities'), 'tags-ordinal-priorities');
  assert.equal(slug('Web App vs. Desktop'), 'web-app-vs-desktop');
  assert.equal(slug('Sync WebDAV (Android)'), 'sync-webdav-android');
});

test('contributingPages reads the Contributing group of _Sidebar.md', () => {
  const pages = contributingPages(
    [
      '## [[2.00-How_To]]',
      '### Using Super-Productivity',
      '- [[2.03-Add-Tasks]]',
      '### Contributing to Super-Productivity',
      '- [[2.11-Run-the-Development-Server]]',
      '## [[3.00-Reference]]',
      '- [[3.01-API]]',
    ].join('\n'),
  );
  assert.deepEqual([...pages], ['2.11-Run-the-Development-Server']);
});

test('buildStubs writes a stub per page, keeps assets and replaces the sidebar', () => {
  const wiki = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-src-'));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-out-')), 'stubs');
  const write = (name, body) => fs.writeFileSync(path.join(wiki, name), body);
  try {
    fs.mkdirSync(path.join(wiki, 'assets'));
    fs.writeFileSync(path.join(wiki, 'assets', 'shot.png'), 'png');
    write('_Sidebar.md', '## [[2.00-How_To]]\n### Contributing\n- [[2.11-Dev-Server]]\n');
    write('_Footer.md', 'old footer');
    write('Home.md', '## Start Here\n\nSee [[1.01-First-Steps]].\n');
    write(
      '1.01-First-Steps.md',
      '<!-- description: x -->\n\n# First Steps\n\nWelcome.\n',
    );
    write('2.01-Downloads and Install.md', '# 2.01-Downloads And Install\n\nGet it.\n');
    write('2.11-Dev-Server.md', '# Dev Server\n\nFor contributors.\n');
    write('0.01-Style-Guide.md', '# Style Guide\n\nWiki rules.\n');

    const urls = buildStubs(wiki, out);
    const read = (name) => fs.readFileSync(path.join(out, name), 'utf8');

    assert.equal(urls['1.01-First-Steps.md'], `${DOCS}/tutorials/first-steps/`);
    assert.equal(urls['2.11-Dev-Server.md'], `${DOCS}/contributing/dev-server/`);
    assert.equal(urls['0.01-Style-Guide.md'], null);

    assert.match(read('1.01-First-Steps.md'), /^# First Steps\n/);
    assert.ok(
      read('1.01-First-Steps.md').includes(
        `[First Steps](${DOCS}/tutorials/first-steps/)`,
      ),
    );
    assert.ok(!read('1.01-First-Steps.md').includes('Welcome.'));
    assert.match(read('2.01-Downloads and Install.md'), /^# Downloads And Install\n/);
    assert.ok(
      read('0.01-Style-Guide.md').includes(
        'https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/0.01-Style-Guide.md',
      ),
    );
    assert.ok(read('Home.md').includes(`[Super Productivity documentation](${DOCS}/)`));
    assert.ok(read('_Sidebar.md').includes(`${DOCS}/how-to/`));
    assert.ok(!read('_Footer.md').includes('old footer'));
    assert.equal(fs.readFileSync(path.join(out, 'assets', 'shot.png'), 'utf8'), 'png');
  } finally {
    fs.rmSync(wiki, { recursive: true, force: true });
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
});

test('buildStubs refuses an output that overlaps the wiki, before deleting anything', (t) => {
  // A private parent, so a regression can only delete this test's own files.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-overlap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const wiki = path.join(root, 'wiki');
  fs.mkdirSync(wiki);
  fs.writeFileSync(path.join(wiki, 'Home.md'), '# Home\n');
  for (const out of [wiki, `${wiki}/`, root, path.join(wiki, 'stubs')]) {
    assert.throws(() => buildStubs(wiki, out), /overlap/);
  }
  assert.deepEqual(fs.readdirSync(wiki), ['Home.md']);
});

test('buildStubs sees through symlinks and names that start with ..', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dotWiki = path.join(root, '..wiki');
  fs.mkdirSync(dotWiki);
  fs.writeFileSync(path.join(dotWiki, 'Home.md'), '# Home\n');
  assert.throws(() => buildStubs(dotWiki, root), /overlap/);

  fs.symlinkSync(root, path.join(root, 'alias'), 'junction');
  assert.throws(() => buildStubs(dotWiki, path.join(root, 'alias', '..wiki')), /overlap/);
  assert.throws(
    () => buildStubs(dotWiki, path.join(root, 'alias', '..wiki', 'new')),
    /overlap/,
  );
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  const sourceLink = path.join(out, 'source');
  fs.symlinkSync(dotWiki, sourceLink, 'junction');
  assert.throws(() => buildStubs(sourceLink, out), /overlap/);
  const outputLink = path.join(dotWiki, 'output');
  fs.symlinkSync(out, outputLink, 'junction');
  assert.throws(() => buildStubs(dotWiki, outputLink), /overlap/);
  fs.unlinkSync(outputLink);
  assert.deepEqual(fs.readdirSync(dotWiki), ['Home.md']);
});

test('buildStubs validates the source before replacing the output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-input-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'keep.md'), 'existing output');
  const file = path.join(root, 'file');
  fs.writeFileSync(file, '');
  for (const src of [path.join(root, 'missing'), file]) {
    assert.throws(() => buildStubs(src, out));
    assert.equal(fs.readFileSync(path.join(out, 'keep.md'), 'utf8'), 'existing output');
  }
});

test('every page in docs/wiki gets a stub', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-real-'));
  try {
    const wikiDir = path.join(__dirname, '..', 'docs', 'wiki');
    const urls = buildStubs(wikiDir, out);
    const pages = fs
      .readdirSync(wikiDir)
      .filter((name) => /\.md$/i.test(name) && !name.startsWith('_'));
    assert.deepEqual(Object.keys(urls).sort(), pages.sort());
    for (const page of pages) assert.ok(fs.existsSync(path.join(out, page)), page);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
