import { PluginAPI as PluginApiType, Project } from '@super-productivity/plugin-api';
import { parseSyncResponse, RawSyncResponse } from '../parse/from-api';
import { TodoistImportModel } from '../parse/normalized-model';
import {
  buildProjectTitles,
  groupTasksByProject,
  ImportPlan,
  planImport,
} from '../map/plan-import';
import { runImport, ImportResult } from '../map/run-import';

declare global {
  interface Window {
    PluginAPI: PluginApiType;
  }
}

const SYNC_URL = 'https://api.todoist.com/api/v1/sync';

const api = (): PluginApiType => window.PluginAPI;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { text?: string } = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  const { text, ...rest } = props;
  Object.assign(node, rest);
  if (text !== undefined) {
    node.textContent = text;
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
};

const app = (): HTMLElement => document.getElementById('app') as HTMLElement;

const render = (...children: HTMLElement[]): void => {
  const root = app();
  root.replaceChildren(...children);
};

// ---------------------------------------------------------------------------
// Step 1 — token input
// ---------------------------------------------------------------------------

const renderTokenStep = (errorMsg?: string, tokenValue?: string): void => {
  const tokenInput = el('input', {
    type: 'password',
    placeholder: 'Todoist API token',
    autocomplete: 'off',
    value: tokenValue || '',
  });
  const fetchBtn = el('button', { text: 'Load preview' });
  const errorLine = errorMsg ? [el('p', { className: 'error', text: errorMsg })] : [];

  const submit = async (): Promise<void> => {
    const token = tokenInput.value.trim();
    if (!token) {
      renderTokenStep('Please paste your Todoist API token first.');
      return;
    }
    render(
      el('h2', { text: 'Import from Todoist' }),
      el('p', { text: 'Loading your Todoist data…' }),
    );
    try {
      const body = new URLSearchParams({
        sync_token: '*',
        resource_types: JSON.stringify(['projects', 'items', 'sections', 'notes']),
      }).toString();
      const raw = await api().request<RawSyncResponse>(SYNC_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const model = parseSyncResponse(raw || {});
      if (!model.projects.length) {
        renderTokenStep('No active projects found for this Todoist account.', token);
        return;
      }
      const existingProjects = await api().getAllProjects();
      renderPreviewStep(model, existingProjects);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      renderTokenStep(
        `Could not load data from Todoist: ${msg} — check the token and your ` +
          'connection. If this keeps failing in the browser, try the desktop app.',
        tokenInput.value,
      );
    }
  };
  fetchBtn.addEventListener('click', () => void submit());
  tokenInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      void submit();
    }
  });

  render(
    el('h2', { text: 'Import from Todoist' }),
    el('p', {
      text:
        'Brings your active Todoist projects, tasks, sub-tasks, labels and due ' +
        'dates into Super Productivity. The import only adds data — nothing of ' +
        'your existing Super Productivity data is changed or removed.',
    }),
    ...errorLine,
    tokenInput,
    el('p', {
      className: 'muted',
      text:
        'Find the token in Todoist under Settings → Integrations → Developer. ' +
        'It is sent only to api.todoist.com and never stored.',
    }),
    el('div', { className: 'actions' }, [fetchBtn]),
  );
};

// ---------------------------------------------------------------------------
// Step 2 — preview with per-project selection
// ---------------------------------------------------------------------------

const buildLossyNotes = (
  model: TodoistImportModel,
  selected: ReadonlySet<string>,
): string[] => {
  const tasks = model.tasks.filter((t) => selected.has(t.projectExtId));
  const notes: string[] = [];
  const sectionCount = model.sections.filter((s) => selected.has(s.projectExtId)).length;
  const demoted = tasks.filter((t) => t.wasDemoted).length;
  const dayDurations = tasks.filter((t) => t.isDayDurationSkipped).length;
  const subtaskLabels = tasks.filter((t) => t.parentExtId && t.labels.length).length;
  const assignees = tasks.filter((t) => t.hasAssignee).length;
  const recurring = tasks.filter((t) => t.isRecurring).length;
  const attachments = tasks.reduce((sum, t) => sum + t.attachmentCount, 0);

  if (sectionCount) {
    notes.push(
      `${sectionCount} sections are dropped (tasks keep their order in the project).`,
    );
  }
  if (demoted) {
    notes.push(
      `${demoted} deeply nested sub-tasks become direct sub-tasks (2 levels max).`,
    );
  }
  if (recurring) {
    notes.push(
      `${recurring} recurring tasks keep their next date; the recurrence rule is noted in the task notes.`,
    );
  }
  if (dayDurations) {
    notes.push(`${dayDurations} full-day durations are not imported.`);
  }
  if (subtaskLabels) {
    notes.push(`${subtaskLabels} sub-tasks lose their labels (sub-tasks have no tags).`);
  }
  if (assignees) {
    notes.push(
      `${assignees} tasks are assigned to collaborators; assignees are dropped.`,
    );
  }
  if (attachments) {
    notes.push(`${attachments} comment attachments keep their link but no file.`);
  }
  notes.push('Completed tasks and reminders are not imported.');
  return notes;
};

const renderPreviewStep = (
  model: TodoistImportModel,
  existingProjects: Project[],
): void => {
  const existingTitles = new Set(existingProjects.map((p) => p.title.toLowerCase()));
  // the exact titles the import will create (Inbox rename, `Parent / Child`
  // disambiguation, `(2)` suffixes) — preview and collision check must match
  const titleByExtId = buildProjectTitles(model);
  const tasksByProject = groupTasksByProject(model);
  const checkboxByExtId = new Map<string, HTMLInputElement>();
  const lossyList = el('ul');
  const priorityCheckbox = el('input', { type: 'checkbox' });

  const selectedIds = (): Set<string> => {
    const ids = new Set<string>();
    checkboxByExtId.forEach((box, extId) => {
      if (box.checked) {
        ids.add(extId);
      }
    });
    return ids;
  };

  const refreshLossyList = (): void => {
    lossyList.replaceChildren(
      ...buildLossyNotes(model, selectedIds()).map((text) => el('li', { text })),
    );
  };

  const projectRows = model.projects.map((project) => {
    const tasks = tasksByProject.get(project.extId) || [];
    const rootCount = tasks.filter((t) => !t.parentExtId).length;
    const subCount = tasks.length - rootCount;
    const title = titleByExtId.get(project.extId) as string;
    const collides = existingTitles.has(title.toLowerCase());
    const checkbox = el('input', { type: 'checkbox', checked: !collides });
    checkbox.addEventListener('change', refreshLossyList);
    checkboxByExtId.set(project.extId, checkbox);
    const countText = ` — ${rootCount} tasks${subCount ? ` (${subCount} sub-tasks)` : ''}`;
    return el('label', {}, [
      checkbox,
      ` ${title}${countText}`,
      ...(collides
        ? [
            el('span', {
              className: 'warn',
              text: '  already exists — possibly imported before',
            }),
          ]
        : []),
    ]);
  });

  const importBtn = el('button', { text: 'Import' });
  const backBtn = el('button', { text: 'Back' });
  backBtn.addEventListener('click', () => renderTokenStep());
  importBtn.addEventListener('click', () => {
    const selected = selectedIds();
    if (!selected.size) {
      api().showSnack({ msg: 'Select at least one project to import.', type: 'WARNING' });
      return;
    }
    const plan = planImport(model, {
      isMapPriorityToTags: priorityCheckbox.checked,
      selectedProjectExtIds: selected,
    });
    void executeImport(plan, buildLossyNotes(model, selected));
  });

  refreshLossyList();
  render(
    el('h2', { text: 'Preview' }),
    el('p', { text: 'Choose the projects to import:' }),
    el('div', {}, projectRows),
    el('label', {}, [
      priorityCheckbox,
      ' Map Todoist priorities p1–p3 to tags (p4 is the default and stays untagged)',
    ]),
    el('h3', { text: 'What will not survive the move' }),
    lossyList,
    el('div', { className: 'actions' }, [importBtn, backBtn]),
  );
};

// ---------------------------------------------------------------------------
// Step 3 + 4 — import progress and summary
// ---------------------------------------------------------------------------

const executeImport = async (plan: ImportPlan, lossyNotes: string[]): Promise<void> => {
  const progressLine = el('p', { text: 'Starting…' });
  render(el('h2', { text: 'Importing…' }), progressLine);

  const result = await runImport(api(), plan, (progress) => {
    const detail =
      progress.phase === 'details' && progress.detailTotal
        ? ` — applying dates & tags ${Math.min((progress.detailIndex ?? 0) + 1, progress.detailTotal)}/${progress.detailTotal}`
        : ` (${progress.phase})`;
    progressLine.textContent = `Project ${progress.projectIndex + 1} of ${progress.totalProjects}: ${progress.projectTitle}${detail}`;
  });
  renderSummaryStep(result, lossyNotes);
};

const projectSummaryLine = (p: ImportResult['imported'][number]): HTMLElement => {
  const subText = p.plannedSubTaskCount
    ? `, ${p.landedSubTaskCount} of ${p.plannedSubTaskCount} sub-tasks`
    : '';
  const isShortfall =
    p.landedTaskCount < p.plannedTaskCount ||
    p.landedSubTaskCount < p.plannedSubTaskCount;
  return el('li', {
    className: isShortfall ? 'warn' : '',
    text:
      `${p.title}: ${p.landedTaskCount} of ${p.plannedTaskCount} tasks${subText}` +
      (isShortfall ? ' — some items did not land, please review' : ''),
  });
};

const renderSummaryStep = (result: ImportResult, lossyNotes: string[]): void => {
  const items = result.imported.map(projectSummaryLine);
  const failure = result.errorMessage
    ? [
        el('p', {
          className: 'error',
          text: result.failedProjectTitle
            ? `Import stopped at “${result.failedProjectTitle}”: ${result.errorMessage}. ` +
              `That project was created only partially — delete “${result.failedProjectTitle}” ` +
              'before re-running, then select it and the remaining projects again.'
            : `Import failed: ${result.errorMessage}`,
        }),
      ]
    : [];
  const unverified = result.isCountUnverified
    ? [
        el('p', {
          className: 'warn',
          text: 'Could not verify the imported counts — the numbers above may show 0 even for tasks that landed.',
        }),
      ]
    : [];
  const tagLine = result.createdTagTitles.length
    ? [el('p', { text: `Created tags: ${result.createdTagTitles.join(', ')}` })]
    : [];
  const lossy = lossyNotes.length
    ? [
        el('h3', { text: 'Not carried over' }),
        el(
          'ul',
          {},
          lossyNotes.map((text) => el('li', { text })),
        ),
      ]
    : [];

  if (!result.errorMessage) {
    api().showSnack({ msg: 'Todoist import finished', type: 'SUCCESS' });
  }
  render(
    el('h2', { text: result.errorMessage ? 'Import incomplete' : 'Import finished' }),
    el('ul', {}, items),
    ...unverified,
    ...tagLine,
    ...failure,
    ...lossy,
    el('p', {
      className: 'muted',
      text: 'The import is additive — to undo it, delete the created projects.',
    }),
  );
};

// The host injects the PluginAPI bridge script at the end of <body>; wait for
// DOM readiness so it is guaranteed to be defined before first use.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => renderTokenStep());
} else {
  renderTokenStep();
}
