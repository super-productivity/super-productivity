'use strict';

// This hook must finish before electron-builder queues the AppImage upload.
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readEmbeddedBlockmap, writeUpdateInfo } = require('./appimage-update-info');

const APPIMAGE_NAME = 'superProductivity-x86_64.AppImage';
const generatedZsyncFiles = new Set();

function resolveUpdateChannel(env = process.env) {
  if (env.APPIMAGE_UPDATE_CHANNEL) return env.APPIMAGE_UPDATE_CHANNEL;
  const ref = env.GITHUB_REF || '';
  if (!ref.startsWith('refs/tags/')) return 'latest';
  const tag = ref.slice('refs/tags/'.length);
  return /(?:rc|beta|alpha)/i.test(tag) ? 'latest-pre' : 'latest';
}

function isReleaseBuild(env = process.env) {
  // Explicit local opt-in exists for packaging tests; ordinary branch builds skip.
  return env.APPIMAGE_DELTA_TEST === '1' || /^refs\/tags\/v/.test(env.GITHUB_REF || '');
}

function isAvailable(command) {
  const result = spawnSync(
    'bash',
    ['-c', 'command -v "$1" >/dev/null 2>&1', 'bash', command],
    {
      stdio: 'ignore',
    },
  );
  return !result.error && result.status === 0;
}

async function fileHash(file, algorithm, encoding) {
  const digest = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest(encoding);
}

async function verifyZsync(image, sidecar) {
  if (!fs.statSync(sidecar).size) throw new Error('Empty zsync sidecar');
  const fd = fs.openSync(sidecar, 'r');
  let header;
  try {
    const buffer = Buffer.alloc(Math.min(65536, fs.fstatSync(fd).size));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    header = buffer.toString('utf8').split(/\r?\n\r?\n/, 1)[0];
  } finally {
    fs.closeSync(fd);
  }
  const fields = Object.fromEntries(
    header
      .split(/\r?\n/)
      .filter((line) => line.includes(': '))
      .map((line) => {
        const separator = line.indexOf(': ');
        return [line.slice(0, separator), line.slice(separator + 2)];
      }),
  );
  if (
    Number(fields.Length) !== fs.statSync(image).size ||
    fields.Filename !== APPIMAGE_NAME ||
    fields.URL !== APPIMAGE_NAME ||
    fields['SHA-1'] !== (await fileHash(image, 'sha1', 'hex'))
  ) {
    throw new Error('zsync metadata does not match final AppImage');
  }
}

async function defaultAppendBlockmap(file) {
  const {
    appendBlockmap,
  } = require('app-builder-lib/out/targets/differentialUpdateInfoBuilder');
  return appendBlockmap(file);
}

async function processArtifact(event, dependencies = {}) {
  const {
    available = isAvailable,
    run = execFileSync,
    appendBlockmap = defaultAppendBlockmap,
    rename = fs.renameSync,
    env = process.env,
  } = dependencies;

  if (!event.file || event.target?.name !== 'appImage') return false;
  if (path.basename(event.file) !== APPIMAGE_NAME) {
    console.warn(
      `[appimage-delta] Skipping unsupported AppImage: ${path.basename(event.file)}`,
    );
    return false;
  }
  if (!isReleaseBuild(env)) return false;
  if (!available('zsyncmake')) {
    console.warn('[appimage-delta] zsyncmake unavailable; preserving original AppImage');
    return false;
  }

  const tmpDir = fs.mkdtempSync(path.join(path.dirname(event.file), '.appimage-delta-'));
  let keepBackup = false;
  try {
    const staged = path.join(tmpDir, APPIMAGE_NAME);
    const sidecar = `${staged}.zsync`;
    fs.copyFileSync(event.file, staged);

    // Remove the old differential blockmap before changing the image bytes.
    // Only ELF .upd_info changes; the runtime and SquashFS payload stay intact.
    const oldBlockmap = readEmbeddedBlockmap(staged);
    fs.truncateSync(staged, oldBlockmap.start);
    const channel = resolveUpdateChannel(env);
    if (!['latest', 'latest-pre'].includes(channel)) {
      throw new Error(`Unsupported AppImage update channel: ${channel}`);
    }
    const info = `gh-releases-zsync|super-productivity|super-productivity|${channel}|${APPIMAGE_NAME}.zsync`;
    writeUpdateInfo(staged, info);

    const blockmap = await appendBlockmap(staged);
    if (!blockmap?.blockMapSize)
      throw new Error('Unable to regenerate embedded blockmap');
    readEmbeddedBlockmap(staged);

    // zsync must hash the final bytes, including the regenerated blockmap.
    run('zsyncmake', ['-u', APPIMAGE_NAME, '-o', sidecar, staged], { stdio: 'pipe' });
    await verifyZsync(staged, sidecar);
    const digest = await fileHash(staged, 'sha512', 'base64');

    const backup = path.join(tmpDir, 'original.AppImage');
    fs.linkSync(event.file, backup);
    let imageReplaced = false;
    try {
      rename(staged, event.file);
      imageReplaced = true;
      rename(sidecar, `${event.file}.zsync`);
    } catch (error) {
      if (imageReplaced) {
        try {
          fs.renameSync(backup, event.file);
        } catch (restoreError) {
          keepBackup = true;
          throw new AggregateError(
            [error, restoreError],
            `[appimage-delta] Rollback failed; original AppImage preserved at ${backup}`,
          );
        }
      }
      throw error;
    }

    event.updateInfo = {
      ...event.updateInfo,
      sha512: digest,
      blockMapSize: blockmap.blockMapSize,
    };
    generatedZsyncFiles.add(`${event.file}.zsync`);
    console.log(`[appimage-delta] Prepared ${APPIMAGE_NAME} and matching zsync`);
    return true;
  } catch (error) {
    if (keepBackup) throw error;
    console.warn(`[appimage-delta] Skipping delta updates: ${error.message}`);
    return false;
  } finally {
    if (!keepBackup) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = processArtifact;
module.exports.generatedZsyncFiles = generatedZsyncFiles;
module.exports.isReleaseBuild = isReleaseBuild;
module.exports.resolveUpdateChannel = resolveUpdateChannel;
