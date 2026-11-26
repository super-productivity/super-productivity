'use strict';

// Binds the places an Android launcher shortcut has to agree:
//
//   res/xml/shortcuts.xml  ──url──▶  AppShortcutActivity  ──appUrlOpen──▶  parse-app-uri-quick-action.ts
//            │                                 │
//            └─ @string/… in strings.xml       └─ declared in AndroidManifest.xml
//
// Like the iOS quick actions, a shortcut pointing at an unknown host, a missing
// string, or an undeclared target class builds and ships fine and does nothing
// when tapped (or is silently dropped by the launcher). Karma specs cannot read
// `android/`, so this lives here.
//
// Regex rather than an XML parser: the project forbids adding dependencies, and
// these files are small and hand-maintained.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const readRoot = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const RES = ['android', 'app', 'src', 'main', 'res'];

const SCHEME = 'com.super-productivity.app';
const PACKAGE = 'com.superproductivity.superproductivity';
const TRAMPOLINE = `${PACKAGE}.AppShortcutActivity`;

const SHORTCUTS = readRoot(...RES, 'xml', 'shortcuts.xml');
const STRINGS = readRoot(...RES, 'values', 'strings.xml');
const MANIFEST = readRoot('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const BUILD_GRADLE = readRoot('android', 'app', 'build.gradle');
const QUICK_PARSER = readRoot(
  'src',
  'app',
  'core',
  'app-uri-actions',
  'parse-app-uri-quick-action.ts',
);

const QUICK_ACTION_HOSTS = (() => {
  const match = QUICK_PARSER.match(/QUICK_ACTION_HOSTS = \[([^\]]*)\]/);
  assert.ok(match, 'QUICK_ACTION_HOSTS not found as an array literal in the parser');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

const ITEMS = [...SHORTCUTS.matchAll(/<shortcut\b([\s\S]*?)<\/shortcut>/g)].map(
  (m) => m[1],
);
const attr = (scope, name) => {
  const match = scope.match(new RegExp(`android:${name}="([^"]*)"`));
  return match ? match[1] : undefined;
};
const intentOf = (item) => {
  const match = item.match(/<intent\b([^>]*)\/>/);
  assert.ok(match, 'shortcut has no self-closing <intent> element');
  return match[1];
};

test('shortcuts.xml declares shortcuts', () => {
  assert.ok(ITEMS.length > 0, 'no <shortcut> entries');
  // Launchers show at most four static + dynamic shortcuts in the long-press menu.
  assert.ok(ITEMS.length <= 4, `at most 4 shortcuts are shown, found ${ITEMS.length}`);
});

test('every shortcut is fully specified', () => {
  const ids = new Set();
  ITEMS.forEach((item, index) => {
    const id = attr(item, 'shortcutId');
    assert.ok(id, `shortcut ${index} has no shortcutId`);
    assert.ok(!ids.has(id), `duplicate shortcutId ${id}`);
    ids.add(id);

    const label = attr(item, 'shortcutShortLabel');
    const labelName = label && label.match(/^@string\/(\w+)$/)?.[1];
    assert.ok(labelName, `${id}: shortcutShortLabel must be a @string resource`);
    assert.match(
      STRINGS,
      new RegExp(`<string name="${labelName}">[^<]+</string>`),
      `${id}: @string/${labelName} is missing from values/strings.xml`,
    );

    const icon = attr(item, 'icon');
    const iconName = icon && icon.match(/^@drawable\/(\w+)$/)?.[1];
    assert.ok(iconName, `${id} declares no @drawable icon`);
    // API 25 has no adaptive icons, so a drawable-anydpi-v26-only icon would
    // leave the shortcut without one there.
    assert.ok(
      existsSync(join(ROOT, ...RES, 'drawable', `${iconName}.xml`)),
      `${id}: drawable/${iconName}.xml (pre-adaptive fallback) is missing`,
    );
  });
});

test('every shortcut URL targets a host the web side parses', () => {
  ITEMS.forEach((item) => {
    const intent = intentOf(item);
    assert.equal(attr(intent, 'action'), 'android.intent.action.VIEW');
    const url = attr(intent, 'data');
    assert.ok(url, `${attr(item, 'shortcutId')} has no intent data URL`);
    const [scheme, rest] = url.split('://');
    assert.equal(scheme, SCHEME, `${url} uses the wrong scheme`);
    const host = rest.split(/[/?#]/)[0];
    assert.ok(
      QUICK_ACTION_HOSTS.includes(host),
      `${url} targets host "${host}", which parse-app-uri-quick-action.ts does not handle`,
    );
  });
});

test('every shortcut launches through the trampoline, not the main activity', () => {
  // Static shortcuts always carry FLAG_ACTIVITY_CLEAR_TASK; targeting
  // CapacitorMainActivity directly would reload a running app — see
  // AppShortcutActivity.kt.
  ITEMS.forEach((item) => {
    const intent = intentOf(item);
    assert.equal(attr(intent, 'targetClass'), TRAMPOLINE);
    assert.equal(attr(intent, 'targetPackage'), PACKAGE);
  });
  // targetPackage must be the applicationId, and shortcuts.xml cannot use a
  // placeholder for it.
  assert.match(BUILD_GRADLE, new RegExp(`applicationId "${PACKAGE}"`));
});

test('the manifest wires the shortcuts up', () => {
  assert.match(
    MANIFEST,
    /<activity\s+android:name="\.AppShortcutActivity"[^>]*android:taskAffinity=""/,
    'AppShortcutActivity must be declared with an empty taskAffinity',
  );
  // The meta-data is only read from the MAIN/LAUNCHER activity.
  const launcher = MANIFEST.match(
    /<activity\b(?:(?!<\/activity>)[\s\S])*?android\.intent\.category\.LAUNCHER[\s\S]*?<\/activity>/,
  );
  assert.ok(launcher, 'no launcher activity in the manifest');
  assert.match(
    launcher[0],
    /<meta-data\s+android:name="android\.app\.shortcuts"\s+android:resource="@xml\/shortcuts"\s*\/>/,
    'android.app.shortcuts meta-data must be on the launcher activity',
  );
});
