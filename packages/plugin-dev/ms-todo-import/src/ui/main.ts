import { PluginAPI as PluginApiType, Project } from '@super-productivity/plugin-api';
import { parseGraphData, ParseStrings } from '../parse/from-graph';
import { loadGraphData } from '../parse/load-graph-data';
import { MsTodoImportModel } from '../parse/normalized-model';
import {
  buildProjectTitles,
  groupTasksByProject,
  ImportPlan,
  planImport,
} from '../map/plan-import';
import { runImport, ImportResult } from '../map/run-import';
import { buildLossyNotes, LossNote } from './build-lossy-notes';
import { loadTranslations, t } from './i18n';
import { MS_CLIENT_ID, MS_OAUTH_CONFIG } from './oauth-config';

declare global {
  interface Window {
    PluginAPI: PluginApiType;
  }
}

const api = (): PluginApiType => window.PluginAPI;

// Public copy of the privacy statement. The Entra app registration's privacy URL should point
// here too; it is set in the Azure portal, not in code.
const PRIVACY_URL =
  'https://super-productivity.com/docs/how-to/import-from-microsoft-to-do/#privacy';

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
  untitledList: t('PARSE.UNTITLED_LIST'),
  untitledTask: t('PARSE.UNTITLED_TASK'),
  repeats: (rule) => t('PARSE.REPEATS', { rule }),
});

// ---------------------------------------------------------------------------
// Step 1 — Microsoft sign-in
// ---------------------------------------------------------------------------

/** Signs in, reads everything, then drops the token — the import needs it once. */
const loadModelWithSignIn = async (): Promise<MsTodoImportModel> => {
  const { accessToken } = await api().startOAuthFlow(MS_OAUTH_CONFIG);
  try {
    return parseGraphData(await loadGraphData(api(), accessToken), parseStrings());
  } finally {
    // the host persists OAuth tokens per device; a failed clear only leaves a
    // read-only token that expires within about an hour
    await api()
      .clearOAuthToken()
      .catch((e: unknown) => console.warn('ms-todo-import: sign-in not cleared', e));
  }
};

const renderSignInStep = (errorMsg?: string): void => {
  const errorLine = errorMsg
    ? [el('p', { className: 'callout callout--danger', role: 'alert', text: errorMsg })]
    : [];
  if (!MS_CLIENT_ID) {
    render(
      el('h1', { text: t('TITLE.IMPORT') }),
      el('p', {
        className: 'callout callout--danger',
        text: t('SIGN_IN.NOT_CONFIGURED'),
      }),
    );
    return;
  }
  const signInBtn = el('button', { text: t('BUTTON.SIGN_IN') });

  const submit = async (): Promise<void> => {
    render(
      el('h1', { text: t('TITLE.IMPORT') }),
      el('p', { text: t('SIGN_IN.LOADING'), role: 'status', ariaLive: 'polite' }),
    );
    try {
      const model = await loadModelWithSignIn();
      if (!model.projects.length) {
        renderSignInStep(t('SIGN_IN.NO_LISTS'));
        return;
      }
      renderPreviewStep(model, await api().getAllProjects());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      renderSignInStep(t('ERROR.LOAD_FAILED', { error: msg }));
    }
  };
  signInBtn.addEventListener('click', () => void submit());

  render(
    el('h1', { text: t('TITLE.IMPORT') }),
    el('p', { text: t('SIGN_IN.INTRO') }),
    ...errorLine,
    el('p', { className: 'text-muted text-sm', text: t('SIGN_IN.HELP') }),
    // Microsoft's API terms want the privacy statement and the no-warranty
    // notice reachable in the app before the user consents
    el('p', { className: 'text-muted text-sm' }, [
      `${t('SIGN_IN.LEGAL')} `,
      el('a', {
        href: PRIVACY_URL,
        target: '_blank',
        rel: 'noopener',
        text: t('SIGN_IN.PRIVACY_LINK'),
      }),
    ]),
    el('div', { className: 'actions' }, [signInBtn]),
  );
};

// ---------------------------------------------------------------------------
// Step 2 — preview with per-project selection
// ---------------------------------------------------------------------------

const renderPreviewStep = (
  model: MsTodoImportModel,
  existingProjects: Project[],
): void => {
  const existingTitles = new Set(existingProjects.map((p) => p.title.toLowerCase()));
  // the exact titles the import will create (default-list rename, `(2)`
  // suffixes) — preview and collision check must match
  const titleByExtId = buildProjectTitles(model);
  const tasksByProject = groupTasksByProject(model);
  const checkboxByExtId = new Map<string, HTMLInputElement>();
  const lossyList = el('ul');
  // calm default: no tag unless the user asks for one
  const tagImportantBox = el('input', { type: 'checkbox', checked: false });
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
      ...buildLossyNotes(model, selectedIds()).map((note) =>
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
    // flagged emails are mail follow-ups, not tasks the user wrote — opt in
    const checkbox = el('input', {
      type: 'checkbox',
      checked: !collides && !project.isFlaggedEmails,
    });
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

  const importBtn = el('button', { text: t('BUTTON.IMPORT') });
  const backBtn = el('button', { text: t('BUTTON.BACK') });
  backBtn.addEventListener('click', () => renderSignInStep());
  importBtn.addEventListener('click', () => {
    const selected = selectedIds();
    if (!selected.size) {
      api().showSnack({ msg: t('PREVIEW.SELECT_PROJECT'), type: 'WARNING' });
      return;
    }
    const plan = planImport(model, {
      isTagImportant: tagImportantBox.checked,
      selectedProjectExtIds: selected,
    });
    void executeImport(plan, buildLossyNotes(model, selected));
  });

  refreshLossyList();
  render(
    el('h1', { text: t('TITLE.PREVIEW') }),
    el('p', { text: t('PREVIEW.CHOOSE_PROJECTS') }),
    el('div', {}, projectRows),
    el('label', {}, [tagImportantBox, ` ${t('PREVIEW.TAG_IMPORTANT')}`]),
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
          className: 'callout callout--danger',
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
          className: 'callout callout--warning',
          role: 'status',
          text: t('SUMMARY.UNVERIFIED'),
        }),
      ]
    : [];
  const failedRepeats = result.failedRepeatCount
    ? [
        el('p', {
          className: 'callout callout--warning',
          role: 'status',
          text: t('SUMMARY.REPEATS_FAILED', { count: result.failedRepeatCount }),
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

  // hand the user straight to what landed instead of leaving them on this page
  const landing = result.imported[0];
  const openAction: HTMLElement[] = [];
  if (landing && api().openProject) {
    const openBtn = el('button', {
      className: 'btn-primary',
      text: t('SUMMARY.OPEN_PROJECT', { title: landing.title }),
    });
    openBtn.addEventListener('click', () => {
      api()
        .openProject?.(landing.projectId)
        .catch((e: unknown) =>
          api().showSnack({
            msg: e instanceof Error ? e.message : String(e),
            type: 'ERROR',
          }),
        );
    });
    openAction.push(el('p', {}, [openBtn]));
  }

  if (!result.errorMessage) {
    api().showSnack({ msg: t('SUMMARY.SNACK_FINISHED'), type: 'SUCCESS' });
  }
  render(
    el('h1', {
      text: t(result.errorMessage ? 'TITLE.INCOMPLETE' : 'TITLE.FINISHED'),
    }),
    el('ul', {}, items),
    ...unverified,
    ...failedRepeats,
    ...tagLine,
    ...failure,
    ...lossy,
    el('p', {
      className: 'text-muted text-sm',
      text: t('SUMMARY.UNDO'),
    }),
    // last, as the obvious next step after reading the summary
    ...openAction,
  );
};

// The host injects the PluginAPI bridge script at the end of <body>; wait for
// DOM readiness so it is guaranteed to be defined before first use.
const start = async (): Promise<void> => {
  await loadTranslations(api());
  renderSignInStep();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void start());
} else {
  void start();
}
