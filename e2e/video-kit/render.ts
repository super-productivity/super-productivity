/**
 * Node-side post-processing: pick the latest recording, trim its
 * lead-in, and encode MP4 / WebM / GIF with ffmpeg. Requires ffmpeg on PATH;
 * gifsicle is optional. No npm dependencies.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * `startRecording` captures at this rate; encoding at the same rate avoids
 * duplicate/dropped-frame judder during fades and cursor glides.
 */
export const OUTPUT_FPS = 30;

/** Container `startRecording` writes; tolerates an interrupted capture. */
export const RECORDING_EXT = '.mkv';

export type MediaStream = {
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

export type MediaProbe = {
  streams?: MediaStream[];
  format?: { duration?: string; size?: string; bit_rate?: string; format_name?: string };
};

/** Runs a command with inherited stdio; throws on a non-zero exit. */
export const run = (cmd: string, args: string[]): void => {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited with status ${r.status}`);
};

/**
 * Runs a command without blocking, so independent encodes overlap. Output is
 * inherited; pass `-loglevel error` to ffmpeg so parallel runs stay readable.
 */
export const runAsync = (cmd: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status === 0) resolve();
      else reject(new Error(`${cmd} exited with status ${status}`));
    });
  });

/** Quiet ffmpeg prefix for encodes that run side by side. */
const QUIET = ['-hide_banner', '-loglevel', 'error', '-y'];

export const hasCommand = (cmd: string): boolean => {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
};

export const probeMedia = (file: string): MediaProbe => {
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

export const streamOfType = (probe: MediaProbe, type: string): MediaStream | undefined =>
  probe.streams?.find((stream) => stream.codec_type === type);

/** Trim metadata path paired with one recording. */
export const trimPathFor = (recording: string): string =>
  recording.slice(0, -path.extname(recording).length) + '.trim.json';

/** Newest completed recording with its own trim metadata; failed captures are skipped. */
export const findLatestRecording = (dir: string): string => {
  if (!fs.existsSync(dir)) {
    throw new Error(`${dir} does not exist. Run the capture first.`);
  }
  const candidates = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(RECORDING_EXT) &&
        fs.existsSync(trimPathFor(path.join(dir, entry.name))),
    )
    .map((entry) => {
      const file = path.join(dir, entry.name);
      return { file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    throw new Error(
      `No successful ${RECORDING_EXT} recording with matching .trim.json under ${dir}. Run the capture first.`,
    );
  }
  return candidates[0].file;
};

export type RecordingTrim = {
  offsetMs: number;
  endOffsetMs: number;
  scenes?: unknown;
  variant: string;
};

/** Read trim data paired with this exact recording; old shared sidecars are unsafe. */
export const readRecordingTrim = (src: string, variant: string): RecordingTrim => {
  const sidecarPath = trimPathFor(src);
  let sidecar: RecordingTrim;
  try {
    sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as RecordingTrim;
  } catch {
    throw new Error(
      `Missing or unreadable trim metadata: ${sidecarPath}. Recapture the video.`,
    );
  }
  if (
    typeof sidecar?.offsetMs !== 'number' ||
    !Number.isFinite(sidecar.offsetMs) ||
    sidecar.offsetMs < 0 ||
    typeof sidecar.endOffsetMs !== 'number' ||
    !Number.isFinite(sidecar.endOffsetMs) ||
    sidecar.endOffsetMs <= sidecar.offsetMs ||
    sidecar.variant !== variant
  ) {
    throw new Error(`Invalid trim metadata: ${sidecarPath}. Recapture the video.`);
  }
  return sidecar;
};

/**
 * Filter-graph prefix that drops the first `seconds` and, given `endSeconds`
 * (source time), everything after it, such as teardown after the last beat.
 * Trimming in the graph decodes to the exact frame; seeking before `-i` is
 * faster, but sparse VP8 keyframes can swallow the opening beat.
 */
export const trimFilter = (seconds: number, endSeconds?: number): string => {
  const hasEnd = endSeconds !== undefined && endSeconds > seconds;
  if (seconds <= 0 && !hasEnd) return '';
  const end = hasEnd ? `:end=${endSeconds.toFixed(3)}` : '';
  return `trim=start=${Math.max(0, seconds).toFixed(3)}${end},setpts=PTS-STARTPTS,`;
};

type EncodeInput = {
  src: string;
  out: string;
  /** Result of `trimFilter()`, or '' for no trim. */
  trim: string;
};

const encodeFilter = ({ trim }: EncodeInput): string => `${trim}fps=${OUTPUT_FPS}`;

/** H.264 MP4 at constant frame rate. */
export const encodeMp4 = (input: EncodeInput): Promise<void> =>
  runAsync('ffmpeg', [
    ...QUIET,
    '-i',
    input.src,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    encodeFilter(input),
    '-movflags',
    '+faststart',
    '-an',
    input.out,
  ]);

/**
 * VP9 WebM; materially smaller than H.264 at the same quality. Row threading
 * and `cpu-used 2` cut encode time several-fold; the default single-threaded
 * best-quality mode was the slowest step of a build.
 */
export const encodeWebm = (input: EncodeInput): Promise<void> =>
  runAsync('ffmpeg', [
    ...QUIET,
    '-i',
    input.src,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    encodeFilter(input),
    '-an',
    input.out,
  ]);

/**
 * Two-pass palette GIF. `stats_mode=full` samples every pixel, covering the
 * intermediate levels of fade-to-black cuts (`diff` banded them), and the
 * sierra2_4a error diffusion stays smoother on gradients than Bayer's
 * crosshatch. Two passes, not one graph with `split`: palettegen only emits
 * at EOF, so a single graph buffers every decoded frame (GBs for a reel).
 * With gifsicle installed, also writes `<name>-optimized.gif`.
 */
export const encodeGif = async (
  input: EncodeInput & { width?: number },
): Promise<void> => {
  const { src, out, trim } = input;
  const scale = `scale=${input.width ?? 1024}:-1:flags=lanczos`;
  const palette = path.join(
    path.dirname(out),
    `.palette-${path.basename(out, '.gif')}.png`,
  );
  await runAsync('ffmpeg', [
    ...QUIET,
    '-i',
    src,
    '-vf',
    `${trim}fps=${OUTPUT_FPS},${scale},palettegen=stats_mode=full`,
    palette,
  ]);
  await runAsync('ffmpeg', [
    ...QUIET,
    '-i',
    src,
    '-i',
    palette,
    '-lavfi',
    `${trim}fps=${OUTPUT_FPS},${scale} [x]; [x][1:v] paletteuse=dither=sierra2_4a`,
    out,
  ]);
  fs.unlinkSync(palette);
  if (!hasCommand('gifsicle')) {
    console.log('[video] gifsicle not installed; skipping GIF optimization.');
    return;
  }
  const optimized = out.replace(/\.gif$/, '-optimized.gif');
  await runAsync('gifsicle', ['-O3', '--lossy=80', out, '-o', optimized]);
};

/**
 * One PNG tiling a frame per timestamp (seconds, output time), for reviewing
 * a whole video at a glance instead of watching it.
 */
export const writeContactSheet = async (input: {
  src: string;
  out: string;
  trim: string;
  atSeconds: number[];
  /** Frames per row. Default 4. */
  columns?: number;
}): Promise<void> => {
  const frames = [
    ...new Set(input.atSeconds.map((s) => Math.max(0, Math.round(s * OUTPUT_FPS)))),
  ];
  const picks = frames.map((n) => `eq(n\\,${n})`).join('+');
  const columns = Math.min(input.columns ?? 4, frames.length);
  const rows = Math.ceil(frames.length / columns);
  await runAsync('ffmpeg', [
    ...QUIET,
    '-i',
    input.src,
    '-vf',
    `${input.trim}fps=${OUTPUT_FPS},select='${picks}',scale=480:-1,` +
      `tile=${columns}x${rows}:padding=8:color=black`,
    '-frames:v',
    '1',
    '-fps_mode',
    'vfr',
    input.out,
  ]);
};

/** Prints only files produced by this build, with paths relative to `root`. */
export const logOutputs = (files: string[], root: string): void => {
  console.log('[video] outputs:');
  for (const full of files) {
    const stat = fs.statSync(full);
    console.log(`  ${path.relative(root, full)}  ${(stat.size / 1024).toFixed(0)} KB`);
  }
};
