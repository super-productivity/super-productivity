import type { MarkdownNote, MarkdownNoteGroup, ProjectOption } from './types';

const normalizeRelativeDir = (relativeDir: string): string =>
  relativeDir
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ');

const rootGroupTitle = (rootPath: string): string => {
  const normalized = rootPath.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || 'Root';
};

export const groupNotes = (
  notes: MarkdownNote[],
  rootPath: string,
  projectMappings: Record<string, string>,
  projects: ProjectOption[],
): MarkdownNoteGroup[] => {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const groupsByDir = new Map<string, MarkdownNote[]>();

  for (const note of notes) {
    const existing = groupsByDir.get(note.dirPath) ?? [];
    existing.push(note);
    groupsByDir.set(note.dirPath, existing);
  }

  return [...groupsByDir.entries()]
    .map(([dirPath, groupNotesForDir]) => {
      const sortedNotes = [...groupNotesForDir].sort(
        (a, b) =>
          a.title.localeCompare(b.title) || a.relativePath.localeCompare(b.relativePath),
      );
      const relativeDir = sortedNotes[0]?.relativeDir ?? '';
      const displayPath = relativeDir
        ? normalizeRelativeDir(relativeDir)
        : rootGroupTitle(rootPath);
      const title = displayPath.split(' / ').at(-1) || displayPath;
      const projectId = projectMappings[dirPath] ?? null;
      const project = projectId ? (projectsById.get(projectId) ?? null) : null;

      return {
        key: dirPath,
        dirPath,
        relativeDir,
        title,
        displayPath,
        notes: sortedNotes,
        projectId,
        project,
      } satisfies MarkdownNoteGroup;
    })
    .sort((a, b) => a.displayPath.localeCompare(b.displayPath));
};
