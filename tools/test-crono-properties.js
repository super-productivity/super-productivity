#!/usr/bin/env node
/**
 * Property / fuzz / round-trip tests for the English→cron pipeline, complementing
 * the exact-match corpus harness (test-crono-wasm.js):
 *
 *   1. Determinism      — translating a phrase twice yields identical output.
 *   2. Marshalling fuzz — empty / oversized / unicode / boundary inputs never
 *                         crash the WASM module.
 *   3. Round-trip       — phrase → cron → cronstrue English mentions the
 *                         expected day/month term.
 *   4. Simulation       — every engine-runnable corpus cron yields a strictly
 *                         increasing, throw-free sequence of fire times.
 *
 * Usage:  node tools/test-crono-properties.js
 * Env:    CRONO_ENG_DIR (defaults to ../crono-eng)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { CronExpressionParser } = require('cron-parser');
const cronstrue = require('cronstrue');

const cronoDir =
  process.env.CRONO_ENG_DIR || path.resolve(__dirname, '..', '..', 'crono-eng');
const wasmPath = path.resolve(__dirname, '..', 'src', 'assets', 'crono-eng.wasm');
const exePath = path.join(cronoDir, 'zig-out', 'bin', 'crono_eng.exe');

const RESET = '\x1b[0m';
const RED = (s) => `\x1b[31m${s}${RESET}`;
const GREEN = (s) => `\x1b[32m${s}${RESET}`;

const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) return;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

function parseCorpus() {
  const dump = execFileSync(exePath, ['--dump-corpus'], { encoding: 'utf8' });
  const pairs = [];
  let phrase = null;
  for (const line of dump.split(/\r?\n/)) {
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
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
  return instance.exports;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const translate = (ex, s) => {
  const b = enc.encode(s);
  if (b.length > ex.inputCap()) return { err: 'too-long' };
  new Uint8Array(ex.memory.buffer, ex.inputPtr(), b.length).set(b);
  const n = ex.parse(b.length);
  if (n < 0) return { rc: n };
  return { cron: dec.decode(new Uint8Array(ex.memory.buffer, ex.outputPtr(), n)) };
};

(async () => {
  if (!fs.existsSync(exePath)) {
    console.error(RED(`crono_eng.exe not found at ${exePath}`));
    process.exit(2);
  }
  const corpus = parseCorpus();
  const ex = await loadWasm();

  // 1. Determinism — sample every 7th phrase, translate twice.
  for (let i = 0; i < corpus.length; i += 7) {
    const p = corpus[i].phrase;
    const a = translate(ex, p);
    const b = translate(ex, p);
    check('determinism', JSON.stringify(a) === JSON.stringify(b), `"${p}"`);
  }

  // 2. Marshalling fuzz — must never throw / crash the module.
  try {
    check('fuzz:empty', translate(ex, '').rc < 0, 'empty input should error');
    // Lie about the length to exercise the module's own bound check.
    check('fuzz:oversized-len', ex.parse(99999) === -1, 'len > buffer should return -1');
    const uni = translate(ex, 'every 🎉 monday 你好');
    check(
      'fuzz:unicode',
      typeof uni === 'object' && ('cron' in uni || 'rc' in uni),
      'unicode input handled',
    );
    check('fuzz:boundary', typeof ex.parse(ex.inputCap()) === 'number', 'cap boundary');
    // A long-but-in-bounds garbage string.
    check(
      'fuzz:long-garbage',
      typeof translate(ex, 'x'.repeat(1000)).rc === 'number',
      'long garbage rejected, not crashed',
    );
  } catch (e) {
    check('fuzz:no-throw', false, e.message);
  }

  // 3. Round-trip: phrase → cron → cronstrue English mentions the expected term.
  const ROUND_TRIP = [
    ['every saturday', /saturday/i],
    ['every monday at 9am', /monday/i],
    ['weekdays', /monday through friday/i],
    ['every day', /every day|at 12:00 am/i],
    ['first day of every month', /day 1 of the month|1st? day/i],
    ['every 15 minutes', /every 15 minutes/i],
    ['every july', /july/i],
  ];
  for (const [phrase, re] of ROUND_TRIP) {
    const r = translate(ex, phrase);
    if (r.cron) {
      let human = '';
      try {
        human = cronstrue.toString(r.cron);
      } catch (e) {
        human = `STRUE-ERR ${e.message}`;
      }
      check('round-trip', re.test(human), `"${phrase}" → "${r.cron}" → "${human}"`);
    } else {
      check('round-trip', false, `"${phrase}" did not translate`);
    }
  }

  // 4. Occurrence simulation — every engine-runnable corpus cron yields a
  // strictly increasing, throw-free sequence of fire times.
  let simulated = 0;
  for (const { expr } of corpus) {
    let it;
    try {
      it = CronExpressionParser.parse(expr, {
        currentDate: new Date('2026-01-01T00:00:00Z'),
      });
    } catch {
      continue; // engine-unsupported (year/W/L-n/#-lists) — covered elsewhere
    }
    simulated++;
    let prev = -Infinity;
    try {
      for (let k = 0; k < 5; k++) {
        const t = it.next().toDate().getTime();
        check('simulation:monotonic', t > prev, `${expr} step ${k}`);
        prev = t;
      }
    } catch (e) {
      check('simulation:no-throw', false, `${expr}: ${e.message}`);
    }
  }

  // 5. Buffer reuse — the module reuses static input/output buffers across
  // calls. A short translation after a long one must not be contaminated by
  // leftover bytes, and results must be stable under heavy interleaving.
  const REUSE_PAIRS = [
    ['every saturday from march through november', 'every day'],
    ['at 1:00 on the 12 days before the last day of the month.', 'every minute'],
    ['x'.repeat(900), 'every monday at 9am'],
  ];
  for (const [long, short] of REUSE_PAIRS) {
    const canonical = translate(ex, short);
    translate(ex, long); // pollute the shared buffers with a longer call
    const after = translate(ex, short);
    check(
      'buffer-reuse',
      JSON.stringify(after) === JSON.stringify(canonical),
      `"${short}" after a longer call`,
    );
  }
  // Heavy alternating loop — results must stay deterministic under reuse.
  const CYCLE = ['every day', 'every monday at 9am', 'every 5 minutes'];
  const baseline = CYCLE.map((p) => JSON.stringify(translate(ex, p)));
  for (let i = 0; i < 600; i++) {
    const idx = i % CYCLE.length;
    check(
      'reuse-loop',
      JSON.stringify(translate(ex, CYCLE[idx])) === baseline[idx],
      `${CYCLE[idx]} @${i}`,
    );
  }

  console.log(`\nCorpus: ${corpus.length} · simulated ${simulated} runnable crons`);
  if (failures.length) {
    console.log(RED(`\n${failures.length} property failure(s):`));
    failures.slice(0, 40).forEach((f) => console.log('  ' + f));
    process.exit(1);
  }
  console.log(GREEN('\nALL PROPERTIES HOLD\n'));
})().catch((e) => {
  console.error(RED('harness error'), e);
  process.exit(2);
});
