/**
 * Sharp page recording. Playwright's `recordVideo` captures at CSS-pixel size
 * and encodes VP8 at a fixed ~1 Mbps, which blurs text. This records JPEG
 * frames from `page.screencast` and encodes them near-lossless instead.
 *
 * Chrome renders screencast frames at device pixels only when the browser is
 * launched with a matching scale; pass `recorderLaunchArgs(dpr)` to the
 * launch options, alongside the same `deviceScaleFactor` on the context.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Page } from '@playwright/test';
import { OUTPUT_FPS } from './render';

/** Browser args that make screencast frames match the context's device pixels. */
export const recorderLaunchArgs = (deviceScaleFactor: number): string[] => [
  `--force-device-scale-factor=${deviceScaleFactor}`,
];

/** Pixel size from a JPEG's start-of-frame marker. */
const jpegSize = (jpeg: Buffer): Size | undefined => {
  for (let i = 2; i + 9 < jpeg.length; i += 2 + jpeg.readUInt16BE(i + 2)) {
    const marker = jpeg[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { width: jpeg.readUInt16BE(i + 7), height: jpeg.readUInt16BE(i + 5) };
    }
  }
  return undefined;
};

type Size = { width: number; height: number };

/**
 * Playwright shares one screencast per page, sized by whichever client started
 * it first; trace screenshots, for one, cap it at 800px.
 */
const assertFrameSize = (jpeg: Buffer, expected: Size): void => {
  const size = jpegSize(jpeg);
  if (size?.width === expected.width && size.height === expected.height) return;
  throw new Error(
    `Screencast frames are ${size?.width}x${size?.height}, expected ` +
      `${expected.width}x${expected.height}. Check recorderLaunchArgs and that ` +
      `no other screencast (e.g. trace screenshots) runs on the page.`,
  );
};

export type PageRecording = {
  /** Wall-clock ms at video time 0; scene offsets are measured from it. */
  startedAtMs: number;
  /**
   * Stops capture and waits until the file is complete. Rejects if frames
   * were not the requested size, since the recording is then unusable.
   */
  stop: () => Promise<void>;
};

/**
 * Starts recording `page` to `path` at `size` device pixels. The stream is
 * constant-rate at `OUTPUT_FPS`: Chrome sends frames only on repaint, so the
 * previous frame is repeated until the next one arrives.
 */
export const startRecording = async (
  page: Page,
  options: { path: string; size: Size },
): Promise<PageRecording> => {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(OUTPUT_FPS)],
      ...['-i', 'pipe:0'],
      // ultrafast keeps pace with capture; crf 10 is visually lossless for UI.
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10'],
      ...['-pix_fmt', 'yuv420p', options.path],
    ],
    { stdio: ['pipe', 'ignore', 'inherit'] },
  );
  const exited = new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (status) => {
      if (status === 0) resolve();
      else reject(new Error(`ffmpeg recorder exited with status ${status}`));
    });
  });

  // An ffmpeg crash breaks the pipe; surface it on the next write, not as an
  // unhandled stream error. `exited` reports the exit status.
  let pipeError: Error | undefined;
  ffmpeg.stdin.on('error', (error) => {
    pipeError = error;
  });

  const startedAtMs = Date.now();
  const frameMs = 1000 / OUTPUT_FPS;
  let written = 0;
  let last: Buffer | undefined;
  // Awaiting drain delays the frame ack, which throttles Chrome to the encoder.
  const fillUntil = async (atMs: number): Promise<void> => {
    const target = Math.floor((atMs - startedAtMs) / frameMs);
    while (last && written < target) {
      if (pipeError) throw pipeError;
      if (!ffmpeg.stdin.write(last)) await once(ffmpeg.stdin, 'drain');
      written++;
    }
  };

  // Frames are handled strictly in order. A failure is kept for `stop`:
  // Playwright's frame callback has nowhere to report it.
  let queue = Promise.resolve();
  let frameError: unknown;
  const onFrame = async (data: Buffer, timestamp: number): Promise<void> => {
    if (frameError) return;
    try {
      if (!last) assertFrameSize(data, options.size);
      await fillUntil(timestamp);
      last = data;
    } catch (error) {
      frameError = error;
    }
  };
  await page.screencast.start({
    size: options.size,
    quality: 95,
    onFrame: ({ data, timestamp }) =>
      (queue = queue.then(() => onFrame(data, timestamp))),
  });

  return {
    startedAtMs,
    stop: async () => {
      try {
        await page.screencast.stop();
      } finally {
        await queue;
        // Hold the final frame up to now, then flush it.
        if (!frameError) await fillUntil(Date.now() + frameMs);
        ffmpeg.stdin.end();
        // Without valid frames ffmpeg fails as well; the frame error is the cause.
        if (frameError)
          throw await exited.then(
            () => frameError,
            () => frameError,
          );
        await exited;
      }
    },
  };
};
