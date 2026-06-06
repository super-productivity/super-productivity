import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCAN_MARKDOWN_DIRECTORY_SCRIPT } from './scan-script';
import type { ScanMarkdownDirectoryResult } from './types';

const runScanScript = async (rootPath: string): Promise<ScanMarkdownDirectoryResult> => {
  const fn = new Function(
    'require',
    'args',
    `return (async function() { ${SCAN_MARKDOWN_DIRECTORY_SCRIPT} })();`,
  ) as (requireFn: NodeRequire, args: string[]) => Promise<ScanMarkdownDirectoryResult>;
  return fn(require, [rootPath]);
};

test('scan script recursively reads markdown files and ignores hidden support folders', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  fs.mkdirSync(path.join(root, 'Folder A', 'Project Xy'), { recursive: true });
  fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Root.md'), '# Root Note\nBody');
  fs.writeFileSync(path.join(root, 'Folder A', 'Project Xy', 'Daily.markdown'), 'Daily');
  fs.writeFileSync(path.join(root, '.obsidian', 'Ignored.md'), 'Ignored');
  fs.writeFileSync(path.join(root, 'Todo.txt'), 'Ignored');

  const result = await runScanScript(root);

  assert.equal(result.success, true);
  assert.equal(result.notes.length, 2);
  assert.deepEqual(result.notes.map((note) => note.relativePath).sort(), [
    'Folder A/Project Xy/Daily.markdown',
    'Root.md',
  ]);
  assert.ok(result.notes.every((note) => path.isAbsolute(note.path)));
});

test('scan script keeps duplicate leaf folders distinct via absolute directory paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  const first = path.join(root, 'Folder A', 'Project Xy');
  const second = path.join(root, 'Folder B', 'Folder C', 'Project Xy');
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(first, 'One.md'), '# One');
  fs.writeFileSync(path.join(second, 'Two.md'), '# Two');

  const result = await runScanScript(root);

  assert.equal(result.success, true);
  assert.deepEqual(
    result.notes.map((note) => note.dirPath).sort(),
    [first, second].sort(),
  );
});
