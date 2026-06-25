import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { groupNotes } from './group-notes';
import type { MarkdownNote, ProjectOption } from './types';

const rootPath = path.resolve('/vault');

const note = (partial: Partial<MarkdownNote>): MarkdownNote => ({
  id: partial.path ?? 'note-id',
  path: partial.path ?? path.join(rootPath, 'Note.md'),
  relativePath: partial.relativePath ?? 'Note.md',
  dirPath: partial.dirPath ?? rootPath,
  relativeDir: partial.relativeDir ?? '',
  fileName: partial.fileName ?? 'Note.md',
  title: partial.title ?? 'Note',
  modified: partial.modified ?? 1,
  size: partial.size ?? 7,
});

test('groupNotes uses absolute directory paths as stable group keys', () => {
  const firstDir = path.join(rootPath, 'Folder A', 'Project Xy');
  const secondDir = path.join(rootPath, 'Folder B', 'Folder C', 'Project Xy');
  const groups = groupNotes(
    [
      note({
        path: path.join(firstDir, 'One.md'),
        dirPath: firstDir,
        relativeDir: 'Folder A/Project Xy',
      }),
      note({
        path: path.join(secondDir, 'Two.md'),
        dirPath: secondDir,
        relativeDir: 'Folder B/Folder C/Project Xy',
      }),
    ],
    rootPath,
    {},
    [],
  );

  assert.deepEqual(groups.map((group) => group.key).sort(), [firstDir, secondDir].sort());
  assert.deepEqual(groups.map((group) => group.displayPath).sort(), [
    'Folder A / Project Xy',
    'Folder B / Folder C / Project Xy',
  ]);
});

test('groupNotes stores project mappings by absolute directory path', () => {
  const firstDir = path.join(rootPath, 'Folder A', 'Project Xy');
  const secondDir = path.join(rootPath, 'Folder B', 'Folder C', 'Project Xy');
  const projects: ProjectOption[] = [
    { id: 'project-1', title: 'Project Xy', folderPath: 'Folder A' },
    { id: 'project-2', title: 'Project Xy', folderPath: 'Folder B / Folder C' },
  ];

  const groups = groupNotes(
    [
      note({
        path: path.join(firstDir, 'One.md'),
        dirPath: firstDir,
        relativeDir: 'Folder A/Project Xy',
      }),
      note({
        path: path.join(secondDir, 'Two.md'),
        dirPath: secondDir,
        relativeDir: 'Folder B/Folder C/Project Xy',
      }),
    ],
    rootPath,
    {
      [firstDir]: 'project-1',
      [secondDir]: 'project-2',
    },
    projects,
  );

  assert.equal(groups.find((group) => group.key === firstDir)?.project?.id, 'project-1');
  assert.equal(groups.find((group) => group.key === secondDir)?.project?.id, 'project-2');
});
