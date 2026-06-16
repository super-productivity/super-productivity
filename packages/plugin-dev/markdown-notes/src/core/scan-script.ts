export const SCAN_MARKDOWN_DIRECTORY_SCRIPT = `
const fs = require('fs');
const path = require('path');

const [rootPathArg] = args;
const rootInput = String(rootPathArg || '');
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
        const content = fs.readFileSync(absolutePath, 'utf8');
        const relativePath = toPosixRelativePath(path.relative(rootPath, absolutePath));
        const relativeDirRaw = path.dirname(relativePath);
        notes.push({
          id: absolutePath,
          path: absolutePath,
          relativePath,
          dirPath: path.dirname(absolutePath),
          relativeDir: relativeDirRaw === '.' ? '' : relativeDirRaw,
          fileName: entry.name,
          title: extractTitle(entry.name, content),
          content,
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
