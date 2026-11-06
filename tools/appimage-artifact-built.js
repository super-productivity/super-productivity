'use strict';

// This runs *before* electron-builder queues the AppImage upload. Running the
// repack in afterAllArtifactBuild would race the original upload and leave its
// generated update-info checksum stale.
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APPIMAGE_NAME = 'superProductivity-x86_64.AppImage';
const generatedZsyncFiles = new Set();

function resolveUpdateChannel(env = process.env) {
  if (env.APPIMAGE_UPDATE_CHANNEL) return env.APPIMAGE_UPDATE_CHANNEL;

  // Only release tags select the prerelease channel.
  const ref = env.GITHUB_REF || '';
  if (!ref.startsWith('refs/tags/')) return 'latest';

  const tag = ref.slice('refs/tags/'.length);
  return /(?:rc|beta|alpha)/i.test(tag) ? 'latest-pre' : 'latest';
}

// Pin the upstream binary used on CI, rather than relying on a mutable
// 'continuous' release. Downloaded bytes are verified before execution.
const APPIMAGETOOL_URL =
  'https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage';
const APPIMAGETOOL_SHA256 =
  'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0';

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function prepareAppImageTool() {
  // Only the project's x86_64 Linux CI job needs bootstrapping.
  // Interactive/local builds still skip cleanly when tools are absent.
  if (!process.env.CI || process.platform !== 'linux' || process.arch !== 'x64') {
    return null;
  }

  const cache = path.join(os.tmpdir(), 'super-productivity-appimagetool-1.9.1');
  const tool = path.join(cache, 'appimagetool-x86_64.AppImage');
  const partial = path.join(cache, `appimagetool-${process.pid}.partial`);
  try {
    fs.mkdirSync(cache, { recursive: true });
    if (fs.existsSync(tool) && fileSha256(tool) === APPIMAGETOOL_SHA256) {
      fs.chmodSync(tool, 0o755);
      return tool;
    }
    fs.rmSync(tool, { force: true });
    execFileSync(
      'curl',
      [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--retry',
        '3',
        '--connect-timeout',
        '10',
        '--max-time',
        '120',
        '--output',
        partial,
        APPIMAGETOOL_URL,
      ],
      { stdio: 'inherit' },
    );
    if (fileSha256(partial) !== APPIMAGETOOL_SHA256) {
      throw new Error('Pinned appimagetool SHA-256 mismatch');
    }
    fs.chmodSync(partial, 0o755);
    fs.renameSync(partial, tool);
    return tool;
  } catch (error) {
    console.warn(`[appimage-delta] Pinned appimagetool unavailable: ${error.message}`);
    return null;
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

function isAvailable(command) {
  // Check PATH/absolute executable without invoking potentially slow tools.
  const result = spawnSync(
    'bash',
    ['-c', 'command -v "$1" >/dev/null 2>&1', 'bash', command],
    {
      stdio: 'ignore',
    },
  );
  return !result.error && result.status === 0;
}

function getAppImageTool() {
  return (
    process.env.APPIMAGETOOL || path.join(os.homedir(), '.local', 'bin', 'appimagetool')
  );
}

function readBlockMapSize(image) {
  const fd = fs.openSync(image, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 5) throw new Error('AppImage is too short to contain a blockmap');
    const end = Buffer.alloc(4);
    if (fs.readSync(fd, end, 0, 4, size - 4) !== 4) {
      throw new Error('Cannot read embedded AppImage blockmap');
    }
    const blockMapSize = end.readUInt32BE(0);
    if (blockMapSize <= 0 || blockMapSize >= size - 4) {
      throw new Error('Invalid AppImage blockmap length');
    }
    return blockMapSize;
  } finally {
    fs.closeSync(fd);
  }
}

function sha512(image) {
  return crypto.createHash('sha512').update(fs.readFileSync(image)).digest('base64');
}

async function processArtifact(event, dependencies = {}) {
  const {
    available = isAvailable,
    run = execFileSync,
    appimagetool = getAppImageTool(),
    script = path.join(__dirname, 'repack-appimage-zsync.sh'),
    prepare = prepareAppImageTool,
    rename = fs.renameSync,
  } = dependencies;

  if (!event.file || event.target?.name !== 'appImage') return false;
  if (path.basename(event.file) !== APPIMAGE_NAME) {
    console.warn(
      `[appimage-delta] Skipping unsupported AppImage: ${path.basename(event.file)}`,
    );
    return false;
  }

  // The stock Ubuntu GitHub runner provides zsyncmake, but may not provide
  // appimagetool. Missing zsyncmake always skips without touching the artifact.
  if (!available('zsyncmake')) {
    console.warn('[appimage-delta] zsyncmake unavailable; preserving original AppImage');
    return false;
  }
  let tool = appimagetool;
  if (!available(tool)) {
    tool = await prepare();
  }
  if (!tool || !available(tool)) {
    console.warn(
      '[appimage-delta] appimagetool unavailable; preserving original AppImage',
    );
    return false;
  }

  // The existing PR script repacks with embedded update info, appends a fresh
  // electron-builder blockmap and regenerates zsync against the final bytes.
  const tmpDir = fs.mkdtempSync(path.join(path.dirname(event.file), '.appimage-delta-'));
  let keepBackup = false;
  try {
    run('bash', [script, event.file, tmpDir], {
      stdio: 'inherit',
      env: {
        ...process.env,
        APPIMAGETOOL: tool,
        APPIMAGE_UPDATE_CHANNEL: resolveUpdateChannel(),
      },
    });
    const replacement = path.join(tmpDir, APPIMAGE_NAME);
    const zsyncReplacement = `${replacement}.zsync`;
    if (!fs.statSync(replacement).size || !fs.statSync(zsyncReplacement).size) {
      throw new Error('Rebuilt AppImage or zsync is empty');
    }

    const blockMapSize = readBlockMapSize(replacement);
    const digest = sha512(replacement);
    const zsyncPath = `${event.file}.zsync`;

    // Back up the original before replacing either file. If sidecar
    // installation fails, restore the matching original AppImage.
    const backup = path.join(tmpDir, 'original.AppImage');
    fs.linkSync(event.file, backup);
    let imageReplaced = false;
    try {
      rename(replacement, event.file);
      imageReplaced = true;
      rename(zsyncReplacement, zsyncPath);
    } catch (error) {
      if (imageReplaced) {
        try {
          fs.renameSync(backup, event.file);
        } catch (restoreError) {
          keepBackup = true;
          throw new AggregateError(
            [error, restoreError],
            '[appimage-delta] Rollback failed; original AppImage preserved at ' + backup,
          );
        }
      }
      throw error;
    }
    event.updateInfo = { ...event.updateInfo, sha512: digest, blockMapSize };
    generatedZsyncFiles.add(zsyncPath);
    console.log(`[appimage-delta] Prepared ${APPIMAGE_NAME} and its zsync`);
    return true;
  } finally {
    if (!keepBackup) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = processArtifact;
module.exports.generatedZsyncFiles = generatedZsyncFiles;
module.exports.readBlockMapSize = readBlockMapSize;

module.exports.prepareAppImageTool = prepareAppImageTool;
module.exports.resolveUpdateChannel = resolveUpdateChannel;
