import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startRecording } from './recorder';
import {
  hasCommand,
  OUTPUT_FPS,
  probeMedia,
  RECORDING_EXT,
  streamOfType,
} from './render';

test.skip(!hasCommand('ffmpeg'), 'the recorder encodes with ffmpeg');

test('records a constant-rate stream as long as the capture', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-recorder-'));
  try {
    const file = path.join(dir, `capture${RECORDING_EXT}`);
    await page.setContent('<h1 id="n">0</h1>');
    const recording = await startRecording(page, {
      path: file,
      size: { width: 1280, height: 720 },
    });
    // A burst of repaints, then a still stretch Chrome sends no frames for.
    for (let i = 1; i <= 10; i++) {
      await page.evaluate((n) => (document.getElementById('n')!.textContent = n), `${i}`);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1000);
    await recording.stop();
    const elapsedS = (Date.now() - recording.startedAtMs) / 1000;

    const probe = probeMedia(file);
    const video = streamOfType(probe, 'video');
    expect(video?.width).toBe(1280);
    expect(video?.height).toBe(720);
    expect(video?.avg_frame_rate).toBe(`${OUTPUT_FPS}/1`);
    const durationS = Number(probe.format?.duration);
    expect(durationS).toBeGreaterThan(elapsedS - 0.3);
    expect(durationS).toBeLessThanOrEqual(elapsedS + 0.1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects frames smaller than the requested size', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-recorder-'));
  try {
    await page.setContent('<h1>small</h1>');
    // No recorderLaunchArgs here, so Chrome stays at the 1280x720 CSS size.
    const recording = await startRecording(page, {
      path: path.join(dir, `capture${RECORDING_EXT}`),
      size: { width: 2560, height: 1440 },
    });
    await page.evaluate(() => (document.body.style.background = '#eee'));
    await page.waitForTimeout(200);
    await expect(recording.stop()).rejects.toThrow(
      /frames are 1280x720, expected 2560x1440/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
