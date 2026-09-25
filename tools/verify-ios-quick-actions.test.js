'use strict';

// Binds the three places an iOS Home Screen quick action has to agree:
//
//   Info.plist  ──url──▶  AppDelegate.swift  ──appUrlOpen──▶  parse-app-uri-quick-action.ts
//
// Nothing else couples them. A shortcut item pointing at a host the parser does
// not know, or a plist that writes a userInfo key AppDelegate does not read,
// builds and ships fine and simply does nothing when tapped — there is no
// runtime error to notice. The web side is covered by Karma specs, but those
// run in a browser and cannot read `ios/`, so the cross-boundary half lives here.
//
// Regex rather than a plist parser: the project forbids adding dependencies, and
// `plutil` is macOS-only while CI runs on Linux. The file is a small, hand-
// maintained XML plist, so the shapes matched below are the shapes it has.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const readRoot = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const INFO_PLIST = readRoot('ios', 'App', 'App', 'Info.plist');
const APP_DELEGATE = readRoot('ios', 'App', 'App', 'AppDelegate.swift');
const PARSER = readRoot(
  'src',
  'app',
  'core',
  'app-uri-actions',
  'parse-app-uri-quick-action.ts',
);

/** The `<array>` body that follows a given `<key>`. */
const plistArrayBody = (key) => {
  const match = INFO_PLIST.match(
    new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`),
  );
  assert.ok(match, `${key} not found as an <array> in Info.plist`);
  return match[1];
};

/** The `<string>` directly following a given `<key>` within `scope`. */
const stringFor = (scope, key) => {
  const match = scope.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1] : undefined;
};

/**
 * Splits an array body into its top-level `<dict>` entries. Depth-aware, because
 * every shortcut item nests a second `<dict>` for its user info — a plain split
 * on `<dict>` cuts each item in half.
 */
const topLevelDicts = (body) => {
  const items = [];
  let depth = 0;
  let start = 0;
  for (const match of body.matchAll(/<\/?dict>/g)) {
    if (match[0] === '<dict>') {
      if (depth === 0) {
        start = match.index + match[0].length;
      }
      depth++;
    } else {
      depth--;
      if (depth === 0) {
        items.push(body.slice(start, match.index));
      }
    }
  }
  assert.equal(depth, 0, 'unbalanced <dict> tags in Info.plist');
  return items;
};

const SHORTCUT_ITEMS = topLevelDicts(plistArrayBody('UIApplicationShortcutItems'));

const URL_SCHEMES = [
  ...plistArrayBody('CFBundleURLSchemes').matchAll(/<string>([^<]*)<\/string>/g),
].map((m) => m[1]);

const QUICK_ACTION_HOSTS = (() => {
  const match = PARSER.match(/QUICK_ACTION_HOSTS = \[([^\]]*)\]/);
  assert.ok(match, 'QUICK_ACTION_HOSTS not found as an array literal in the parser');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

// The key AppDelegate reads out of UIApplicationShortcutItemUserInfo. Derived
// from the Swift source so a rename there fails here rather than at runtime.
const USER_INFO_KEY = (() => {
  const match = APP_DELEGATE.match(/shortcutItem\.userInfo\?\["([^"]+)"\]/);
  assert.ok(
    match,
    'AppDelegate.swift no longer reads a key from shortcutItem.userInfo — the quick actions are dead',
  );
  return match[1];
})();

const itemUrl = (item) => {
  const match = item.match(
    new RegExp(`<key>${USER_INFO_KEY}</key>\\s*<string>([^<]*)</string>`),
  );
  return match ? match[1] : undefined;
};

test('Info.plist declares quick actions', () => {
  assert.ok(SHORTCUT_ITEMS.length > 0, 'no UIApplicationShortcutItems entries');
  // iOS shows at most four; a fifth would be silently invisible.
  assert.ok(
    SHORTCUT_ITEMS.length <= 4,
    `iOS displays at most 4 quick actions, found ${SHORTCUT_ITEMS.length}`,
  );
});

test('every quick action is fully specified', () => {
  const types = new Set();
  SHORTCUT_ITEMS.forEach((item, index) => {
    const type = stringFor(item, 'UIApplicationShortcutItemType');
    assert.ok(type, `item ${index} has no UIApplicationShortcutItemType`);
    assert.ok(!types.has(type), `duplicate UIApplicationShortcutItemType ${type}`);
    types.add(type);

    assert.ok(stringFor(item, 'UIApplicationShortcutItemTitle'), `${type} has no title`);
    // Without an icon the row renders blank rather than falling back.
    assert.match(
      item,
      /<key>UIApplicationShortcutItemIcon(SymbolName|Type|File)<\/key>/,
      `${type} declares no icon`,
    );
  });
});

test('every quick action URL uses a scheme the app registered', () => {
  // A URL on an unregistered scheme never reaches the app at all.
  SHORTCUT_ITEMS.forEach((item) => {
    const url = itemUrl(item);
    assert.ok(
      url,
      `a shortcut item has no "${USER_INFO_KEY}" in UIApplicationShortcutItemUserInfo — AppDelegate reads that key`,
    );
    const scheme = url.split('://')[0];
    assert.ok(
      URL_SCHEMES.includes(scheme),
      `${url} uses scheme "${scheme}", which is not in CFBundleURLSchemes (${URL_SCHEMES.join(', ')})`,
    );
  });
});

test('every quick action URL targets a host the web side parses', () => {
  SHORTCUT_ITEMS.forEach((item) => {
    const url = itemUrl(item);
    const host = url.split('://')[1].split(/[/?#]/)[0];
    assert.ok(
      QUICK_ACTION_HOSTS.includes(host),
      `${url} targets host "${host}", which parse-app-uri-quick-action.ts does not handle — tapping it would do nothing`,
    );
    // Lowercase is what the parser normalizes to; anything else is a typo that
    // only happens to work.
    assert.equal(host, host.toLowerCase(), `${url} should use a lowercase host`);
  });
});

test('AppDelegate handles the quick action callback', () => {
  // Without this the plist entries render but nothing happens on tap.
  assert.match(
    APP_DELEGATE,
    /performActionFor shortcutItem: UIApplicationShortcutItem/,
    'AppDelegate.swift no longer implements application(_:performActionFor:completionHandler:)',
  );
  // A cold launch is delivered through performActionFor *only* while
  // didFinishLaunchingWithOptions keeps returning true. Returning false there
  // suppresses the callback, and opening the URL in its place posts
  // .capacitorOpenURL before the App plugin observes it — see the comment on
  // performActionFor in AppDelegate.swift.
  assert.doesNotMatch(
    APP_DELEGATE,
    /launchOptions\??\[\.shortcutItem\]/,
    'handling the launch shortcut in didFinishLaunchingWithOptions drops it on a cold start',
  );
});
