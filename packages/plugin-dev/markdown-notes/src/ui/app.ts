import { marked } from 'marked';
import type { PluginAPI, Project } from '@super-productivity/plugin-api';
import { groupNotes } from '../core/group-notes';
import {
  READ_MARKDOWN_NOTE_SCRIPT,
  SCAN_MARKDOWN_DIRECTORY_SCRIPT,
} from '../core/scan-script';
import { sanitizeMarkdownHtml } from '../core/markdown-sanitizer';
import { loadMarkdownNotesConfig, saveMarkdownNotesConfig } from '../core/config-storage';
import type {
  MarkdownNote,
  MarkdownNoteGroup,
  MarkdownNotesConfig,
  ProjectOption,
  ReadMarkdownNoteResult,
  ScanError,
  ScanMarkdownDirectoryResult,
} from '../core/types';

declare global {
  interface Window {
    PluginAPI?: PluginAPI;
  }
}

const AUTO_REFRESH_MS = 30000;
const SEARCH_DEBOUNCE_MS = 150;

interface PreviewCacheEntry {
  content: string;
  modified: number;
  size: number;
  truncated: boolean;
}

interface PreviewState {
  noteId: string | null;
  content: string;
  isLoading: boolean;
  error: string | null;
  truncated: boolean;
}

interface AppState {
  config: MarkdownNotesConfig;
  projects: ProjectOption[];
  notes: MarkdownNote[];
  groups: MarkdownNoteGroup[];
  selectedNoteId: string | null;
  search: string;
  status: string;
  error: string | null;
  isLoading: boolean;
  scannedAt: number | null;
  scanErrors: ScanError[];
  preview: PreviewState;
  previewCache: Map<string, PreviewCacheEntry>;
  readSeq: number;
  queuedRefresh: boolean;
}

const api = window.PluginAPI;
const appEl = document.getElementById('app');

if (!appEl) {
  throw new Error('Missing app root');
}

const emptyConfig = (): MarkdownNotesConfig => ({
  rootPath: '',
  projectMappings: {},
});

const state: AppState = {
  config: emptyConfig(),
  projects: [],
  notes: [],
  groups: [],
  selectedNoteId: null,
  search: '',
  status: '',
  error: null,
  isLoading: false,
  scannedAt: null,
  scanErrors: [],
  preview: {
    noteId: null,
    content: '',
    isLoading: false,
    error: null,
    truncated: false,
  },
  previewCache: new Map(),
  readSeq: 0,
  queuedRefresh: false,
};

let searchDebounceId: number | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const saveConfig = async (): Promise<void> => {
  try {
    await saveMarkdownNotesConfig(api, state.config);
  } catch {
    state.error = 'Failed to save markdown notes settings.';
    render();
  }
};

const normalizeProjectFolderPath = (folderPath?: string | null): string | null =>
  folderPath ? folderPath.replace(/ › /g, ' / ') : null;

const projectLabel = (project: ProjectOption): string =>
  project.folderPath ? `${project.folderPath} / ${project.title}` : project.title;

const loadProjects = async (): Promise<ProjectOption[]> => {
  if (!api?.getAllProjects) return [];
  const projects = (await api.getAllProjects()) as Project[];
  return projects
    .filter((project) => !project.isArchived && !project.isHiddenFromMenu)
    .map((project) => ({
      id: project.id,
      title: project.title,
      folderPath: normalizeProjectFolderPath(project.folderPath),
    }))
    .sort((a, b) => projectLabel(a).localeCompare(projectLabel(b)));
};

const isMarkdownNote = (value: unknown): value is MarkdownNote => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.relativePath === 'string' &&
    typeof value.dirPath === 'string' &&
    typeof value.relativeDir === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.title === 'string' &&
    typeof value.modified === 'number' &&
    typeof value.size === 'number'
  );
};

const isScanError = (value: unknown): value is ScanError =>
  isRecord(value) && typeof value.path === 'string' && typeof value.message === 'string';

const toScanResult = (value: unknown): ScanMarkdownDirectoryResult => {
  if (!isRecord(value)) {
    throw new Error('Invalid scan result');
  }
  const notesRaw = Array.isArray(value.notes) ? value.notes : [];
  const errorsRaw = Array.isArray(value.errors) ? value.errors : [];
  return {
    success: value.success === true,
    rootPath: typeof value.rootPath === 'string' ? value.rootPath : '',
    notes: notesRaw.filter(isMarkdownNote),
    errors: errorsRaw.filter(isScanError),
    scannedAt: typeof value.scannedAt === 'number' ? value.scannedAt : Date.now(),
    error: typeof value.error === 'string' ? value.error : undefined,
  };
};

const toReadResult = (value: unknown): ReadMarkdownNoteResult => {
  if (!isRecord(value)) {
    throw new Error('Invalid note read result');
  }
  return {
    success: value.success === true,
    path: typeof value.path === 'string' ? value.path : '',
    content: typeof value.content === 'string' ? value.content : '',
    modified: typeof value.modified === 'number' ? value.modified : 0,
    size: typeof value.size === 'number' ? value.size : 0,
    truncated: value.truncated === true,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
};

const scanNotes = async (rootPath: string): Promise<ScanMarkdownDirectoryResult> => {
  if (!api?.executeNodeScript) {
    throw new Error('Local folder access is available only in the desktop app.');
  }

  const result = await api.executeNodeScript({
    script: SCAN_MARKDOWN_DIRECTORY_SCRIPT,
    args: [rootPath],
    timeout: 30000,
  });

  if (!result.success) {
    throw new Error(
      typeof result.error === 'string' ? result.error : 'Failed to scan markdown folder',
    );
  }

  const scanResult = toScanResult(result.result);
  if (!scanResult.success) {
    throw new Error(scanResult.error || 'Failed to scan markdown folder');
  }
  return scanResult;
};

const readNoteContent = async (
  rootPath: string,
  notePath: string,
): Promise<ReadMarkdownNoteResult> => {
  if (!api?.executeNodeScript) {
    throw new Error('Local folder access is available only in the desktop app.');
  }

  const result = await api.executeNodeScript({
    script: READ_MARKDOWN_NOTE_SCRIPT,
    args: [rootPath, notePath],
    timeout: 30000,
  });

  if (!result.success) {
    throw new Error(
      typeof result.error === 'string' ? result.error : 'Failed to read markdown note',
    );
  }

  const readResult = toReadResult(result.result);
  if (!readResult.success) {
    throw new Error(readResult.error || 'Failed to read markdown note');
  }
  return readResult;
};

const refreshGroups = (): void => {
  state.groups = groupNotes(
    state.notes,
    state.config.rootPath,
    state.config.projectMappings,
    state.projects,
  );
};

const cacheKeyForNote = (note: MarkdownNote): string =>
  `${note.path}:${note.modified}:${note.size}`;

const prunePreviewCache = (): void => {
  const validKeys = new Set(state.notes.map(cacheKeyForNote));
  [...state.previewCache.keys()].forEach((key) => {
    if (!validKeys.has(key)) {
      state.previewCache.delete(key);
    }
  });
};

const refresh = async (): Promise<void> => {
  if (state.isLoading) {
    state.queuedRefresh = true;
    return;
  }

  if (!state.config.rootPath.trim()) {
    state.status = 'Choose a local markdown folder to display notes.';
    state.error = null;
    state.notes = [];
    state.groups = [];
    state.selectedNoteId = null;
    state.preview = {
      noteId: null,
      content: '',
      isLoading: false,
      error: null,
      truncated: false,
    };
    state.previewCache.clear();
    render();
    return;
  }

  const requestedRootPath = state.config.rootPath.trim();
  state.isLoading = true;
  state.queuedRefresh = false;
  state.error = null;
  state.status = 'Scanning markdown files...';
  render();

  try {
    state.projects = await loadProjects();
    const result = await scanNotes(requestedRootPath);
    if (requestedRootPath !== state.config.rootPath.trim()) {
      return;
    }
    state.config.rootPath = result.rootPath;
    state.notes = result.notes;
    state.scanErrors = result.errors;
    state.scannedAt = result.scannedAt;
    prunePreviewCache();
    refreshGroups();
    if (
      !state.selectedNoteId ||
      !state.notes.some((note) => note.id === state.selectedNoteId)
    ) {
      state.selectedNoteId = state.notes[0]?.id ?? null;
    }
    state.status = `Loaded ${state.notes.length} markdown note${state.notes.length === 1 ? '' : 's'}.`;
    void saveConfig();
    void loadSelectedNoteContent();
  } catch (error) {
    if (requestedRootPath !== state.config.rootPath.trim()) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = '';
  } finally {
    if (requestedRootPath === state.config.rootPath.trim()) {
      state.isLoading = false;
      render();
      if (state.queuedRefresh) {
        state.queuedRefresh = false;
        void refresh();
      }
    }
  }
};

const refreshIfIdle = (): void => {
  if (!state.isLoading) {
    void refresh();
  }
};

const renderMarkdown = (markdown: string): string => {
  const html = marked.parse(markdown, { async: false, breaks: true, gfm: true });
  return sanitizeMarkdownHtml(typeof html === 'string' ? html : '');
};

const filteredGroups = (): MarkdownNoteGroup[] => {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.groups;

  return state.groups
    .map((group) => ({
      ...group,
      notes: group.notes.filter((note) =>
        [note.title, note.relativePath].join('\n').toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.notes.length > 0);
};

const selectedNote = (): MarkdownNote | null =>
  state.notes.find((note) => note.id === state.selectedNoteId) ?? null;

const clearEl = (el: Element): void => {
  while (el.firstChild) {
    el.firstChild.remove();
  }
};

const text = (value: string): Text => document.createTextNode(value);

const createOption = (
  value: string,
  label: string,
  selectedValue: string | null,
): HTMLOptionElement => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = value === (selectedValue ?? '');
  return option;
};

const renderCurrentPreview = (): void => {
  const previewEl = document.getElementById('preview') as HTMLElement | null;
  if (previewEl) {
    renderPreview(previewEl);
  }
};

const loadSelectedNoteContent = async (): Promise<void> => {
  const note = selectedNote();
  const readId = ++state.readSeq;

  if (!note) {
    state.preview = {
      noteId: null,
      content: '',
      isLoading: false,
      error: null,
      truncated: false,
    };
    renderCurrentPreview();
    return;
  }

  const cacheKey = cacheKeyForNote(note);
  const cached = state.previewCache.get(cacheKey);
  if (cached) {
    state.preview = {
      noteId: note.id,
      content: cached.content,
      isLoading: false,
      error: null,
      truncated: cached.truncated,
    };
    renderCurrentPreview();
    return;
  }

  state.preview = {
    noteId: note.id,
    content: '',
    isLoading: true,
    error: null,
    truncated: false,
  };
  renderCurrentPreview();

  try {
    const result = await readNoteContent(state.config.rootPath.trim(), note.path);
    if (readId !== state.readSeq || state.selectedNoteId !== note.id) {
      return;
    }
    const currentNote = selectedNote();
    if (!currentNote || cacheKeyForNote(currentNote) !== cacheKey) {
      return;
    }
    state.previewCache.set(cacheKey, {
      content: result.content,
      modified: result.modified,
      size: result.size,
      truncated: result.truncated,
    });
    state.preview = {
      noteId: note.id,
      content: result.content,
      isLoading: false,
      error: null,
      truncated: result.truncated,
    };
  } catch (error) {
    if (readId !== state.readSeq || state.selectedNoteId !== note.id) {
      return;
    }
    state.preview = {
      noteId: note.id,
      content: '',
      isLoading: false,
      error: error instanceof Error ? error.message : String(error),
      truncated: false,
    };
  } finally {
    if (readId === state.readSeq) {
      renderCurrentPreview();
    }
  }
};

const renderNoteButton = (note: MarkdownNote): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `note-btn${note.id === state.selectedNoteId ? ' is-selected' : ''}`;
  button.dataset.noteId = note.id;
  button.addEventListener('click', () => {
    selectNote(note.id);
  });

  const title = document.createElement('div');
  title.className = 'note-title';
  title.textContent = note.title;
  const meta = document.createElement('div');
  meta.className = 'note-meta';
  meta.textContent = note.relativePath;

  button.append(title, meta);
  return button;
};

const selectNote = (noteId: string): void => {
  state.selectedNoteId = noteId;
  document.querySelectorAll<HTMLButtonElement>('.note-btn').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.noteId === noteId);
  });
  void loadSelectedNoteContent();
};

const renderGroup = (group: MarkdownNoteGroup): HTMLElement => {
  const wrapper = document.createElement('section');
  wrapper.className = 'group';

  const header = document.createElement('div');
  header.className = 'group-header';

  const title = document.createElement('div');
  title.className = 'group-title';
  title.textContent = group.title;

  const pathEl = document.createElement('div');
  pathEl.className = 'group-path';
  pathEl.textContent = group.displayPath;

  const select = document.createElement('select');
  select.title = 'Linked Super Productivity project';
  select.append(createOption('', 'No linked project', group.projectId));
  state.projects.forEach((project) => {
    select.append(createOption(project.id, projectLabel(project), group.projectId));
  });
  select.addEventListener('change', () => {
    const selectedProjectId = select.value;
    if (selectedProjectId) {
      state.config.projectMappings[group.key] = selectedProjectId;
    } else {
      delete state.config.projectMappings[group.key];
    }
    void saveConfig();
    refreshGroups();
    render();
  });

  header.append(title, pathEl, select);
  wrapper.append(header, ...group.notes.map(renderNoteButton));
  return wrapper;
};

const renderPreview = (container: HTMLElement): void => {
  const note = selectedNote();
  clearEl(container);

  if (!note) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No markdown note selected.';
    container.append(empty);
    return;
  }

  const header = document.createElement('div');
  header.className = 'preview-header';
  const title = document.createElement('h2');
  title.textContent = note.title;
  const meta = document.createElement('div');
  meta.className = 'note-meta';
  meta.textContent = note.relativePath;
  header.append(title, meta);

  const markdown = document.createElement('div');
  markdown.className = 'markdown-preview';
  if (state.preview.noteId !== note.id || state.preview.isLoading) {
    markdown.className = 'empty';
    markdown.textContent = 'Loading markdown note...';
  } else if (state.preview.error) {
    markdown.className = 'status';
    markdown.textContent = state.preview.error;
  } else {
    markdown.innerHTML = renderMarkdown(state.preview.content);
  }

  container.append(header, markdown);

  if (state.preview.noteId === note.id && state.preview.truncated) {
    const truncated = document.createElement('div');
    truncated.className = 'status';
    truncated.textContent = 'Preview truncated to the first 1 MiB.';
    container.append(truncated);
  }
};

const renderContent = (): void => {
  const listEl = document.getElementById('list') as HTMLElement | null;
  const previewEl = document.getElementById('preview') as HTMLElement | null;
  if (!listEl || !previewEl) return;

  clearEl(listEl);
  const groups = filteredGroups();
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.config.rootPath
      ? 'No markdown notes match the current search.'
      : 'Choose a local markdown folder to display notes.';
    listEl.append(empty);
  } else {
    listEl.append(...groups.map(renderGroup));
  }

  renderPreview(previewEl);
};

const render = (): void => {
  appEl.innerHTML = `
    <div class="shell">
      <form class="config" id="configForm">
        <label for="rootPath">Markdown folder</label>
        <div class="path-row">
          <input id="rootPath" type="text" placeholder="/path/to/obsidian-vault" />
          <button type="submit">Load</button>
        </div>
      </form>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search notes" />
        <button id="refreshBtn" type="button">Refresh</button>
      </div>
      <div class="status" id="status"></div>
      <div class="content">
        <div class="list" id="list"></div>
        <article class="preview" id="preview"></article>
      </div>
    </div>
  `;

  const rootInput = document.getElementById('rootPath') as HTMLInputElement;
  const searchInput = document.getElementById('search') as HTMLInputElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const formEl = document.getElementById('configForm') as HTMLFormElement;
  const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;

  rootInput.value = state.config.rootPath;
  searchInput.value = state.search;
  refreshBtn.disabled = state.isLoading;

  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    state.config.rootPath = rootInput.value.trim();
    void saveConfig();
    void refresh();
  });
  refreshBtn.addEventListener('click', refreshIfIdle);
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    if (searchDebounceId !== null) {
      window.clearTimeout(searchDebounceId);
    }
    searchDebounceId = window.setTimeout(() => {
      searchDebounceId = null;
      renderContent();
    }, SEARCH_DEBOUNCE_MS);
  });

  if (!api?.executeNodeScript) {
    statusEl.textContent =
      'Local markdown folder access is available only in the desktop app.';
  } else if (state.error) {
    statusEl.textContent = state.error;
  } else {
    const scannedAt = state.scannedAt
      ? ` Last scanned ${new Date(state.scannedAt).toLocaleTimeString()}.`
      : '';
    const scanErrors = state.scanErrors.length
      ? ` ${state.scanErrors.length} path${state.scanErrors.length === 1 ? '' : 's'} could not be read.`
      : '';
    statusEl.append(text(`${state.status}${scannedAt}${scanErrors}`));
  }

  renderContent();
};

const init = async (): Promise<void> => {
  state.config = await loadMarkdownNotesConfig(api);
  render();
  refreshIfIdle();
};

void init();
window.setInterval(() => {
  if (document.visibilityState === 'visible' && state.config.rootPath.trim()) {
    refreshIfIdle();
  }
}, AUTO_REFRESH_MS);

window.addEventListener('focus', () => {
  if (state.config.rootPath.trim()) {
    refreshIfIdle();
  }
});
