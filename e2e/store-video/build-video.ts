/**
 * Post-process the latest Playwright video capture into shippable formats:
 *   - reel.mp4   1920×1080, 30fps, H.264 yuv420p   landing-page fallback
 *   - reel.webm  1920×1080, 30fps, VP9             landing-page primary
 *   - reel.gif   1024 wide, 24fps, two-pass palette README embed
 *
 * Inputs: the most recent `.webm` under `.tmp/video/recordings/` (where the
 * fixture's `recordVideo` setting writes). Outputs: `dist/video/`.
 *
 * ffmpeg is required; gifsicle is optional (used to shrink the gif if present).
 *
 * Run: npm run video:build
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RECORDINGS_DIR = path.join(REPO_ROOT, '.tmp', 'video', 'recordings');
const TRIM_SIDECAR_PATH = path.join(RECORDINGS_DIR, '_latest-trim.json');
const OUT_DIR = path.join(REPO_ROOT, 'dist', 'video');

/**
 * Variant suffix applied to output filenames. `REEL_VARIANT=full` produces
 * `reel-full.{mp4,webm,gif}` so the tight default and the uncut version
 * can coexist in `dist/video/`. Set the same env var for capture so both
 * runs land on the same suffix.
 */
const VARIANT = process.env.REEL_VARIANT ?? '';
const SUFFIX = VARIANT ? `-${VARIANT}` : '';

/**
 * Read the trim offset (seconds) from the sidecar the fixture writes when
 * `markBeatsStart()` is called. Falls back to 0 (no trim) if missing or
 * malformed. `VIDEO_TRIM_OVERRIDE` env var wins for manual overrides.
 */
const readTrimSeconds = (): number => {
  const override = process.env.VIDEO_TRIM_OVERRIDE;
  if (override !== undefined) {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (!fs.existsSync(TRIM_SIDECAR_PATH)) return 0;
  try {
    const { offsetMs } = JSON.parse(fs.readFileSync(TRIM_SIDECAR_PATH, 'utf8'));
    if (typeof offsetMs === 'number' && Number.isFinite(offsetMs) && offsetMs >= 0) {
      return offsetMs / 1000;
    }
  } catch {
    /* fall through */
  }
  return 0;
};

const findMostRecentWebm = (root: string): string => {
  if (!fs.existsSync(root)) {
    throw new Error(`${root} does not exist. Run \`npm run video:capture\` first.`);
  }
  const candidates: { file: string; mtime: number }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.webm')) {
        candidates.push({ file: p, mtime: fs.statSync(p).mtimeMs });
      }
    }
  };
  walk(root);
  if (candidates.length === 0) {
    throw new Error(`No .webm files under ${root}. Did the capture run produce a video?`);
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].file;
};

const run = (cmd: string, args: string[]): void => {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited with status ${r.status}`);
};

const has = (cmd: string): boolean => {
  // Probe by `which` rather than running the command: ffmpeg and gifsicle
  // disagree on `-version` vs `--version` flags, and either may exit non-zero
  // for harmless reasons. `which` only cares whether the binary is on PATH.
  const r = spawnSync('which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
};

const main = (): void => {
  if (!has('ffmpeg')) {
    throw new Error('ffmpeg not found in PATH — install ffmpeg first.');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = findMostRecentWebm(RECORDINGS_DIR);
  console.log(`[video] source: ${path.relative(REPO_ROOT, src)}`);

  const trimSeconds = readTrimSeconds();
  // `-ss` BEFORE `-i` is input seek (fast, frame-accurate when re-encoding).
  // Empty array when no trim, so the ffmpeg arg list is clean.
  const trimArgs = trimSeconds > 0 ? ['-ss', trimSeconds.toFixed(3)] : [];
  if (trimSeconds > 0) {
    console.log(
      `[video] trimming first ${trimSeconds.toFixed(3)}s (seed-import lead-in)`,
    );
  }

  const mp4 = path.join(OUT_DIR, `reel${SUFFIX}.mp4`);
  const webm = path.join(OUT_DIR, `reel${SUFFIX}.webm`);
  const palette = path.join(OUT_DIR, `.palette${SUFFIX}.png`);
  const gif = path.join(OUT_DIR, `reel${SUFFIX}.gif`);

  // 1. mp4 — Playwright records VFR; force CFR 30fps for predictable playback.
  console.log('[video] -> mp4');
  run('ffmpeg', [
    '-y',
    ...trimArgs,
    '-i',
    src,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'fps=30',
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ]);

  // 2. webm — VP9 at the same quality is materially smaller than H.264.
  console.log('[video] -> webm');
  run('ffmpeg', [
    '-y',
    ...trimArgs,
    '-i',
    src,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'fps=30',
    '-an',
    webm,
  ]);

  // 3. gif — two-pass palette is non-negotiable for tolerable color quality.
  // `stats_mode=full` (vs `diff`) builds the palette from every pixel of
  // every frame, which gives more even coverage of the intermediate
  // brightness levels we hit during fade-to-black scene cuts. With `diff`
  // the palette skews toward "changing pixels" and the in-fade frames
  // banded visibly. `dither=sierra2_4a` is an error-diffusion dither
  // that's smoother for gradients than the previous `bayer` (Bayer's
  // fixed pattern reads as a static crosshatch at low contrast).
  console.log('[video] -> gif (palette pass)');
  run('ffmpeg', [
    '-y',
    ...trimArgs,
    '-i',
    src,
    '-vf',
    'fps=24,scale=1024:-1:flags=lanczos,palettegen=stats_mode=full',
    palette,
  ]);
  console.log('[video] -> gif (paletteuse)');
  run('ffmpeg', [
    '-y',
    ...trimArgs,
    '-i',
    src,
    '-i',
    palette,
    '-lavfi',
    'fps=24,scale=1024:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=sierra2_4a',
    gif,
  ]);
  fs.unlinkSync(palette);

  if (has('gifsicle')) {
    console.log(`[video] -> reel${SUFFIX}-optimized.gif (gifsicle -O3 --lossy=80)`);
    const optimized = path.join(OUT_DIR, `reel${SUFFIX}-optimized.gif`);
    run('gifsicle', ['-O3', '--lossy=80', gif, '-o', optimized]);
  } else {
    console.log(
      '[video] gifsicle not installed; skipping optimization (install for ~30% smaller gif).',
    );
  }

  console.log('[video] outputs:');
  for (const f of fs.readdirSync(OUT_DIR)) {
    const full = path.join(OUT_DIR, f);
    if (!fs.statSync(full).isFile()) continue;
    const kb = (fs.statSync(full).size / 1024).toFixed(0);
    console.log(`  ${path.relative(REPO_ROOT, full)}  ${kb} KB`);
  }
};

main();
