import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findLatestRecording,
  logOutputs,
  readRecordingTrim,
  trimPathFor,
} from './render';

test('selects the latest recording with its own trim metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-recordings-'));
  try {
    const completed = path.join(dir, 'completed.mkv');
    const failed = path.join(dir, 'failed.mkv');
    fs.writeFileSync(completed, 'video');
    fs.writeFileSync(trimPathFor(completed), '{}');
    fs.writeFileSync(failed, 'video');
    fs.utimesSync(failed, new Date(), new Date(Date.now() + 1000));

    expect(findLatestRecording(dir)).toBe(completed);

    fs.rmSync(trimPathFor(completed));
    expect(() => findLatestRecording(dir)).toThrow(/No successful \.mkv recording/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lists only outputs passed to the build log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-outputs-'));
  const lines: string[] = [];
  const originalLog = console.log;
  try {
    const generated = path.join(dir, 'reel.mp4');
    const stale = path.join(dir, 'reel.webm');
    fs.writeFileSync(generated, 'new');
    fs.writeFileSync(stale, 'old');
    console.log = (line: string): void => {
      lines.push(line);
    };

    logOutputs([generated], dir);

    expect(lines.join('\n')).toContain('reel.mp4');
    expect(lines.join('\n')).not.toContain('reel.webm');
  } finally {
    console.log = originalLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects missing, malformed, and mismatched trim metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-trim-'));
  const recording = path.join(dir, 'capture.mkv');
  const sidecar = path.join(dir, 'capture.trim.json');
  try {
    expect(() => readRecordingTrim(recording, 'mobile')).toThrow(/Missing or unreadable/);

    fs.writeFileSync(
      sidecar,
      JSON.stringify({ offsetMs: 1000, endOffsetMs: 2000, variant: 'full' }),
    );
    expect(() => readRecordingTrim(recording, 'mobile')).toThrow(/Invalid trim metadata/);

    fs.writeFileSync(
      sidecar,
      JSON.stringify({ offsetMs: 3000, endOffsetMs: 2000, variant: 'mobile' }),
    );
    expect(() => readRecordingTrim(recording, 'mobile')).toThrow(/Invalid trim metadata/);

    fs.writeFileSync(
      sidecar,
      JSON.stringify({ offsetMs: 1000, endOffsetMs: 2000, variant: 'mobile' }),
    );
    expect(readRecordingTrim(recording, 'mobile').offsetMs).toBe(1000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
