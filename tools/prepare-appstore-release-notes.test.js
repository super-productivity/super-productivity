const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EMOJI_PATTERN,
  buildAppStoreReleaseNotes,
  stripEmoji,
  stripOtherPlatformLines,
  toPlainText,
  truncateToMaxChars,
} = require('./prepare-appstore-release-notes');

// Any emoji left in the text is a failed release lane, so assert against the
// very pattern the code strips with: a hand-written subset here would silently
// stop covering a member that a later edit drops from EMOJI_PATTERN. Rebuilt
// without the /g flag, since a global regex reused across `test()` calls carries
// lastIndex between them.
const assertNoEmoji = (text) =>
  assert.doesNotMatch(text, new RegExp(EMOJI_PATTERN.source, 'u'));

test('strips bullets that name a non-Apple platform', () => {
  const markdown = [
    '### Fixes',
    '',
    '- Keep the task list anchored when scheduling (#8533)',
    '- Correct edge-to-edge IME inset on Android (#8508)',
    '- Crisp, flicker-free Linux tray icon (#4905)',
    '- Restore custom title bar on GNOME-X11 (#8485)',
  ].join('\n');

  const dropped = [];
  const result = stripOtherPlatformLines(markdown, (line) => dropped.push(line));

  assert.match(result, /Keep the task list anchored/);
  assert.doesNotMatch(result, /Android/i);
  assert.doesNotMatch(result, /Linux/i);
  assert.doesNotMatch(result, /GNOME/i);
  assert.equal(dropped.length, 3);
});

test('keeps Apple-platform bullets untouched', () => {
  const markdown = [
    '### Fixes',
    '',
    '- Restore custom macOS title bar',
    '- Fix iOS notification sound',
  ].join('\n');

  const result = stripOtherPlatformLines(markdown);

  assert.match(result, /macOS title bar/);
  assert.match(result, /iOS notification sound/);
});

test('strips platform names in headings and intro prose, not only bullets', () => {
  // The AI generation path can emit free-form headings/prose; a platform name
  // anywhere (not just in a bullet) must be removed.
  const markdown = [
    'Big Android battery improvements land this release.',
    '',
    '### Linux',
    '',
    '- Fix the tray icon on Linux',
    '',
    '### Features',
    '',
    '- Add Focus Mode notifications',
  ].join('\n');

  const dropped = [];
  const result = stripOtherPlatformLines(markdown, (line) => dropped.push(line));

  assert.doesNotMatch(result, /android/i);
  assert.doesNotMatch(result, /linux/i);
  assert.match(result, /### Features/);
  assert.match(result, /Add Focus Mode notifications/);
  // intro prose + "### Linux" heading + its bullet.
  assert.equal(dropped.length, 3);
});

test('removes a section heading left empty after stripping', () => {
  const markdown = [
    '### Features',
    '',
    '- Add focus-mode session notifications',
    '',
    '### Fixes',
    '',
    '- Paint window decor behind WebView on Android',
  ].join('\n');

  const result = stripOtherPlatformLines(markdown);

  assert.match(result, /### Features/);
  assert.match(result, /focus-mode session notifications/);
  // The only "Fixes" bullet was Android-specific, so the heading must go too.
  assert.doesNotMatch(result, /### Fixes/);
  assert.doesNotMatch(result, /Android/i);
});

test('does not treat substrings (e.g. snapshot, windowing) as platforms', () => {
  const markdown = [
    '### Fixes',
    '',
    '- Restore a snapshot after a failed sync',
    '- Improve task windowing performance',
  ].join('\n');

  const dropped = [];
  const result = stripOtherPlatformLines(markdown, (line) => dropped.push(line));

  assert.match(result, /Restore a snapshot/);
  assert.match(result, /task windowing/);
  assert.equal(dropped.length, 0);
});

test('end-to-end: produces clean plain-text What’s New without platform names', () => {
  // Mirrors the real build/release-notes.md shape that Apple rejected for 18.12.0.
  const markdown = [
    'For all current downloads, package links, and platform-specific notes: [check the wiki](https://example.com/wiki).',
    '',
    '### Features',
    '',
    '- **focus-mode:** surface session-done + notify on countdown completion (#8475)',
    '- **plainspace:** add integration for shared projects (#8424)',
    '',
    '### Fixes',
    '',
    '- **android:** paint window decor behind WebView to kill keyboard white flash',
    '- **tasks:** preserve manual order within a tag when sorting by tag (#8490)',
  ].join('\n');

  const text = buildAppStoreReleaseNotes(markdown);

  // Footer link and markdown stripped.
  assert.doesNotMatch(text, /check the wiki/i);
  assert.doesNotMatch(text, /\(https?:\/\//);
  assert.doesNotMatch(text, /\*\*/);
  // No third-party platform references survive.
  assert.doesNotMatch(text, /android/i);
  // Apple-relevant content is kept and bulletized (scope prefix retained).
  assert.match(text, /• focus-mode: surface session-done/);
  assert.match(text, /• tasks: preserve manual order within a tag/);
});

test('strips the emoji App Store Connect rejected for 18.20.0', () => {
  // Verbatim shape of the bullet that failed both Apple release lanes: the
  // bug-report issue template prefixes titles with "🚨 " and the squash merge
  // carried it into the commit subject.
  const markdown = [
    '### Other Changes',
    '',
    '- 🚨 Cannot connect to CalDAV Todo issue provider (#9530)',
  ].join('\n');

  const text = buildAppStoreReleaseNotes(markdown);

  assertNoEmoji(text);
  // The note itself survives, with the gap the emoji left closed up.
  assert.match(text, /• Cannot connect to CalDAV Todo issue provider \(#9530\)/);
});

test('strips emoji anywhere in the notes, keeping non-emoji symbols', () => {
  const markdown = [
    '🎉 A big release!',
    '',
    '### ✨ Features',
    '',
    '- Add focus mode 1️⃣ with a 👨‍👩‍👧 group view — see the guide → settings',
    '- Fix the 🇩🇪 locale ✓',
  ].join('\n');

  const text = stripEmoji(markdown);

  assertNoEmoji(text);
  // Punctuation and arrows are not pictographs and must survive untouched.
  assert.match(text, /A big release!/);
  assert.match(text, /### Features/);
  assert.match(text, /Add focus mode 1 with a group view — see the guide → settings/);
  assert.match(text, /Fix the locale ✓/);
});

// Each of these is a separate member of EMOJI_PATTERN whose residue is invisible
// in a diff, so without a case per member a later edit could drop one and leave
// the suite green while shipping a character Apple rejects.
test('strips the invisible emoji parts, leaving no residue', () => {
  const cases = [
    // Skin-tone modifier (\p{Emoji_Modifier}): the base is a pictograph, the
    // modifier is not, so dropping either half leaves a stray character.
    ['- Wave 👋🏽 goodbye to stale caches', /• Wave goodbye to stale caches/],
    // Text-presentation selector (U+FE0E) trailing a dingbat.
    ['- Mark done ✔︎ faster', /• Mark done faster/],
    // Tag sequence (U+E0020-U+E007F): six invisible tag chars after the flag.
    ['- Fix 🏴󠁧󠁢󠁥󠁮󠁧󠁿 English sorting', /• Fix English sorting/],
  ];

  for (const [markdown, expected] of cases) {
    const text = buildAppStoreReleaseNotes(markdown);
    assertNoEmoji(text);
    assert.match(text, expected);
    // Nothing invisible survives either: the line must be plain ASCII prose.
    assert.doesNotMatch(text, /[^\x20-\x7E\n•]/);
  }
});

test('drops a heading whose only bullet was pure emoji decoration', () => {
  const markdown = ['### Features', '', '- 🎉', '', '### Fixes', '', '- Fix sync'].join(
    '\n',
  );

  const text = buildAppStoreReleaseNotes(markdown);

  // No bare "•" bullet and no heading left hanging over nothing.
  assert.doesNotMatch(text, /^\s*[•\-]\s*$/m);
  assert.doesNotMatch(text, /Features/);
  assert.match(text, /Fixes/);
  assert.match(text, /• Fix sync/);
});

test('leaves emoji-free notes byte-for-byte unchanged', () => {
  const markdown = ['### Fixes', '', '- **tasks:** keep the list anchored (#8533)'].join(
    '\n',
  );

  assert.equal(stripEmoji(markdown), markdown);
});

test('toPlainText converts markdown bullets/links/emphasis to plain text', () => {
  const result = toPlainText('### Fixes\n\n- **scope:** fixed a [thing](https://x.y)');
  assert.equal(result, 'Fixes\n\n• scope: fixed a thing');
});

test('truncateToMaxChars never splits a surrogate pair', () => {
  const text = '😀😀😀😀';
  const result = truncateToMaxChars(text, 2);
  // 1 emoji (2 code units) + ellipsis, not a lone surrogate.
  assert.equal(result, '😀…');
  assert.doesNotMatch(result, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});
