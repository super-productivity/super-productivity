// What was applied, old → new, one row per task with Open (§ 8.1).

import type { AppliedRow } from '../core/types';
import { button, el, heading } from './dom';

export const renderApplied = (
  root: HTMLElement,
  input: {
    rows: AppliedRow[];
    isWithoutReview: boolean;
    say: string | null;
    open(taskId: string): void;
  },
): void => {
  const ok = input.rows.filter((r) => !r.error).length;
  if (input.say) root.append(el('p', 'say', input.say));
  const title = input.isWithoutReview ? 'Applied without review' : 'Applied';
  root.append(heading(`${title}: ${ok} of ${input.rows.length}`));
  const ul = el('ul');
  input.rows.forEach((r) => {
    const li = el('li', `row${r.error ? ' failed' : ''}`);
    const main = el('div', 'main');
    const what = r.error ? `Not applied: ${r.error}` : r.what.join(' · ');
    main.append(
      el('span', 'title', r.title),
      el('span', r.error ? 'what warn' : 'what', what),
    );
    li.append(main);
    if (r.taskId && !r.error) {
      const acts = el('div', 'acts');
      acts.append(button('Open', () => input.open(r.taskId as string)));
      li.append(acts);
    }
    ul.append(li);
  });
  root.append(ul);
};
