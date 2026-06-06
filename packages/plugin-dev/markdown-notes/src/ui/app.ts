import { marked } from 'marked';
import type { PluginAPI, Project } from '@super-productivity/plugin-api';
import { groupNotes } from '../core/group-notes';
import { SCAN_MARKDOWN_DIRECTORY_SCRIPT } from '../core/scan-script';
import type {
  MarkdownNote,
  MarkdownNoteGroup,
  MarkdownNotesConfig,
  ProjectOption,
  ScanError,
  ScanMarkdownDirectoryResult,
} from '../core/types';

declare global {
  interface Window {
    PluginAPI?: PluginAPI;
  }
}

const CONFIG_STORAGE_KEY = 'markdown-notes-config-v1';
const AUTO_REFRESH_MS = 30000;
const DANGEROUS_HTML_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'style',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
]);
const ALLOWED_HTML_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);
const EMPTY_ATTRS = new Set<string>();
const ALLOWED_HTML_ATTRS = new Map([
  ['a', new Set(['href', 'title'])],
  ['img', new Set(['alt', 'height', 'src', 'title', 'width'])],
  ['td', new Set(['align'])],
  ['th', new Set(['align'])],
]);
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

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
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const loadConfig = (): MarkdownNotesConfig => {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return emptyConfig();
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return emptyConfig();
    const projectMappings = isRecord(parsed.projectMappings)
      ? Object.fromEntries(
          Object.entries(parsed.projectMappings).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
    return {
      rootPath: typeof parsed.rootPath === 'string' ? parsed.rootPath : '',
      projectMappings,
    };
  } catch {
    return emptyConfig();
  }
};

const saveConfig = (): void => {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(state.config));
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
    typeof value.content === 'string' &&
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

const refreshGroups = (): void => {
  state.groups = groupNotes(
    state.notes,
    state.config.rootPath,
    state.config.projectMappings,
    state.projects,
  );
};

const refresh = async (): Promise<void> => {
  if (!state.config.rootPath.trim()) {
    state.status = 'Choose a local markdown folder to display notes.';
    state.error = null;
    state.notes = [];
    state.groups = [];
    state.selectedNoteId = null;
    render();
    return;
  }

  state.isLoading = true;
  state.error = null;
  state.status = 'Scanning markdown files...';
  render();

  try {
    state.projects = await loadProjects();
    const result = await scanNotes(state.config.rootPath.trim());
    state.config.rootPath = result.rootPath;
    state.notes = result.notes;
    state.scanErrors = result.errors;
    state.scannedAt = result.scannedAt;
    refreshGroups();
    if (
      !state.selectedNoteId ||
      !state.notes.some((note) => note.id === state.selectedNoteId)
    ) {
      state.selectedNoteId = state.notes[0]?.id ?? null;
    }
    state.status = `Loaded ${state.notes.length} markdown note${state.notes.length === 1 ? '' : 's'}.`;
    saveConfig();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = '';
  } finally {
    state.isLoading = false;
    render();
  }
};

const isSafeUrl = (value: string, allowedProtocols: Set<string>): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return true;
  }

  try {
    const hasExplicitProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    const url = new URL(trimmed, 'https://local.invalid');
    return hasExplicitProtocol ? allowedProtocols.has(url.protocol) : true;
  } catch {
    return false;
  }
};

const sanitizeHtml = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('*').forEach((el) => {
    const tagName = el.tagName.toLowerCase();

    if (DANGEROUS_HTML_TAGS.has(tagName)) {
      el.remove();
      return;
    }

    if (!ALLOWED_HTML_TAGS.has(tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
      return;
    }

    const allowedAttrs = ALLOWED_HTML_ATTRS.get(tagName) ?? EMPTY_ATTRS;
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name)) {
        el.removeAttribute(attr.name);
        return;
      }

      if (name === 'href' && !isSafeUrl(attr.value, LINK_PROTOCOLS)) {
        el.removeAttribute(attr.name);
      }
      if (name === 'src' && !isSafeUrl(attr.value, IMAGE_PROTOCOLS)) {
        el.removeAttribute(attr.name);
      }
    });

    if (tagName === 'a') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer');
    }
    if (tagName === 'img') {
      el.setAttribute('loading', 'lazy');
      el.setAttribute('referrerpolicy', 'no-referrer');
    }
  });

  return template.innerHTML;
};

const renderMarkdown = (markdown: string): string => {
  const html = marked.parse(markdown, { async: false, breaks: true, gfm: true });
  return sanitizeHtml(typeof html === 'string' ? html : '');
};

const filteredGroups = (): MarkdownNoteGroup[] => {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.groups;

  return state.groups
    .map((group) => ({
      ...group,
      notes: group.notes.filter((note) =>
        [note.title, note.relativePath, note.content]
          .join('\n')
          .toLowerCase()
          .includes(q),
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

const renderNoteButton = (note: MarkdownNote): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `note-btn${note.id === state.selectedNoteId ? ' is-selected' : ''}`;
  button.addEventListener('click', () => {
    state.selectedNoteId = note.id;
    render();
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
    saveConfig();
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
  markdown.innerHTML = renderMarkdown(note.content);

  container.append(header, markdown);
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
    saveConfig();
    void refresh();
  });
  refreshBtn.addEventListener('click', () => void refresh());
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    renderContent();
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

state.config = loadConfig();
render();
void refresh();
window.setInterval(() => {
  if (document.visibilityState === 'visible' && state.config.rootPath.trim()) {
    void refresh();
  }
}, AUTO_REFRESH_MS);

window.addEventListener('focus', () => {
  if (state.config.rootPath.trim()) {
    void refresh();
  }
});
