import { PluginAPI as PluginApiType, Project } from '@super-productivity/plugin-api';
import { parseSyncResponse, ParseStrings } from '../parse/from-api';
import { loadTodoistData } from '../parse/load-todoist-data';
import { TodoistImportModel } from '../parse/normalized-model';
import {
  buildProjectTitles,
  groupTasksByProject,
  ImportPlan,
  planImport,
  PriorityMapping,
} from '../map/plan-import';
import { runImport, ImportResult } from '../map/run-import';
import { buildLossyNotes, LossNote } from './build-lossy-notes';
import { loadTranslations, t } from './i18n';

declare global {
  interface Window {
    PluginAPI: PluginApiType;
  }
}

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

const parseStrings = (): ParseStrings => ({
  untitledProject: t('PARSE.UNTITLED_PROJECT'),
  untitledTask: t('PARSE.UNTITLED_TASK'),
  repeats: (rule) => t('PARSE.REPEATS', { rule }),
  deadline: (date) => t('PARSE.DEADLINE', { date }),
  comments: t('PARSE.COMMENTS'),
  file: t('PARSE.FILE'),
});

// ---------------------------------------------------------------------------
// Step 1 — token input
// ---------------------------------------------------------------------------

const renderTokenStep = (errorMsg?: string, tokenValue?: string): void => {
  const tokenInputId = 'todoist-api-token';
  const tokenInput = el('input', {
    id: tokenInputId,
    type: 'password',
    placeholder: t('TOKEN.PLACEHOLDER'),
    autocomplete: 'off',
    value: tokenValue || '',
  });
  const fetchBtn = el('button', { text: t('BUTTON.LOAD_PREVIEW') });
  const errorLine = errorMsg
    ? [el('p', { className: 'error', role: 'alert', text: errorMsg })]
    : [];

  const submit = async (): Promise<void> => {
    const token = tokenInput.value.trim();
    if (!token) {
      renderTokenStep(t('TOKEN.REQUIRED'));
      return;
    }
    render(
      el('h1', { text: t('TITLE.IMPORT') }),
      el('p', {
        text: t('TOKEN.LOADING'),
        role: 'status',
        ariaLive: 'polite',
      }),
    );
    try {
      const raw = await loadTodoistData(api(), token);
      const model = parseSyncResponse(raw || {}, parseStrings());
      if (!model.projects.length) {
        renderTokenStep(t('TOKEN.NO_PROJECTS'), token);
        return;
      }
      const existingProjects = await api().getAllProjects();
      renderPreviewStep(model, existingProjects);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      renderTokenStep(t('ERROR.LOAD_FAILED', { error: msg }), tokenInput.value);
    }
  };
  fetchBtn.addEventListener('click', () => void submit());
  tokenInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      void submit();
    }
  });

  render(
    el('h1', { text: t('TITLE.IMPORT') }),
    el('p', { text: t('TOKEN.INTRO') }),
    ...errorLine,
    el('label', { htmlFor: tokenInputId, text: t('TOKEN.LABEL') }),
    tokenInput,
    el('p', { className: 'muted', text: t('TOKEN.HELP') }),
    el('div', { className: 'actions' }, [fetchBtn]),
  );
};

// ---------------------------------------------------------------------------
// Step 2 — preview with per-project selection
// ---------------------------------------------------------------------------

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
  // Priority → tags is a single mutually-exclusive choice (radios): off, the
  // p1–p3 tags, or SP's built-in Eisenhower urgent/important tags.
  const priorityRadio = (value: PriorityMapping, checked = false): HTMLInputElement =>
    el('input', { type: 'radio', name: 'todoist-priority-mapping', value, checked });
  const priorityNoneRadio = priorityRadio('none', true);
  const priorityTagsRadio = priorityRadio('priorityTags');
  const priorityEisenhowerRadio = priorityRadio('eisenhower');
  const selectedPriorityMapping = (): PriorityMapping =>
    priorityTagsRadio.checked
      ? 'priorityTags'
      : priorityEisenhowerRadio.checked
        ? 'eisenhower'
        : 'none';

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
      ...buildLossyNotes(model, selectedIds(), selectedPriorityMapping()).map((note) =>
        el('li', { text: t(note.key, note.params) }),
      ),
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
    return el('label', {}, [
      checkbox,
      ` ${t('PREVIEW.PROJECT_COUNTS', {
        title,
        taskCount: rootCount,
        subTaskCount: subCount,
      })}`,
      ...(collides
        ? [
            el('span', {
              className: 'warn',
              text: ` — ${t('PREVIEW.ALREADY_EXISTS')}`,
            }),
          ]
        : []),
    ]);
  });

  for (const radio of [priorityNoneRadio, priorityTagsRadio, priorityEisenhowerRadio]) {
    radio.addEventListener('change', refreshLossyList);
  }

  const importBtn = el('button', { text: t('BUTTON.IMPORT') });
  const backBtn = el('button', { text: t('BUTTON.BACK') });
  backBtn.addEventListener('click', () => renderTokenStep());
  importBtn.addEventListener('click', () => {
    const selected = selectedIds();
    if (!selected.size) {
      api().showSnack({ msg: t('PREVIEW.SELECT_PROJECT'), type: 'WARNING' });
      return;
    }
    const priorityMapping = selectedPriorityMapping();
    const plan = planImport(model, {
      priorityMapping,
      selectedProjectExtIds: selected,
    });
    void executeImport(plan, buildLossyNotes(model, selected, priorityMapping));
  });

  refreshLossyList();
  render(
    el('h1', { text: t('TITLE.PREVIEW') }),
    el('p', { text: t('PREVIEW.CHOOSE_PROJECTS') }),
    el('div', {}, projectRows),
    el('fieldset', {}, [
      el('legend', { text: t('PREVIEW.PRIORITY_LEGEND') }),
      el('label', {}, [priorityNoneRadio, ` ${t('PREVIEW.PRIORITY_NONE')}`]),
      el('label', {}, [priorityTagsRadio, ` ${t('PREVIEW.PRIORITY_TAGS')}`]),
      el('label', {}, [priorityEisenhowerRadio, ` ${t('PREVIEW.PRIORITY_EISENHOWER')}`]),
    ]),
    el('h2', { text: t('PREVIEW.LOSS_HEADING') }),
    lossyList,
    el('div', { className: 'actions' }, [importBtn, backBtn]),
  );
};

// ---------------------------------------------------------------------------
// Step 3 + 4 — import progress and summary
// ---------------------------------------------------------------------------

const executeImport = async (plan: ImportPlan, lossyNotes: LossNote[]): Promise<void> => {
  const progressLine = el('p', {
    text: t('IMPORT.STARTING'),
    role: 'status',
    ariaLive: 'polite',
  });
  render(el('h1', { text: t('TITLE.IMPORTING') }), progressLine);

  const result = await runImport(api(), plan, (progress) => {
    const detail =
      progress.phase === 'details' && progress.detailTotal
        ? t('IMPORT.PHASE_DETAILS', {
            current: Math.min((progress.detailIndex ?? 0) + 1, progress.detailTotal),
            total: progress.detailTotal,
          })
        : t(progress.phase === 'project' ? 'IMPORT.PHASE_PROJECT' : 'IMPORT.PHASE_TASKS');
    progressLine.textContent = t('IMPORT.PROGRESS', {
      current: progress.projectIndex + 1,
      total: progress.totalProjects,
      title: progress.projectTitle,
      detail,
    });
  });
  renderSummaryStep(result, lossyNotes);
};

const projectSummaryLine = (p: ImportResult['imported'][number]): HTMLElement => {
  const isShortfall =
    p.landedTaskCount < p.plannedTaskCount ||
    p.landedSubTaskCount < p.plannedSubTaskCount;
  return el('li', {
    className: isShortfall ? 'warn' : '',
    text:
      t('SUMMARY.PROJECT_RESULT', {
        title: p.title,
        landedTasks: p.landedTaskCount,
        plannedTasks: p.plannedTaskCount,
        landedSubTasks: p.landedSubTaskCount,
        plannedSubTasks: p.plannedSubTaskCount,
      }) + (isShortfall ? ` — ${t('SUMMARY.SHORTFALL')}` : ''),
  });
};

const renderSummaryStep = (result: ImportResult, lossyNotes: LossNote[]): void => {
  const items = result.imported.map(projectSummaryLine);
  const failure = result.errorMessage
    ? [
        el('p', {
          className: 'error',
          role: 'alert',
          text: result.failedProjectTitle
            ? t('ERROR.IMPORT_STOPPED', {
                project: result.failedProjectTitle,
                error: result.errorMessage,
              })
            : t('ERROR.IMPORT_FAILED', { error: result.errorMessage }),
        }),
      ]
    : [];
  const unverified = result.isCountUnverified
    ? [
        el('p', {
          className: 'warn',
          role: 'status',
          text: t('SUMMARY.UNVERIFIED'),
        }),
      ]
    : [];
  const tagLine = result.createdTagTitles.length
    ? [
        el('p', {
          text: t('SUMMARY.CREATED_TAGS', {
            tags: result.createdTagTitles.join(', '),
          }),
        }),
      ]
    : [];
  const lossy = lossyNotes.length
    ? [
        el('h2', { text: t('SUMMARY.NOT_CARRIED_OVER') }),
        el(
          'ul',
          {},
          lossyNotes.map((note) => el('li', { text: t(note.key, note.params) })),
        ),
      ]
    : [];

  if (!result.errorMessage) {
    api().showSnack({ msg: t('SUMMARY.SNACK_FINISHED'), type: 'SUCCESS' });
  }
  render(
    el('h1', {
      text: t(result.errorMessage ? 'TITLE.INCOMPLETE' : 'TITLE.FINISHED'),
    }),
    el('ul', {}, items),
    ...unverified,
    ...tagLine,
    ...failure,
    ...lossy,
    el('p', {
      className: 'muted',
      text: t('SUMMARY.UNDO'),
    }),
  );
};

// The host injects the PluginAPI bridge script at the end of <body>; wait for
// DOM readiness so it is guaranteed to be defined before first use.
const start = async (): Promise<void> => {
  await loadTranslations(api());
  renderTokenStep();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void start());
} else {
  void start();
}
