/**
 * Post-process the latest Playwright video capture into shippable formats:
 *   - reel.mp4   1024×1024, 25fps, H.264 yuv420p   landing-page fallback
 *   - reel.webm  1024×1024, 25fps, VP9             landing-page primary
 *   - reel.gif   1024 wide, 25fps, two-pass palette README embed
 *   - reel-ms-store.mp4 / reel-ms-store-thumbnail.png when
 *     REEL_VARIANT=ms-store. These are 1920×1080 Partner Center trailer assets.
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
const RECORDINGS_ROOT_DIR = path.join(REPO_ROOT, '.tmp', 'video', 'recordings');

/**
 * Variant suffix applied to output filenames. `REEL_VARIANT=full` produces
 * `reel-full.{mp4,webm,gif}` so the tight default and the uncut version
 * can coexist in `dist/video/`. Set the same env var for capture so both
 * runs land on the same suffix.
 */
const VARIANT = process.env.REEL_VARIANT ?? '';
const SUFFIX = VARIANT ? `-${VARIANT}` : '';
const IS_MS_STORE = VARIANT === 'ms-store';
const variantDirName = (VARIANT || 'default').replace(/[^a-z0-9_-]+/gi, '-');
const RECORDINGS_DIR = path.join(RECORDINGS_ROOT_DIR, variantDirName);
const TRIM_SIDECAR_PATH = path.join(RECORDINGS_DIR, '_latest-trim.json');
const OUT_DIR = path.join(REPO_ROOT, 'dist', 'video');
// Playwright's recorder currently emits 25fps VP8 webm. Keeping all derived
// formats on that cadence avoids duplicate/drop-frame judder in fades.
const OUTPUT_FPS = 25;
const MS_STORE_WIDTH = 1920;
const MS_STORE_HEIGHT = 1080;
const MS_STORE_GOP = Math.round(OUTPUT_FPS / 2);
const MS_STORE_VIDEO_BITRATE = 50_000_000;
const MS_STORE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MS_STORE_AUDIO_BITRATE_TARGET = 384_000;
const MS_STORE_AUDIO_BITRATE_HARD_MIN = 128_000;
const MS_STORE_AUDIO_BITRATE_WARNING_THRESHOLD = MS_STORE_AUDIO_BITRATE_TARGET * 0.9;

type TrimSidecar = {
  offsetMs?: unknown;
  recordedAtMs?: unknown;
  variant?: unknown;
  recordingSize?: unknown;
};

type MediaStream = {
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  field_order?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  has_b_frames?: number;
};

type MediaFormat = {
  duration?: string;
  size?: string;
  bit_rate?: string;
  format_name?: string;
};

type MediaProbe = {
  streams?: MediaStream[];
  format?: MediaFormat;
};

const readNonNegativeNumberEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) return value;
  throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
};

const MS_STORE_THUMBNAIL_AT_SECONDS = readNonNegativeNumberEnv(
  'MS_STORE_THUMBNAIL_AT_SECONDS',
  1.2,
);

const readTrimSidecar = (): TrimSidecar | null => {
  if (!fs.existsSync(TRIM_SIDECAR_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TRIM_SIDECAR_PATH, 'utf8')) as TrimSidecar;
  } catch {
    return null;
  }
};

/**
 * Read the trim offset (seconds) from the sidecar the fixture writes when
 * `markBeatsStart()` is called. Falls back to 0 (no trim) if missing or
 * malformed. `VIDEO_TRIM_OVERRIDE` env var wins for manual overrides.
 */
const readTrimSeconds = (sidecar: TrimSidecar | null): number => {
  const override = process.env.VIDEO_TRIM_OVERRIDE;
  if (override !== undefined) {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  const offsetMs = sidecar?.offsetMs;
  if (typeof offsetMs === 'number' && Number.isFinite(offsetMs) && offsetMs >= 0) {
    return offsetMs / 1000;
  }
  return 0;
};

const findMostRecentWebm = (root: string): string => {
  if (!fs.existsSync(root)) {
    throw new Error(`${root} does not exist. Run \`npm run video:capture\` first.`);
  }
  const candidates: { file: string; mtime: number }[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith('.webm')) {
      candidates.push({ file: p, mtime: fs.statSync(p).mtimeMs });
    }
  }
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
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { stdio: 'ignore' });
  return r.status === 0;
};

const probeMedia = (file: string): MediaProbe => {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const detail = r.stderr ? `: ${r.stderr.trim()}` : '';
    throw new Error(`ffprobe exited with status ${r.status}${detail}`);
  }
  return JSON.parse(r.stdout) as MediaProbe;
};

const streamOfType = (probe: MediaProbe, type: string): MediaStream | undefined =>
  probe.streams?.find((stream) => stream.codec_type === type);

const asNumber = (value: string | number | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const relative = (file: string): string => path.relative(REPO_ROOT, file);

const logOutputs = (): void => {
  console.log('[video] outputs:');
  for (const f of fs.readdirSync(OUT_DIR)) {
    const full = path.join(OUT_DIR, f);
    if (!fs.statSync(full).isFile()) continue;
    const kb = (fs.statSync(full).size / 1024).toFixed(0);
    console.log(`  ${relative(full)}  ${kb} KB`);
  }
};

const validateMsStoreSource = (
  src: string,
  sidecar: TrimSidecar | null,
  trimSeconds: number,
): void => {
  if (process.env.VIDEO_TRIM_OVERRIDE === undefined && trimSeconds === 0) {
    throw new Error(
      `Missing valid trim sidecar for ms-store recording at ${relative(
        TRIM_SIDECAR_PATH,
      )}. Run \`npm run video:ms-store\` or set VIDEO_TRIM_OVERRIDE.`,
    );
  }

  const sidecarVariant = sidecar?.variant;
  if (
    sidecarVariant !== undefined &&
    sidecarVariant !== 'ms-store' &&
    sidecarVariant !== VARIANT
  ) {
    throw new Error(
      `Trim sidecar variant ${JSON.stringify(
        sidecarVariant,
      )} does not match REEL_VARIANT=${JSON.stringify(VARIANT)}.`,
    );
  }

  const probe = probeMedia(src);
  const video = streamOfType(probe, 'video');
  if (!video) throw new Error(`No video stream found in ${relative(src)}.`);
  if (video.width !== MS_STORE_WIDTH || video.height !== MS_STORE_HEIGHT) {
    throw new Error(
      `Expected ms-store source to be ${MS_STORE_WIDTH}x${MS_STORE_HEIGHT}, got ${
        video.width ?? 'unknown'
      }x${video.height ?? 'unknown'} from ${relative(src)}. Run \`npm run video:ms-store\` before building.`,
    );
  }
};

const msStoreVideoFilter = (trimFilter: string): string =>
  [
    `${trimFilter}fps=${OUTPUT_FPS}`,
    `scale=${MS_STORE_WIDTH}:${MS_STORE_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos:out_color_matrix=bt709`,
    `pad=${MS_STORE_WIDTH}:${MS_STORE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');

const msStoreThumbnailFilter = (): string =>
  [
    `scale=${MS_STORE_WIDTH}:${MS_STORE_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${MS_STORE_WIDTH}:${MS_STORE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
  ].join(',');

const msStoreAudioInputArgs = (): string[] => {
  const audioSource = process.env.MS_STORE_AUDIO_SOURCE;
  if (!audioSource) {
    throw new Error(
      'MS_STORE_AUDIO_SOURCE is required for REEL_VARIANT=ms-store. ' +
        'Partner Center requires AAC-LC stereo audio at 48 kHz / 384 kbps, and silent generated audio probes below that bitrate.',
    );
  }

  const resolved = path.resolve(REPO_ROOT, audioSource);
  if (!fs.existsSync(resolved)) {
    throw new Error(`MS_STORE_AUDIO_SOURCE does not exist: ${resolved}`);
  }
  return ['-stream_loop', '-1', '-i', resolved];
};

const buildMsStoreAssets = (
  src: string,
  trimFilter: string,
  mp4: string,
  thumbnail: string,
): void => {
  console.log('[video] -> ms-store mp4');
  run('ffmpeg', [
    '-y',
    '-i',
    src,
    ...msStoreAudioInputArgs(),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    msStoreVideoFilter(trimFilter),
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-b:v',
    '50M',
    '-minrate',
    '50M',
    '-maxrate',
    '50M',
    '-bufsize',
    '100M',
    '-bf',
    '2',
    '-g',
    String(MS_STORE_GOP),
    '-keyint_min',
    String(MS_STORE_GOP),
    '-sc_threshold',
    '0',
    '-flags',
    '+cgop',
    '-x264-params',
    'cabac=1:open-gop=0:nal-hrd=cbr:filler=1',
    '-c:a',
    'aac',
    '-profile:a',
    'aac_low',
    '-b:a',
    '384k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    '-movflags',
    '+faststart',
    '-use_editlist',
    '0',
    mp4,
  ]);

  console.log('[video] -> ms-store thumbnail');
  run('ffmpeg', [
    '-y',
    '-ss',
    String(MS_STORE_THUMBNAIL_AT_SECONDS),
    '-i',
    mp4,
    '-frames:v',
    '1',
    '-update',
    '1',
    '-vf',
    msStoreThumbnailFilter(),
    thumbnail,
  ]);
};

const validateMsStoreOutputs = (mp4: string, thumbnail: string): void => {
  const failures: string[] = [];
  const warnings: string[] = [];
  const mp4Probe = probeMedia(mp4);
  const video = streamOfType(mp4Probe, 'video');
  const audio = streamOfType(mp4Probe, 'audio');
  const format = mp4Probe.format;
  const size = asNumber(format?.size);
  const videoBitRate = asNumber(video?.bit_rate);
  const audioBitRate = asNumber(audio?.bit_rate);

  if (!format?.format_name?.includes('mp4')) failures.push('container is not MP4');
  if (size != null && size > MS_STORE_MAX_BYTES) {
    failures.push(`file is ${(size / 1024 / 1024).toFixed(1)} MB, over 2 GB`);
  }

  if (!video) {
    failures.push('missing video stream');
  } else {
    if (video.codec_name !== 'h264') failures.push(`video codec is ${video.codec_name}`);
    if (video.codec_tag_string !== 'avc1') {
      failures.push(`video codec tag is ${video.codec_tag_string}`);
    }
    if (video.profile !== 'High') failures.push(`H.264 profile is ${video.profile}`);
    if (video.width !== MS_STORE_WIDTH || video.height !== MS_STORE_HEIGHT) {
      failures.push(`video is ${video.width}x${video.height}, expected 1920x1080`);
    }
    if (video.pix_fmt !== 'yuv420p') failures.push(`pixel format is ${video.pix_fmt}`);
    if (video.field_order !== 'progressive') {
      failures.push(`field order is ${video.field_order}`);
    }
    if (video.avg_frame_rate !== `${OUTPUT_FPS}/1`) {
      failures.push(`average frame rate is ${video.avg_frame_rate}`);
    }
    if (video.has_b_frames !== 2) {
      failures.push(`B-frame metadata reports ${video.has_b_frames}`);
    }
    if (
      video.color_space !== 'bt709' ||
      video.color_transfer !== 'bt709' ||
      video.color_primaries !== 'bt709'
    ) {
      failures.push(
        `color tags are ${video.color_space}/${video.color_transfer}/${video.color_primaries}`,
      );
    }
    if (videoBitRate != null && videoBitRate < MS_STORE_VIDEO_BITRATE * 0.9) {
      failures.push(`video bitrate is ${(videoBitRate / 1_000_000).toFixed(1)} Mbps`);
    }
  }

  if (!audio) {
    failures.push('missing audio stream');
  } else {
    if (audio.codec_name !== 'aac') failures.push(`audio codec is ${audio.codec_name}`);
    if (audio.profile !== 'LC') failures.push(`AAC profile is ${audio.profile}`);
    if (audio.sample_rate !== '48000') {
      failures.push(`audio sample rate is ${audio.sample_rate}`);
    }
    if (audio.channels !== 2) failures.push(`audio channel count is ${audio.channels}`);
    if (audio.channel_layout !== 'stereo') {
      failures.push(`audio channel layout is ${audio.channel_layout}`);
    }
    if (audioBitRate == null) {
      warnings.push('audio bitrate is unavailable from ffprobe');
    } else if (audioBitRate < MS_STORE_AUDIO_BITRATE_HARD_MIN) {
      failures.push(
        `audio bitrate is ${(audioBitRate / 1000).toFixed(1)} kbps, expected about ${(
          MS_STORE_AUDIO_BITRATE_TARGET / 1000
        ).toFixed(0)} kbps`,
      );
    } else if (audioBitRate < MS_STORE_AUDIO_BITRATE_WARNING_THRESHOLD) {
      warnings.push(
        `audio bitrate probes at ${(audioBitRate / 1000).toFixed(1)} kbps despite the ${(
          MS_STORE_AUDIO_BITRATE_TARGET / 1000
        ).toFixed(0)} kbps encoder target`,
      );
    }
  }

  const thumbnailProbe = probeMedia(thumbnail);
  const thumbnailVideo = streamOfType(thumbnailProbe, 'video');
  if (!thumbnailVideo) {
    failures.push('thumbnail is missing image stream');
  } else {
    if (thumbnailVideo.codec_name !== 'png') {
      failures.push(`thumbnail codec is ${thumbnailVideo.codec_name}`);
    }
    if (
      thumbnailVideo.width !== MS_STORE_WIDTH ||
      thumbnailVideo.height !== MS_STORE_HEIGHT
    ) {
      failures.push(
        `thumbnail is ${thumbnailVideo.width}x${thumbnailVideo.height}, expected 1920x1080`,
      );
    }
  }

  for (const warning of warnings) {
    console.warn(`[video] warning: ${warning}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `Microsoft Store trailer validation failed:\n${failures
        .map((failure) => `  - ${failure}`)
        .join('\n')}`,
    );
  }
  console.log('[video] ms-store validation passed.');
};

const main = (): void => {
  if (!has('ffmpeg')) {
    throw new Error('ffmpeg not found in PATH — install ffmpeg first.');
  }
  if (IS_MS_STORE && !has('ffprobe')) {
    throw new Error('ffprobe not found in PATH — install ffprobe first.');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = findMostRecentWebm(RECORDINGS_DIR);
  console.log(`[video] source: ${relative(src)}`);

  const sidecar = readTrimSidecar();
  const trimSeconds = readTrimSeconds(sidecar);
  if (IS_MS_STORE) {
    validateMsStoreSource(src, sidecar, trimSeconds);
  }
  // Trim in the filter graph so ffmpeg decodes to the exact trim point for
  // every output. Seeking before `-i` is faster, but VP8 keyframes can be
  // sparse enough to drop the opening beat from the generated reel.
  const trimFilter =
    trimSeconds > 0 ? `trim=start=${trimSeconds.toFixed(3)},setpts=PTS-STARTPTS,` : '';
  if (trimSeconds > 0) {
    console.log(
      `[video] trimming first ${trimSeconds.toFixed(3)}s (seed-import lead-in)`,
    );
  }

  const mp4 = path.join(OUT_DIR, `reel${SUFFIX}.mp4`);
  const thumbnail = path.join(OUT_DIR, `reel${SUFFIX}-thumbnail.png`);
  const webm = path.join(OUT_DIR, `reel${SUFFIX}.webm`);
  const palette = path.join(OUT_DIR, `.palette${SUFFIX}.png`);
  const gif = path.join(OUT_DIR, `reel${SUFFIX}.gif`);

  if (IS_MS_STORE) {
    buildMsStoreAssets(src, trimFilter, mp4, thumbnail);
    validateMsStoreOutputs(mp4, thumbnail);
    logOutputs();
    return;
  }

  // 1. mp4 — Playwright records VFR; force CFR for predictable playback.
  console.log('[video] -> mp4');
  run('ffmpeg', [
    '-y',
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
    `${trimFilter}fps=${OUTPUT_FPS}`,
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ]);

  // 2. webm — VP9 at the same quality is materially smaller than H.264.
  console.log('[video] -> webm');
  run('ffmpeg', [
    '-y',
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
    `${trimFilter}fps=${OUTPUT_FPS}`,
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
    '-i',
    src,
    '-vf',
    `${trimFilter}fps=${OUTPUT_FPS},scale=1024:-1:flags=lanczos,palettegen=stats_mode=full`,
    palette,
  ]);
  console.log('[video] -> gif (paletteuse)');
  run('ffmpeg', [
    '-y',
    '-i',
    src,
    '-i',
    palette,
    '-lavfi',
    `${trimFilter}fps=${OUTPUT_FPS},scale=1024:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=sierra2_4a`,
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

  logOutputs();
};

main();
