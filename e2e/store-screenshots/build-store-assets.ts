/**
 * Per-store layout builder.
 *
 * Reads master captures from `dist/screenshots/_master/<viewport>/<locale>/<theme>/<scenario>/<name>.png`
 * and writes per-store directory layouts to `dist/screenshots/`.
 *
 * Captures are made at each store's native pixel size (see playwright.store-screenshots.config.ts),
 * so this is mostly rename + copy — no resizing. Stores with a per-file byte
 * cap (`maxBytes` in STORE_RULES; currently Snap @ 2 MB) get re-encoded as
 * JPEG until they fit; everything else stays lossless PNG.
 *
 * Run: npm run screenshots:build
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
  LOCALES,
  MASTER_DIR_ELECTRON,
  MASTER_DIR_WEB,
  SCREENSHOTS_OUT_DIR,
  STORE_RULES,
  type StoreRule,
} from './matrix';

const OUT_DIR = SCREENSHOTS_OUT_DIR;

const masterDirFor = (which: 'web' | 'electron'): string =>
  which === 'electron' ? MASTER_DIR_ELECTRON : MASTER_DIR_WEB;

type ScenarioFile = { scenario: string; file: string; theme: string; absPath: string };

/** Strip leading `(mobile|desktop)-NN-` so output names don't double up on the index. */
const cleanScenarioLabel = (scenario: string): string =>
  scenario.replace(/^(?:(?:mobile|desktop)-)?\d+-/, '');

/**
 * Each scenario locks one theme. List all (theme × scenario) captures present
 * for a given viewport+locale, sorted by scenario name (which encodes slot order
 * via the `<platform>-NN-` prefix).
 */
const listScenariosForVariant = (
  viewport: string,
  locale: string,
  masterRoot: string,
): ScenarioFile[] => {
  const out: ScenarioFile[] = [];
  const localeDir = path.join(masterRoot, viewport, locale);
  if (!fs.existsSync(localeDir)) return out;
  const themes = fs.readdirSync(localeDir).filter((t) => {
    try {
      return fs.statSync(path.join(localeDir, t)).isDirectory();
    } catch {
      return false;
    }
  });
  // Index by scenario so we can sort across themes uniformly.
  const all: ScenarioFile[] = [];
  for (const theme of themes) {
    const themeDir = path.join(localeDir, theme);
    for (const scenario of fs.readdirSync(themeDir)) {
      const dir = path.join(themeDir, scenario);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.png')) continue;
        all.push({ scenario, file, theme, absPath: path.join(dir, file) });
      }
    }
  }
  all.sort((a, b) => a.scenario.localeCompare(b.scenario));
  out.push(...all);
  return out;
};

/**
 * Copy `src` to `target`, then enforce `maxBytes` if set. PNGs that already
 * fit go through unchanged. PNGs that exceed the cap are re-encoded as JPEG
 * at stepped-down quality until they fit; the .png target is replaced with a
 * .jpg sibling. Returns the actual path written.
 */
const writeWithCap = async (
  src: string,
  target: string,
  maxBytes?: number,
): Promise<string> => {
  fs.copyFileSync(src, target);
  if (!maxBytes) return target;
  const initialSize = fs.statSync(target).size;
  if (initialSize <= maxBytes) return target;

  const jpgTarget = target.replace(/\.png$/i, '.jpg');
  const buf = fs.readFileSync(src);
  // Step down quality 90 → 60. If even q60 exceeds the cap (vanishingly rare
  // on screenshots that are mostly UI), bail loudly so the operator notices.
  for (const quality of [90, 85, 80, 75, 70, 65, 60]) {
    const out = await sharp(buf)
      .jpeg({ quality, mozjpeg: true, progressive: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
    if (out.byteLength <= maxBytes) {
      fs.writeFileSync(jpgTarget, out);
      if (jpgTarget !== target) fs.rmSync(target);
      return jpgTarget;
    }
  }
  throw new Error(
    `${path.basename(target)} still > ${maxBytes} bytes at JPEG quality 60 — capture too large`,
  );
};

const writeFastlanePath = async (
  locale: string,
  bucket: NonNullable<StoreRule['fastlaneBucket']>,
  index: number,
  src: string,
  maxBytes?: number,
): Promise<string> => {
  const bucketDir = `${bucket}Screenshots`;
  const dir = path.join(
    OUT_DIR,
    'fdroid',
    'fastlane',
    'metadata',
    'android',
    locale,
    'images',
    bucketDir,
  );
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${index + 1}.png`);
  return writeWithCap(src, target, maxBytes);
};

const writePerLocale = async (
  store: string,
  locale: string,
  index: number,
  scenario: string,
  src: string,
  maxBytes?: number,
): Promise<string> => {
  const dir = path.join(OUT_DIR, store, locale);
  fs.mkdirSync(dir, { recursive: true });
  const num = `${index + 1}`.padStart(2, '0');
  const target = path.join(dir, `${num}-${cleanScenarioLabel(scenario)}.png`);
  return writeWithCap(src, target, maxBytes);
};

const writeGlobal = async (
  store: string,
  index: number,
  scenario: string,
  src: string,
  maxBytes?: number,
): Promise<string> => {
  const dir = path.join(OUT_DIR, store);
  fs.mkdirSync(dir, { recursive: true });
  const num = `${index + 1}`.padStart(2, '0');
  const target = path.join(dir, `${num}-${cleanScenarioLabel(scenario)}.png`);
  return writeWithCap(src, target, maxBytes);
};

const buildOneRule = async (
  rule: StoreRule,
): Promise<{ written: number; skipped: number }> => {
  let written = 0;
  let skipped = 0;
  const masterRoot = masterDirFor(rule.masterDir ?? 'web');

  for (const locale of LOCALES) {
    const scenarios = listScenariosForVariant(rule.source, locale, masterRoot);
    if (scenarios.length === 0) {
      skipped += 1;
      continue;
    }
    const limited = rule.maxCount ? scenarios.slice(0, rule.maxCount) : scenarios;
    for (let i = 0; i < limited.length; i += 1) {
      const s = limited[i];
      if (rule.localeLayout === 'fastlane' && rule.fastlaneBucket) {
        await writeFastlanePath(locale, rule.fastlaneBucket, i, s.absPath, rule.maxBytes);
      } else if (rule.localeLayout === 'global') {
        if (locale !== LOCALES[0]) continue; // Snap / Flathub are single-gallery
        await writeGlobal(rule.store, i, s.scenario, s.absPath, rule.maxBytes);
      } else {
        await writePerLocale(rule.store, locale, i, s.scenario, s.absPath, rule.maxBytes);
      }
      written += 1;
    }
  }
  return { written, skipped };
};

const cleanDerivedOutput = (): void => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const preserved = new Set([
    path.basename(MASTER_DIR_WEB),
    path.basename(MASTER_DIR_ELECTRON),
  ]);
  for (const entry of fs.readdirSync(OUT_DIR)) {
    if (preserved.has(entry)) continue;
    fs.rmSync(path.join(OUT_DIR, entry), { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  if (!fs.existsSync(MASTER_DIR_WEB) && !fs.existsSync(MASTER_DIR_ELECTRON)) {
    console.error('No master captures found.');
    console.error(
      `Looked in:\n  ${MASTER_DIR_WEB}\n  ${MASTER_DIR_ELECTRON}\nRun \`npm run screenshots:capture\` (or :electron) first.`,
    );
    process.exit(1);
  }

  cleanDerivedOutput();

  let total = 0;
  for (const rule of STORE_RULES) {
    const res = await buildOneRule(rule);
    total += res.written;
    const tag = rule.fastlaneBucket ? `${rule.store}/${rule.fastlaneBucket}` : rule.store;
    const src = `${rule.masterDir ?? 'web'}:${rule.source}`;
    console.log(
      `${tag.padEnd(28)} source=${src.padEnd(24)} wrote=${res.written}${
        res.skipped ? ` (${res.skipped} variants missing)` : ''
      }`,
    );
  }
  console.log(`\nTotal files written: ${total}`);
  const previewPath = writePreviewSheet();
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Preview: ${previewPath}`);
  openFolder(OUT_DIR);
};

type PreviewEntry = { relPath: string; group: string; label: string };

/** Walk OUT_DIR and collect every emitted png/jpg as a preview entry. */
const collectPreviewEntries = (root: string, base = ''): PreviewEntry[] => {
  const out: PreviewEntry[] = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root)) {
    const absPath = path.join(root, entry);
    const relPath = base ? `${base}/${entry}` : entry;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      out.push(...collectPreviewEntries(absPath, relPath));
      continue;
    }
    if (!/\.(png|jpe?g)$/i.test(entry)) continue;
    // Group is everything up to the last directory separator; label is filename.
    const lastSlash = relPath.lastIndexOf('/');
    const group = lastSlash === -1 ? '(root)' : relPath.slice(0, lastSlash);
    out.push({ relPath, group, label: entry });
  }
  return out;
};

/**
 * Emit `_preview.html` — a single-page contact sheet of every capture in
 * `dist/screenshots/`, grouped by store + locale. Open it in a browser to
 * eyeball the whole batch instead of drilling through ~14 subfolders.
 */
const writePreviewSheet = (): string => {
  const entries = collectPreviewEntries(OUT_DIR).sort((a, b) =>
    a.relPath.localeCompare(b.relPath),
  );
  const grouped = new Map<string, PreviewEntry[]>();
  for (const e of entries) {
    const list = grouped.get(e.group) ?? [];
    list.push(e);
    grouped.set(e.group, list);
  }
  const escape = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  const renderCard = (it: PreviewEntry): string => {
    const href = escape(it.relPath);
    const label = escape(it.label);
    return [
      `<a class="card" href="${href}" target="_blank" rel="noopener">`,
      `<img loading="lazy" src="${href}" alt="${label}">`,
      `<div class="label">${label}</div>`,
      `</a>`,
    ].join('');
  };
  const sections = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => {
      const cards = items.map(renderCard).join('');
      const heading =
        `<h2>${escape(group)} ` + `<span class="count">${items.length}</span></h2>`;
      return `<section>${heading}<div class="grid">${cards}</div></section>`;
    })
    .join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Screenshots preview</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #111; color: #eee; margin: 0; padding: 24px; }
h1 { margin: 0 0 4px; font-size: 22px; }
.summary { color: #888; font-size: 13px; margin-bottom: 24px; }
h2 {
  font-size: 14px; font-weight: 600; color: #ccc; margin: 28px 0 12px;
  letter-spacing: 0.02em; text-transform: uppercase;
  border-bottom: 1px solid #2a2a2a; padding-bottom: 6px;
}
h2 .count { color: #666; font-weight: 400; margin-left: 8px; }
.grid {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.card {
  display: block; background: #1a1a1a; border: 1px solid #262626;
  border-radius: 8px; overflow: hidden; text-decoration: none; color: inherit;
  transition: transform 0.12s, border-color 0.12s;
}
.card:hover { transform: translateY(-2px); border-color: #444; }
.card img { display: block; width: 100%; height: 280px; object-fit: contain; background: #000; }
.label { padding: 8px 10px; font-size: 12px; color: #aaa; word-break: break-all; }
</style>
</head><body>
<h1>Store screenshots preview</h1>
<div class="summary">${entries.length} captures across ${grouped.size} groups · ${OUT_DIR}</div>
${sections}
</body></html>
`;
  const target = path.join(OUT_DIR, '_preview.html');
  fs.writeFileSync(target, html, 'utf-8');
  return target;
};

/**
 * Reveal `dir` in the OS file manager. Detached + unref'd so the build script
 * exits immediately. Silently no-ops on headless / CI environments where the
 * platform opener isn't available. Opt out with `SP_SCREENSHOTS_NO_OPEN=1`.
 */
const openFolder = (dir: string): void => {
  if (process.env.SP_SCREENSHOTS_NO_OPEN) return;
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const cmd = isWin ? 'cmd' : isMac ? 'open' : 'xdg-open';
  const args = isWin ? ['/c', 'start', '', dir] : [dir];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* opener not available on this system */
    });
    child.unref();
  } catch {
    /* ignore */
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
