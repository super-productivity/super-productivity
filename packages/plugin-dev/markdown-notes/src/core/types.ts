export interface MarkdownNote {
  id: string;
  path: string;
  relativePath: string;
  dirPath: string;
  relativeDir: string;
  fileName: string;
  title: string;
  modified: number;
  size: number;
}

export interface ScanError {
  path: string;
  message: string;
}

export interface ScanMarkdownDirectoryResult {
  success: boolean;
  rootPath: string;
  notes: MarkdownNote[];
  errors: ScanError[];
  scannedAt: number;
  error?: string;
}

export interface ReadMarkdownNoteResult {
  success: boolean;
  path: string;
  content: string;
  modified: number;
  size: number;
  truncated: boolean;
  error?: string;
}

export interface ProjectOption {
  id: string;
  title: string;
  folderPath?: string | null;
}

export interface MarkdownNoteGroup {
  key: string;
  dirPath: string;
  relativeDir: string;
  title: string;
  displayPath: string;
  notes: MarkdownNote[];
  projectId: string | null;
  project: ProjectOption | null;
}

export interface MarkdownNotesConfig {
  rootPath: string;
  projectMappings: Record<string, string>;
}
