/**
 * Opens the generated marketing reel after `npm run video` finishes building.
 *
 * Kept separate from `build-video.ts` so `npm run video:build` remains useful
 * for automation and CI without launching a local media player.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'dist', 'video');

const VARIANT = process.env.REEL_VARIANT ?? '';
const SUFFIX = VARIANT ? `-${VARIANT}` : '';
const PREVIEW_START_SECONDS = 0.35;

const findOutput = (): string | null => {
  const candidates = [
    `reel${SUFFIX}.mp4`,
    `reel${SUFFIX}.webm`,
    `reel${SUFFIX}.gif`,
    `reel${SUFFIX}-optimized.gif`,
  ].map((fileName) => path.join(OUT_DIR, fileName));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const writePreview = (videoPath: string): string => {
  const previewPath = path.join(OUT_DIR, `preview${SUFFIX}.html`);
  const videoFileName = JSON.stringify(`./${path.basename(videoPath)}`);
  const startSeconds = JSON.stringify(PREVIEW_START_SECONDS);
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>Super Productivity reel preview</title>',
    '  <style>',
    '    html, body {',
    '      margin: 0;',
    '      min-height: 100%;',
    '      background: #050507;',
    '    }',
    '    body {',
    '      display: grid;',
    '      place-items: center;',
    '    }',
    '    video {',
    '      max-width: 100vw;',
    '      max-height: 100vh;',
    '      width: auto;',
    '      height: auto;',
    '      background: #000;',
    '    }',
    '  </style>',
    '</head>',
    '<body>',
    `  <video id="reel" src=${videoFileName} controls autoplay muted loop playsinline></video>`,
    '  <script>',
    '    const video = document.getElementById("reel");',
    `    const startSeconds = ${startSeconds};`,
    '    const start = () => {',
    '      if (Number.isFinite(video.duration) && video.duration > startSeconds) {',
    '        video.currentTime = startSeconds;',
    '      }',
    '      video.play().catch(() => undefined);',
    '    };',
    '    video.addEventListener("loadedmetadata", start, { once: true });',
    '  </script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  fs.writeFileSync(previewPath, html);
  return previewPath;
};

const openFile = (filePath: string): void => {
  const platform = process.platform;
  const command =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', filePath] : [filePath];

  const result = spawnSync(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? `exit status ${result.status}`;
    console.warn(
      `[video] could not open ${path.relative(REPO_ROOT, filePath)}: ${detail}`,
    );
  }
};

const main = (): void => {
  if (process.env.CI) {
    console.log('[video] CI detected; skipping auto-open.');
    return;
  }

  const output = findOutput();
  if (!output) {
    console.warn(
      `[video] no built reel found under ${path.relative(REPO_ROOT, OUT_DIR)}`,
    );
    return;
  }

  const preview = writePreview(output);
  console.log(
    `[video] opening ${path.relative(REPO_ROOT, preview)} for ${path.relative(
      REPO_ROOT,
      output,
    )}`,
  );
  openFile(preview);
};

main();
