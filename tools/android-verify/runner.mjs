// Node half of run.sh: connects to the device, opens Chrome, runs one scenario
// and writes <out>/<scenario>.json. Invoked by run.sh, which has already booted
// the device, served the app and set up `adb reverse`.
//
// Exit code: 0 pass, 1 scenario failed (including a failed stage such as a
// missed tap), 2 harness error (device not visible, app not reachable, crash).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { _android } from 'playwright';
import { createAdb } from './lib/adb.mjs';
import { createIme } from './lib/ime.mjs';
import { StageError } from './lib/stage-error.mjs';
import { probeViewport } from './lib/viewport.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAV_TIMEOUT_MS = 60_000;
/** Bounds Playwright's adb calls: launchBrowser has no timeout of its own. */
const DEVICE_TIMEOUT_MS = 60_000;
const APP_RENDER_TIMEOUT_MS = 180_000;
const SCENARIO_TIMEOUT_MS = 180_000;
/** Stages that mean the harness could not reach the app at all: exit 2, not 1. */
const HARNESS_STAGES = new Set(['device', 'navigation']);

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string' },
    serial: { type: 'string' },
    url: { type: 'string' },
    out: { type: 'string' },
  },
});
for (const key of ['scenario', 'serial', 'url', 'out']) {
  if (!args[key]) {
    console.error(`runner: missing --${key}`);
    process.exit(2);
  }
}

// Same keys as e2e/utils/waits.ts skipOnboardingForE2E.
const skipOnboarding = () => {
  try {
    localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
    localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
    localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
    localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
  } catch {
    // opaque-origin frame without localStorage
  }
};

const withTimeout = (promise, ms, stage) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new StageError(stage, `timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const startedAt = new Date();
const result = {
  scenario: args.scenario,
  pass: false,
  measurements: {},
  screenshots: [],
  device: { serial: args.serial },
  url: args.url,
  startedAt: startedAt.toISOString(),
};
const jsonPath = path.join(args.out, `${args.scenario}.json`);
let exitCode = 2;
let device;
let context;

const shot = async (name) => {
  if (!device) return;
  const file = path.join(args.out, `${args.scenario}-${name}.png`);
  try {
    // Native screenshot: unlike page.screenshot it includes the IME.
    await device.screenshot({ path: file });
    result.screenshots.push(path.basename(file));
  } catch (e) {
    console.error(`runner: screenshot ${name} failed: ${e.message}`);
  }
};

try {
  const devices = await withTimeout(_android.devices(), DEVICE_TIMEOUT_MS, 'device');
  device = devices.find((d) => d.serial() === args.serial);
  if (!device) {
    throw new StageError('device', `Playwright does not see device ${args.serial}`, {
      seen: devices.map((d) => d.serial()),
    });
  }
  result.device.model = device.model();

  const { default: scenario } = await import(
    pathToFileURL(path.join(HERE, 'scenarios', `${args.scenario}.mjs`)).href
  );
  if (typeof scenario !== 'function') {
    throw new Error(`scenarios/${args.scenario}.mjs has no default export function`);
  }

  // launchBrowser polls for Chrome's DevTools socket forever. Chrome only opens
  // it when it reads Playwright's command line, which a non-rooted image skips
  // unless the chrome://flags switch from the README is on.
  context = await withTimeout(device.launchBrowser(), DEVICE_TIMEOUT_MS, 'device').catch(
    (e) => {
      throw new StageError(
        'device',
        `Chrome did not start for Playwright (${e.message}); on a Google Play image enable "Enable command line on non-rooted devices" in chrome://flags`,
      );
    },
  );
  await context.addInitScript(skipOnboarding);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(args.url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
  } catch (e) {
    throw new StageError('navigation', `could not load ${args.url}: ${e.message}`);
  }
  try {
    await page
      .locator('.route-wrapper > :not(router-outlet)')
      .first()
      .waitFor({ state: 'visible', timeout: APP_RENDER_TIMEOUT_MS });
  } catch {
    throw new StageError('app-not-rendered', 'the app shell never rendered a route');
  }

  const adb = createAdb(args.serial);
  const ime = createIme({ page, adb });
  const probe = (baseline) => probeViewport(page, baseline);
  const outcome = await withTimeout(
    scenario({ page, adb, ime, probe, shot, StageError }),
    SCENARIO_TIMEOUT_MS,
    'scenario-timeout',
  );
  result.pass = outcome?.pass === true;
  result.measurements = outcome?.measurements ?? {};
  await shot('final');
  exitCode = result.pass ? 0 : 1;
} catch (e) {
  if (e instanceof StageError) {
    result.stage = e.stage;
    result.details = e.details;
    exitCode = HARNESS_STAGES.has(e.stage) ? 2 : 1;
    await shot(`fail-${e.stage}`);
  } else {
    result.stage = 'harness';
    await shot('fail-harness');
  }
  result.error = e.message;
} finally {
  result.durationMs = Date.now() - startedAt.getTime();
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await context?.close().catch(() => {});
  await device?.close().catch(() => {});
}

const summary = result.pass ? 'PASS' : `FAIL${result.stage ? ` [${result.stage}]` : ''}`;
console.log(`${args.scenario}: ${summary}${result.error ? ` — ${result.error}` : ''}`);
process.exit(exitCode);
