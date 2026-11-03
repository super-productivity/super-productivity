// The one-time notice (§ 6.1, § 13 of the plan) and the settings form.

import { MODELS } from '../core/claude';
import type { Settings } from '../core/settings';
import { button, el } from './dom';

export interface SetupInput {
  hasApiKey: boolean;
  settings: Settings;
  isFirstRun: boolean;
}

export interface SetupActions {
  /** Saves the form. `apiKey` is empty when the user kept the stored key. */
  save(apiKey: string, settings: Settings): Promise<void>;
  clearKey(): Promise<void>;
  preview(): Promise<string>;
  close(): void;
}

const SENT = [
  'Your request, as text.',
  'The day: date, weekday and free minutes today.',
  'The names of your projects and tags.',
  'The relevant tasks: open tasks on Today, overdue or with a deadline in the next 7 days (up to 80), the tasks listed in this panel, and up to 30 tasks whose title, project or tag matches your words. For each: title, done or not, estimate, time spent, day, deadline, priority, project, tags, its parent, and whether it repeats or has a time or reminder.',
];

const notice = (actions: SetupActions): HTMLElement => {
  const box = el('section', 'notice');
  box.append(
    el(
      'p',
      undefined,
      'AI Command sends each request to Anthropic, using your own API key. Anthropic bills your account and handles the data under its terms. Each request sends:',
    ),
  );
  const list = el('ul');
  SENT.forEach((s) => list.append(el('li', undefined, s)));
  box.append(list);
  box.append(
    el(
      'p',
      'muted',
      'Not sent: task ids, notes, attachments, worklogs, audio. Dictation runs in your system, under its own terms.',
    ),
  );
  box.append(
    el(
      'p',
      'muted',
      'AI can misunderstand. Check the changes before applying them. "Apply without review" applies small changes without asking.',
    ),
  );
  const pre = el('pre');
  pre.hidden = true;
  box.append(
    button(
      'Show what would be sent',
      () => {
        void actions.preview().then((json) => {
          pre.textContent = json;
          pre.hidden = false;
        });
      },
      'btn-outline',
    ),
    pre,
  );
  return box;
};

const keyField = (
  input: SetupInput,
  actions: SetupActions,
): { node: HTMLElement; key: HTMLInputElement } => {
  const label = el('label', 'field', 'Anthropic API key');
  const key = el('input');
  key.type = 'password';
  key.autocomplete = 'off';
  key.placeholder = input.hasApiKey
    ? 'Saved on this device. Enter a new key to replace it.'
    : 'sk-ant-…';
  label.append(key);
  if (!input.hasApiKey) return { node: label, key };
  const wrap = el('div', 'stack');
  wrap.append(
    label,
    button('Remove key from this device', () => void actions.clearKey(), 'btn-outline'),
  );
  return { node: wrap, key };
};

const modelField = (
  settings: Settings,
): { node: HTMLElement; select: HTMLSelectElement } => {
  const label = el('label', 'field', 'Model');
  const select = el('select');
  MODELS.forEach((m) => {
    const option = el('option', undefined, m.label);
    option.value = m.id;
    option.selected = m.id === settings.model;
    select.append(option);
  });
  label.append(select);
  return { node: label, select };
};

const reviewField = (
  settings: Settings,
): { node: HTMLElement; check: HTMLInputElement } => {
  const label = el('label', 'check');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = settings.isApplyWithoutReview;
  label.append(
    check,
    el(
      'span',
      undefined,
      'Apply without review: small changes to tasks you named apply at once. Deletes and project moves are always shown first. This device only.',
    ),
  );
  return { node: label, check };
};

export const renderSetup = (
  root: HTMLElement,
  input: SetupInput,
  actions: SetupActions,
): void => {
  const key = keyField(input, actions);
  const model = modelField(input.settings);
  const review = reviewField(input.settings);
  const error = el('p', 'error');
  error.setAttribute('role', 'alert');
  const save = (): void => {
    if (!input.hasApiKey && !key.key.value.trim()) {
      error.textContent = 'Enter your API key.';
      return;
    }
    const settings = {
      model: model.select.value,
      isApplyWithoutReview: review.check.checked,
      isNoticeAccepted: true,
    };
    actions.save(key.key.value.trim(), settings).catch((e: unknown) => {
      error.textContent = e instanceof Error ? e.message : String(e);
    });
  };
  const footer = el('footer');
  if (!input.isFirstRun) footer.append(button('Cancel', actions.close));
  footer.append(button(input.isFirstRun ? 'Turn on' : 'Save', save, 'btn-primary'));
  root.append(notice(actions), key.node, model.node, review.node, error, footer);
};
