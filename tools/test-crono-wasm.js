#!/usr/bin/env node
/**
 * Corpus-driven verification of the English→cron pipeline.
 *
 * For every phrase in the crono-eng canonical corpus it asserts:
 *   1. the committed WASM asset translates the phrase to the corpus's cron;
 *   2. cron-parser can parse that cron (occurrence engine compatibility);
 *   3. cronstrue can humanize that cron (preview compatibility).
 *
 * Usage:  node tools/test-crono-wasm.js
 * Env:    CRONO_ENG_DIR (defaults to ../crono-eng)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cronoDir =
  process.env.CRONO_ENG_DIR || path.resolve(__dirname, '..', '..', 'crono-eng');
const wasmPath = path.resolve(__dirname, '..', 'src', 'assets', 'crono-eng.wasm');
const exePath = path.join(cronoDir, 'zig-out', 'bin', 'crono_eng.exe');

const { CronExpressionParser } = require('cron-parser');
const cronstrue = require('cronstrue');

const RESET = '\x1b[0m';
const RED = (s) => `\x1b[31m${s}${RESET}`;
const GREEN = (s) => `\x1b[32m${s}${RESET}`;
const YEL = (s) => `\x1b[33m${s}${RESET}`;

function parseCorpus() {
  const dump = execFileSync(exePath, ['--dump-corpus'], { encoding: 'utf8' });
  const lines = dump.split(/\r?\n/);
  const pairs = [];
  let phrase = null;
  for (const line of lines) {
    const mp = line.match(/^\s*\+?\s*phrase:\s*"(.*)"\s*$/);
    const me = line.match(/^\s*expr:\s*"(.*)"\s*$/);
    if (mp) phrase = mp[1];
    else if (me && phrase != null) {
      pairs.push({ phrase, expr: me[1] });
      phrase = null;
    }
  }
  return pairs;
}

async function loadWasm() {
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return (s) => {
    const b = enc.encode(s);
    if (b.length > ex.inputCap()) return { err: 'input-too-long' };
    new Uint8Array(ex.memory.buffer, ex.inputPtr(), b.length).set(b);
    const n = ex.parse(b.length);
    if (n < 0) return { err: `parse-rc-${n}` };
    return { cron: dec.decode(new Uint8Array(ex.memory.buffer, ex.outputPtr(), n)) };
  };
}

(async () => {
  if (!fs.existsSync(exePath)) {
    console.error(
      RED(`crono_eng.exe not found at ${exePath}; run zig build in crono-eng.`),
    );
    process.exit(2);
  }
  const corpus = parseCorpus();
  const translate = await loadWasm();

  const mismatches = []; // wasm cron != corpus cron
  const parserFails = []; // cron-parser rejected
  const strueFails = []; // cronstrue rejected
  let ok = 0;

  for (const { phrase, expr } of corpus) {
    const r = translate(phrase);
    if (r.err || r.cron !== expr) {
      mismatches.push({ phrase, expected: expr, got: r.cron || r.err });
    } else {
      ok++;
    }
    // Downstream compatibility is checked against the corpus's canonical cron
    // (the source of truth) regardless of the WASM result.
    try {
      CronExpressionParser.parse(expr, { currentDate: new Date('2026-01-01T00:00:00Z') });
    } catch (e) {
      parserFails.push({ phrase, expr, msg: e.message });
    }
    try {
      cronstrue.toString(expr);
    } catch (e) {
      strueFails.push({ phrase, expr, msg: e.message });
    }
  }

  // Some valid corpus phrases translate to Quartz forms cron-parser cannot run.
  // These are KNOWN-unsupported and handled in-app: naturalLanguageToCron gates
  // its output on cron-parser, so they are rejected at input instead of silently
  // never firing. Classify so the harness only fails on NEW/unexpected rejects.
  const classify = (expr, msg) => {
    if (expr.trim().split(/\s+/).length === 7) return 'year (7-field)';
    if (/[0-9L]W\b/.test(expr)) return 'nearest-weekday (W)';
    if (/L-\d/.test(expr)) return 'nth-to-last day (L-n)';
    if (/#\d+\s*,/.test(expr) || /,[A-Z]{3}#/.test(expr)) return 'nth-weekday list (#,)';
    if (/Invalid range|min\(\d+\) > max/.test(msg)) return 'complex time-window';
    return null; // unexpected
  };
  const knownUnsupported = [];
  const unexpected = [];
  for (const f of parserFails) {
    (classify(f.expr, f.msg) ? knownUnsupported : unexpected).push({
      ...f,
      cat: classify(f.expr, f.msg),
    });
  }
  const byCat = {};
  for (const f of knownUnsupported) byCat[f.cat] = (byCat[f.cat] || 0) + 1;

  console.log(`\nCorpus entries: ${corpus.length}`);
  console.log(`WASM exact match: ${GREEN(ok)} / ${corpus.length}`);
  console.log(
    `cronstrue accepts: ${corpus.length - strueFails.length} / ${corpus.length}`,
  );
  console.log(
    `cron-parser runs: ${corpus.length - parserFails.length} / ${corpus.length}` +
      ` (+${knownUnsupported.length} known-unsupported, rejected at input)`,
  );
  if (knownUnsupported.length) {
    console.log('  known-unsupported by feature: ' + JSON.stringify(byCat));
  }

  const show = (title, arr, fmt) => {
    if (!arr.length) return;
    console.log(`\n${YEL(title)} (${arr.length}):`);
    arr.slice(0, 40).forEach((x) => console.log('  ' + fmt(x)));
    if (arr.length > 40) console.log(`  ...and ${arr.length - 40} more`);
  };
  show(
    'WASM MISMATCHES',
    mismatches,
    (x) =>
      `"${x.phrase}"  expected ${JSON.stringify(x.expected)} got ${JSON.stringify(x.got)}`,
  );
  show('cronstrue REJECTS', strueFails, (x) => `"${x.phrase}" [${x.expr}] ${x.msg}`);
  show(
    'UNEXPECTED cron-parser REJECTS',
    unexpected,
    (x) => `"${x.phrase}" [${x.expr}] ${x.msg}`,
  );

  const failed = mismatches.length + strueFails.length + unexpected.length;
  console.log(
    `\n${failed === 0 ? GREEN('ALL PASS') : RED(`${failed} unexpected issue(s)`)}\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error(RED('harness error'), e);
  process.exit(2);
});
