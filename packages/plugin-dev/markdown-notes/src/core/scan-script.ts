const UTF8_DECODER_SCRIPT = `
const decodeUtf8 = (bytes, length) => {
  let output = '';
  let index = 0;
  const replacement = '\\uFFFD';
  const appendCodePoint = (codePoint) => {
    if (codePoint <= 0xffff) {
      output += String.fromCharCode(codePoint);
      return;
    }
    const offset = codePoint - 0x10000;
    output += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
  };

  while (index < length) {
    const first = bytes[index++];
    if (first < 0x80) {
      output += String.fromCharCode(first);
      continue;
    }

    let needed = 0;
    let codePoint = 0;
    let minCodePoint = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      needed = 1;
      codePoint = first & 0x1f;
      minCodePoint = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      needed = 2;
      codePoint = first & 0x0f;
      minCodePoint = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      needed = 3;
      codePoint = first & 0x07;
      minCodePoint = 0x10000;
    } else {
      output += replacement;
      continue;
    }

    if (index + needed > length) {
      output += replacement;
      break;
    }

    let isValid = true;
    for (let offset = 0; offset < needed; offset++) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) {
        isValid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }

    if (
      !isValid ||
      codePoint < minCodePoint ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      output += replacement;
      continue;
    }

    index += needed;
    appendCodePoint(codePoint);
  }

  return output;
};
`;

export const SCAN_MARKDOWN_DIRECTORY_SCRIPT = `
const fs = require('fs');
const path = require('path');

const [rootPathArg] = args;
const rootInput = String(rootPathArg || '');
const TITLE_READ_BYTES = 64 * 1024;
const ignoredDirectoryNames = new Set([
  '.git',
  '.hg',
  '.obsidian',
  '.stfolder',
  '.trash',
  'node_modules',
]);

const toPosixRelativePath = (value) => value.split(path.sep).join('/');
const isMarkdownFile = (name) => /\\.(md|markdown)$/i.test(name);
const shouldSkipDirectory = (name) =>
  name.startsWith('.') || ignoredDirectoryNames.has(name);
${UTF8_DECODER_SCRIPT}

const readTitleChunk = (filePath) => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = new Uint8Array(TITLE_READ_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, TITLE_READ_BYTES, 0);
    return decodeUtf8(buffer, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
};

const extractTitle = (fileName, content) => {
  const heading = content.match(/^#\\s+(.+)$/m);
  if (heading && heading[1].trim()) {
    return heading[1].trim();
  }
  return fileName.replace(/\\.(md|markdown)$/i, '');
};

try {
  const rootPath = path.resolve(rootInput);
  const rootStats = fs.statSync(rootPath);
  if (!rootStats.isDirectory()) {
    return {
      success: false,
      rootPath,
      notes: [],
      errors: [],
      scannedAt: Date.now(),
      error: 'Path is not a directory',
    };
  }

  const notes = [];
  const errors = [];

  const walk = (dirPath) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
      errors.push({
        path: dirPath,
        message: error && error.message ? error.message : String(error),
      });
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) {
          walk(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || !isMarkdownFile(entry.name)) {
        continue;
      }

      try {
        const stats = fs.statSync(absolutePath);
        const titleChunk = readTitleChunk(absolutePath);
        const relativePath = toPosixRelativePath(path.relative(rootPath, absolutePath));
        const relativeDirRaw = path.dirname(relativePath);
        notes.push({
          id: absolutePath,
          path: absolutePath,
          relativePath,
          dirPath: path.dirname(absolutePath),
          relativeDir: relativeDirRaw === '.' ? '' : relativeDirRaw,
          fileName: entry.name,
          title: extractTitle(entry.name, titleChunk),
          modified: stats.mtimeMs,
          size: stats.size,
        });
      } catch (error) {
        errors.push({
          path: absolutePath,
          message: error && error.message ? error.message : String(error),
        });
      }
    }
  };

  walk(rootPath);

  return {
    success: true,
    rootPath,
    notes,
    errors,
    scannedAt: Date.now(),
  };
} catch (error) {
  return {
    success: false,
    rootPath: rootInput,
    notes: [],
    errors: [],
    scannedAt: Date.now(),
    error: error && error.message ? error.message : String(error),
  };
}
`;

export const READ_MARKDOWN_NOTE_SCRIPT = `
const fs = require('fs');
const path = require('path');

const [rootPathArg, notePathArg] = args;
const rootInput = String(rootPathArg || '');
const noteInput = String(notePathArg || '');
const MAX_READ_BYTES = 1024 * 1024;
const isMarkdownFile = (name) => /\\.(md|markdown)$/i.test(name);
${UTF8_DECODER_SCRIPT}

const emptyFailure = (error, resolvedPath) => ({
  success: false,
  path: resolvedPath || noteInput,
  content: '',
  modified: 0,
  size: 0,
  truncated: false,
  error,
});

try {
  const rootPath = path.resolve(rootInput);
  const notePath = path.resolve(noteInput);
  const relative = path.relative(rootPath, notePath);

  if (!rootInput || !noteInput) {
    return emptyFailure('Missing root path or note path', notePath);
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return emptyFailure('Note path is outside the selected markdown root', notePath);
  }
  if (!isMarkdownFile(notePath)) {
    return emptyFailure('Note path is not a markdown file', notePath);
  }

  const rootStats = fs.statSync(rootPath);
  if (!rootStats.isDirectory()) {
    return emptyFailure('Root path is not a directory', notePath);
  }

  const stats = fs.statSync(notePath);
  if (!stats.isFile()) {
    return emptyFailure('Note path is not a file', notePath);
  }

  const fd = fs.openSync(notePath, 'r');
  try {
    const bytesToRead = Math.min(stats.size, MAX_READ_BYTES);
    const buffer = new Uint8Array(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, 0);
    return {
      success: true,
      path: notePath,
      content: decodeUtf8(buffer, bytesRead),
      modified: stats.mtimeMs,
      size: stats.size,
      truncated: stats.size > MAX_READ_BYTES,
    };
  } finally {
    fs.closeSync(fd);
  }
} catch (error) {
  return emptyFailure(error && error.message ? error.message : String(error));
}
`;
