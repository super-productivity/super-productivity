#!/usr/bin/env node
/**
 * Run on every Android PR by android/run-android-checks.sh, against the
 * playR8Test mapping — the one minified build CI produces while release keeps
 * minifyEnabled false (see android/app/build.gradle for why). build-android.yml
 * also runs it against the release mappings, which do not exist today, so the
 * re-land of release minification arms that second call automatically.
 *
 * What it was for: a minified release that drops a @JavascriptInterface method
 * or a WorkManager worker builds and installs fine — the bridge call just goes
 * nowhere and the worker never runs. Both only surface on a device, so this
 * reads the mapping R8 emits and fails the build instead.
 *
 * Expectations come from the Kotlin sources, not a hardcoded list, so adding a
 * bridge method or a worker keeps the check honest without touching this file.
 *
 * Checking the mapping is NOT sufficient on its own: it cannot see a build that
 * dies in onCreate — #9785 passed this check and still killed the process. The
 * launch smoke in run-android-checks.sh covers that half, and this covers the
 * half a launch cannot reach: a worker nothing enqueues, a bridge method the
 * smoke page never calls.
 *
 * Usage: node tools/verify-r8-mapping.mjs <mapping.txt> [androidSrcRoot]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [mappingPath, srcRoot = 'android/app/src/main/java'] = process.argv.slice(2);
if (!mappingPath) {
  console.error('usage: node tools/verify-r8-mapping.mjs <mapping.txt> [androidSrcRoot]');
  process.exit(2);
}

const kotlinFiles = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? kotlinFiles(p) : p.endsWith('.kt') ? [p] : [];
  });

/**
 * Blanks out Kotlin comments and string literals, preserving length and newlines
 * so the scans below still see the original line structure.
 *
 * Without this a KDoc mentioning `@JavascriptInterface`, or a string containing
 * `class FooWorker(...) : CoroutineWorker`, becomes an expectation R8 is free to
 * rename — a spurious release-blocking failure.
 */
const stripCommentsAndStrings = (text) => {
  const out = [...text];
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl;
      blank(i, end);
      i = end;
    } else if (text.startsWith('/*', i)) {
      // Kotlin block comments (KDoc included) nest.
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text.startsWith('/*', j)) {
          depth++;
          j += 2;
        } else if (text.startsWith('*/', j)) {
          depth--;
          j += 2;
        } else j++;
      }
      blank(i, j);
      i = j;
    } else if (text.startsWith('"""', i)) {
      const close = text.indexOf('"""', i + 3);
      const end = close < 0 ? text.length : close + 3;
      blank(i, end);
      i = end;
    } else if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote && text[j] !== '\n') {
        j += text[j] === '\\' ? 2 : 1;
      }
      const end = Math.min(j + 1, text.length);
      blank(i, end);
      i = end;
    } else i++;
  }
  return out.join('');
};

const sources = kotlinFiles(srcRoot).map((path) => ({
  path,
  text: stripCommentsAndStrings(readFileSync(path, 'utf8')),
}));

/** `com.example` + `class Foo` -> `com.example.Foo`, for the mapping's left-hand side. */
const fqcn = (text, name) => `${/^package\s+([\w.]+)/m.exec(text)?.[1] ?? ''}.${name}`;

// --- expectations from source ------------------------------------------------

const bridge = sources.find((s) => s.path.endsWith('JavaScriptInterface.kt'));
if (!bridge) throw new Error('JavaScriptInterface.kt not found under ' + srcRoot);
const bridgeClass = fqcn(bridge.text, 'JavaScriptInterface');

/**
 * `@JavascriptInterface` starting its own line, then only further annotations or
 * function modifiers before `fun name`. Anchoring stops a stray mention from
 * being attributed to whatever `fun` happens to follow it.
 */
const FUN_MODIFIER =
  'public|private|protected|internal|open|final|abstract|override|inline|suspend|external|tailrec|operator|infix|synchronized|expect|actual';
const BRIDGE_METHOD_RE = new RegExp(
  String.raw`^[ \t]*@JavascriptInterface\b` +
    String.raw`(?:\s*(?:@[\w.]+(?:\([^)]*\))?|(?:${FUN_MODIFIER})\b))*` +
    String.raw`\s*\bfun\s+(\w+)`,
  'gm',
);
const bridgeMethods = [...bridge.text.matchAll(BRIDGE_METHOD_RE)].map((m) => m[1]);
const bridgeAnnotations = (bridge.text.match(/@JavascriptInterface\b/g) ?? []).length;

const workers = sources.flatMap(({ text }) =>
  [
    ...text.matchAll(
      /class\s+(\w+)\s*\([^)]*\)\s*:\s*(?:CoroutineWorker|ListenableWorker|Worker)\b/gs,
    ),
  ].map((m) => fqcn(text, m[1])),
);

// --- what R8 actually emitted ------------------------------------------------

const mapping = readFileSync(mappingPath, 'utf8').split('\n');
const classLine = (name) => mapping.find((l) => l.startsWith(`${name} ->`));

const bodyOf = (name) => {
  const i = mapping.findIndex((l) => l.startsWith(`${name} ->`));
  if (i < 0) return null;
  const out = [];
  for (const line of mapping.slice(i + 1)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) break;
    out.push(line);
  }
  return out;
};

const errors = [];

const bridgeBody = bodyOf(bridgeClass);
if (!bridgeBody) {
  errors.push(
    `${bridgeClass} is absent from the mapping — R8 removed the WebView bridge entirely.`,
  );
} else {
  const unrenamed = new Set(
    bridgeBody
      .map((l) =>
        /^\s+(?:\d+:\d+:)?[\w.$[\]<>]+ ([\w<>$]+)\([^)]*\)(?::\d+)*\s*->\s*(\S+)$/.exec(
          l,
        ),
      )
      .filter((m) => m && m[1] === m[2])
      .map((m) => m[1]),
  );
  for (const name of bridgeMethods) {
    if (!unrenamed.has(name)) {
      errors.push(
        `@JavascriptInterface ${name}() was renamed or stripped — the JS call would go nowhere.`,
      );
    }
  }
}

for (const worker of workers) {
  const line = classLine(worker);
  if (!line)
    errors.push(
      `${worker} was stripped — WorkManager instantiates it reflectively by name.`,
    );
  else if (!line.startsWith(`${worker} -> ${worker}:`))
    errors.push(`${worker} was renamed to ${line.split('-> ')[1]}.`);
}

// --- report ------------------------------------------------------------------

if (errors.length) {
  console.error('R8 mapping check FAILED:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  console.error('\nFix the keep rules in android/app/proguard-rules.pro.');
  process.exit(1);
}

if (!bridgeMethods.length || !workers.length) {
  console.error(
    `R8 mapping check FAILED: parsed ${bridgeMethods.length} bridge methods and ${workers.length} workers ` +
      'from source. Zero means this check is silently passing — fix the source parsing.',
  );
  process.exit(1);
}

// Every real annotation must have produced an expectation, or the anchored
// pattern above quietly stopped covering part of the bridge.
if (bridgeMethods.length !== bridgeAnnotations) {
  console.error(
    `R8 mapping check FAILED: ${bridgeAnnotations} @JavascriptInterface annotations in source but only ` +
      `${bridgeMethods.length} were parsed as methods — the rest went unchecked. Fix the source parsing.`,
  );
  process.exit(1);
}

console.log(
  `R8 mapping OK: ${bridgeMethods.length} bridge methods un-renamed, ${workers.length} worker(s) kept.`,
);
