/**
 * Post-process the latest video capture into shippable formats:
 *   - reel.mp4   2048×2048, 30fps, H.264 yuv420p   landing-page fallback
 *   - reel.webm  2048×2048, 30fps, VP9             landing-page primary
 *   - reel.gif   1024 wide, 30fps, two-pass palette README embed
 *   - reel-ms-store.mp4 / reel-ms-store-thumbnail.png when
 *     REEL_VARIANT=ms-store. These are 1920×1080 Partner Center trailer assets.
 *
 * Inputs: the most recent successful recording with a matching `.trim.json`
 * under `.tmp/video/recordings/`. Outputs: `dist/video/`, plus a
 * review contact sheet (two frames per scene) under `.tmp/video/review/`.
 * `VIDEO_QUICK=1` builds only the mp4 and the contact sheet.
 *
 * ffmpeg is required; gifsicle is optional (used to shrink the gif if present).
 *
 * Run: npm run video:build
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  encodeGif,
  encodeMp4,
  encodeWebm,
  findLatestRecording,
  hasCommand,
  logOutputs,
  OUTPUT_FPS,
  probeMedia,
  readRecordingTrim,
  run,
  streamOfType,
  trimFilter as toTrimFilter,
  type RecordingTrim,
  writeContactSheet,
} from '../video-kit/render';

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
/** `VIDEO_QUICK=1`: mp4 and contact sheet only, for iterating on a reel. */
const IS_QUICK = process.env.VIDEO_QUICK === '1';
const variantDirName = (VARIANT || 'default').replace(/[^a-z0-9_-]+/gi, '-');
const RECORDINGS_DIR = path.join(RECORDINGS_ROOT_DIR, variantDirName);
const OUT_DIR = path.join(REPO_ROOT, 'dist', 'video');
const REVIEW_DIR = path.join(REPO_ROOT, '.tmp', 'video', 'review');
/** Seconds after a scene's reveal starts, once its fade-in has settled. */
const CONTACT_FRAME_DELAY_S = 0.8;
const CONTACT_FALLBACK_FRAMES = 8;
const MS_STORE_WIDTH = 1920;
const MS_STORE_HEIGHT = 1080;
const MS_STORE_GOP = Math.round(OUTPUT_FPS / 2);
const MS_STORE_VIDEO_BITRATE = 50_000_000;
const MS_STORE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MS_STORE_AUDIO_BITRATE_TARGET = 384_000;
const MS_STORE_AUDIO_BITRATE_HARD_MIN = 128_000;
const MS_STORE_AUDIO_BITRATE_WARNING_THRESHOLD = MS_STORE_AUDIO_BITRATE_TARGET * 0.9;

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

/**
 * Read the trim offset (seconds) from the sidecar the fixture writes when
 * `markBeatsStart()` is called. `VIDEO_TRIM_OVERRIDE` wins for manual trims.
 */
const readTrimSeconds = (sidecar: RecordingTrim): number => {
  const override = process.env.VIDEO_TRIM_OVERRIDE;
  if (override !== undefined) {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0) return n;
    throw new Error(
      `VIDEO_TRIM_OVERRIDE must be a non-negative number, got ${JSON.stringify(override)}`,
    );
  }
  return sidecar.offsetMs / 1000;
};

/** Source time (s) where the beats end, or undefined to keep everything. */
const readEndSeconds = (sidecar: RecordingTrim): number => sidecar.endOffsetMs / 1000;

type Scene = { label: string; atSeconds: number };

/** Labeled scene reveals, in output time (after the lead-in trim). */
const readScenes = (sidecar: RecordingTrim, trimSeconds: number): Scene[] => {
  if (!Array.isArray(sidecar.scenes)) return [];
  return sidecar.scenes.flatMap((scene: unknown) => {
    const { label, offsetMs } = (scene ?? {}) as { label?: unknown; offsetMs?: unknown };
    if (typeof label !== 'string' || typeof offsetMs !== 'number') return [];
    const sourceSeconds = offsetMs / 1000;
    return [{ label, atSeconds: sourceSeconds - trimSeconds }];
  });
};

const logScenes = (scenes: Scene[], durationSeconds: number | undefined): void => {
  if (scenes.length === 0) return;
  console.log('[video] scenes (output time):');
  scenes.forEach((scene, i) => {
    const next = scenes[i + 1]?.atSeconds ?? durationSeconds;
    const length = next === undefined ? '' : ` (${(next - scene.atSeconds).toFixed(1)}s)`;
    console.log(`  ${scene.atSeconds.toFixed(2).padStart(6)}s  ${scene.label}${length}`);
  });
};

/**
 * Two frames per scene, its opening and its middle (where zooms and other
 * mid-scene beats land), so each sheet row is one scene. Evenly spaced frames
 * when no scenes were labeled.
 */
const contactSheetTimes = (scenes: Scene[], durationSeconds: number): number[] => {
  if (scenes.length > 0) {
    const starts = [0, ...scenes.map((scene) => scene.atSeconds)];
    return starts.flatMap((start, i) => {
      const end = starts[i + 1] ?? durationSeconds;
      // Short theme scenes need an earlier opening sample; otherwise it can
      // round to the midpoint's frame, be deduplicated, and shift every row.
      const opening = start + Math.min(CONTACT_FRAME_DELAY_S, (end - start) / 3);
      const frameDuration = 1 / OUTPUT_FPS;
      const middle = Math.max((start + end) / 2, opening + frameDuration);
      return [opening, middle].map((t) => Math.min(durationSeconds - 0.1, t));
    });
  }
  const step = durationSeconds / CONTACT_FALLBACK_FRAMES;
  return Array.from({ length: CONTACT_FALLBACK_FRAMES }, (_, i) => step * (i + 0.5));
};

const asNumber = (value: string | number | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const relative = (file: string): string => path.relative(REPO_ROOT, file);

const validateMsStoreSource = (src: string): void => {
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

const main = async (): Promise<void> => {
  if (!hasCommand('ffmpeg')) {
    throw new Error('ffmpeg not found in PATH — install ffmpeg first.');
  }
  if (!hasCommand('ffprobe')) {
    throw new Error('ffprobe not found in PATH — install ffprobe first.');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = findLatestRecording(RECORDINGS_DIR);
  console.log(`[video] source: ${relative(src)}`);

  const sidecar = readRecordingTrim(src, VARIANT || 'default');
  const trimSeconds = readTrimSeconds(sidecar);
  if (IS_MS_STORE) {
    validateMsStoreSource(src);
  }
  const endSeconds = process.env.VIDEO_TRIM_OVERRIDE
    ? undefined
    : readEndSeconds(sidecar);
  const trimFilter = toTrimFilter(trimSeconds, endSeconds);
  if (trimSeconds > 0) {
    console.log(
      `[video] trimming first ${trimSeconds.toFixed(3)}s (seed-import lead-in)`,
    );
  }
  const sourceSeconds = asNumber(probeMedia(src).format?.duration) ?? undefined;
  const lastSecond = endSeconds ?? sourceSeconds;
  const durationSeconds = lastSecond === undefined ? undefined : lastSecond - trimSeconds;
  if (endSeconds !== undefined && sourceSeconds !== undefined) {
    const dropped = sourceSeconds - endSeconds;
    console.log(`[video] trimming last ${dropped.toFixed(3)}s (teardown)`);
  }
  const scenes = readScenes(sidecar, trimSeconds);
  logScenes(scenes, durationSeconds);

  const mp4 = path.join(OUT_DIR, `reel${SUFFIX}.mp4`);
  const thumbnail = path.join(OUT_DIR, `reel${SUFFIX}-thumbnail.png`);
  const webm = path.join(OUT_DIR, `reel${SUFFIX}.webm`);
  const gif = path.join(OUT_DIR, `reel${SUFFIX}.gif`);

  const contactSheet = path.join(REVIEW_DIR, `reel${SUFFIX}-contact.png`);
  const writeReviewSheet = async (): Promise<void> => {
    if (durationSeconds === undefined) return;
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    await writeContactSheet({
      src,
      out: contactSheet,
      trim: trimFilter,
      atSeconds: contactSheetTimes(scenes, durationSeconds),
      columns: scenes.length > 0 ? 2 : undefined,
    });
  };

  if (IS_MS_STORE) {
    buildMsStoreAssets(src, trimFilter, mp4, thumbnail);
    validateMsStoreOutputs(mp4, thumbnail);
    await writeReviewSheet();
    logOutputs(
      [mp4, thumbnail, ...(durationSeconds === undefined ? [] : [contactSheet])],
      REPO_ROOT,
    );
    return;
  }

  const startedAt = Date.now();
  if (IS_QUICK) {
    // Review loop: the gif (and its gifsicle pass) dominates the build.
    console.log('[video] -> mp4, contact sheet (VIDEO_QUICK)');
    await Promise.all([
      encodeMp4({ src, out: mp4, trim: trimFilter }),
      writeReviewSheet(),
    ]);
  } else {
    // Independent encodes overlap; the webm and gif dominated a serial build.
    console.log('[video] -> mp4, webm, gif, contact sheet (in parallel)');
    await Promise.all([
      encodeMp4({ src, out: mp4, trim: trimFilter }),
      encodeWebm({ src, out: webm, trim: trimFilter }),
      encodeGif({ src, out: gif, trim: trimFilter }),
      writeReviewSheet(),
    ]);
  }
  console.log(`[video] encoded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (IS_QUICK) {
    logOutputs(
      [mp4, ...(durationSeconds === undefined ? [] : [contactSheet])],
      REPO_ROOT,
    );
    const staleSiblings = [webm, gif, gif.replace(/\.gif$/, '-optimized.gif')].filter(
      (file) => fs.existsSync(file),
    );
    if (staleSiblings.length > 0) {
      console.log(
        `[video] existing stale siblings from earlier builds (not updated): ${staleSiblings
          .map(relative)
          .join(', ')}`,
      );
    }
  } else {
    const optimizedGif = gif.replace(/\.gif$/, '-optimized.gif');
    logOutputs(
      [
        mp4,
        webm,
        gif,
        ...(hasCommand('gifsicle') ? [optimizedGif] : []),
        ...(durationSeconds === undefined ? [] : [contactSheet]),
      ],
      REPO_ROOT,
    );
  }
};

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
