import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { READ_MARKDOWN_NOTE_SCRIPT, SCAN_MARKDOWN_DIRECTORY_SCRIPT } from './scan-script';
import type { ReadMarkdownNoteResult, ScanMarkdownDirectoryResult } from './types';

const runScanScript = async (rootPath: string): Promise<ScanMarkdownDirectoryResult> => {
  const fn = new Function(
    'require',
    'args',
    `return (async function() { ${SCAN_MARKDOWN_DIRECTORY_SCRIPT} })();`,
  ) as (requireFn: NodeRequire, args: string[]) => Promise<ScanMarkdownDirectoryResult>;
  return fn(require, [rootPath]);
};

const runReadScript = async (
  rootPath: string,
  notePath: string,
): Promise<ReadMarkdownNoteResult> => {
  const fn = new Function(
    'require',
    'args',
    `return (async function() { ${READ_MARKDOWN_NOTE_SCRIPT} })();`,
  ) as (requireFn: NodeRequire, args: string[]) => Promise<ReadMarkdownNoteResult>;
  return fn(require, [rootPath, notePath]);
};

const runScanScriptInDirectExecutorSandbox = async (
  rootPath: string,
): Promise<ScanMarkdownDirectoryResult> => {
  const sandbox = {
    require: (moduleName: string): unknown => {
      if (moduleName === 'fs') return fs;
      if (moduleName === 'path') return path;
      if (moduleName === 'os') return os;
      throw new Error(`Module '${moduleName}' is not allowed`);
    },
    JSON,
    args: [rootPath],
    __result: undefined as ScanMarkdownDirectoryResult | undefined,
  };
  const context = vm.createContext(sandbox);
  const wrappedScript = `
    (async function() {
      const result = await (async function() {
        ${SCAN_MARKDOWN_DIRECTORY_SCRIPT}
      })();
      __result = result;
    })().catch(err => { throw err; });
  `;

  await vm.runInContext(wrappedScript, context, { timeout: 5000 });
  if (!sandbox.__result) throw new Error('Missing scan result');
  return sandbox.__result;
};

const runReadScriptInDirectExecutorSandbox = async (
  rootPath: string,
  notePath: string,
): Promise<ReadMarkdownNoteResult> => {
  const sandbox = {
    require: (moduleName: string): unknown => {
      if (moduleName === 'fs') return fs;
      if (moduleName === 'path') return path;
      if (moduleName === 'os') return os;
      throw new Error(`Module '${moduleName}' is not allowed`);
    },
    JSON,
    args: [rootPath, notePath],
    __result: undefined as ReadMarkdownNoteResult | undefined,
  };
  const context = vm.createContext(sandbox);
  const wrappedScript = `
    (async function() {
      const result = await (async function() {
        ${READ_MARKDOWN_NOTE_SCRIPT}
      })();
      __result = result;
    })().catch(err => { throw err; });
  `;

  await vm.runInContext(wrappedScript, context, { timeout: 5000 });
  if (!sandbox.__result) throw new Error('Missing read result');
  return sandbox.__result;
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

test('scan script returns markdown metadata without note content', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  fs.writeFileSync(path.join(root, 'Root.md'), '# Root Note\nSecret body');

  const result = await runScanScript(root);

  assert.equal(result.success, true);
  assert.equal(result.notes[0].title, 'Root Note');
  assert.equal(Object.prototype.hasOwnProperty.call(result.notes[0], 'content'), false);
});

test('scan script runs in the direct nodeExecution sandbox without Buffer global', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  fs.writeFileSync(path.join(root, 'Root.md'), '# Root Note\nBody');

  const result = await runScanScriptInDirectExecutorSandbox(root);

  assert.equal(result.success, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].title, 'Root Note');
});

test('scan script preserves valid text around invalid UTF-8 bytes in titles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  fs.writeFileSync(
    path.join(root, 'Root.md'),
    new Uint8Array([0x23, 0x20, 0x41, 0x20, 0xff, 0x20, 0x42, 0x20, 0xe2, 0x82, 0xac]),
  );

  const result = await runScanScriptInDirectExecutorSandbox(root);

  assert.equal(result.success, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.notes[0].title, 'A � B €');
});

test('read script loads selected markdown note content', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  const notePath = path.join(root, 'Root.md');
  fs.writeFileSync(notePath, '# Root Note\nBody');

  const result = await runReadScript(root, notePath);

  assert.equal(result.success, true);
  assert.equal(result.path, notePath);
  assert.equal(result.content, '# Root Note\nBody');
  assert.equal(result.truncated, false);
});

test('read script runs in the direct nodeExecution sandbox without Buffer global', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  const notePath = path.join(root, 'Root.md');
  fs.writeFileSync(notePath, '# Root Note\nBody');

  const result = await runReadScriptInDirectExecutorSandbox(root, notePath);

  assert.equal(result.success, true);
  assert.equal(result.content, '# Root Note\nBody');
});

test('read script preserves valid text around invalid UTF-8 bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  const notePath = path.join(root, 'Root.md');
  fs.writeFileSync(
    notePath,
    new Uint8Array([0x41, 0x20, 0xff, 0x20, 0x42, 0x20, 0xe2, 0x82, 0xac]),
  );

  const result = await runReadScriptInDirectExecutorSandbox(root, notePath);

  assert.equal(result.success, true);
  assert.equal(result.content, 'A � B €');
});

test('read script rejects markdown paths outside the selected root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-outside-'));
  const notePath = path.join(outsideRoot, 'Outside.md');
  fs.writeFileSync(notePath, '# Outside');

  const result = await runReadScript(root, notePath);

  assert.equal(result.success, false);
  assert.equal(result.content, '');
  assert.match(result.error ?? '', /outside/i);
});

test('read script truncates large selected notes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  const notePath = path.join(root, 'Large.md');
  const oversized = 'x'.repeat(1024 * 1024 + 128);
  fs.writeFileSync(notePath, oversized);

  const result = await runReadScript(root, notePath);

  assert.equal(result.success, true);
  assert.equal(result.truncated, true);
  assert.equal(result.content.length, 1024 * 1024);
});

test('read script replaces a truncated trailing multibyte sequence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-md-notes-'));
  const notePath = path.join(root, 'Large.md');
  const content = new Uint8Array(1024 * 1024 + 1);
  content.fill(0x61);
  content[1024 * 1024 - 1] = 0xe2;
  content[1024 * 1024] = 0x82;
  fs.writeFileSync(notePath, content);

  const result = await runReadScriptInDirectExecutorSandbox(root, notePath);

  assert.equal(result.success, true);
  assert.equal(result.truncated, true);
  assert.equal(result.content.length, 1024 * 1024);
  assert.equal(result.content.endsWith('�'), true);
});
