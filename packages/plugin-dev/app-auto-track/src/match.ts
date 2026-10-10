import type { Task } from '@super-productivity/plugin-api';

/** The foreground window as reported by the OS probe. */
export interface WindowSample {
  app: string;
  title: string;
}

/** User rule: when `pattern` appears in app name or window title, suggest `taskTitle`. */
export interface Rule {
  pattern: string;
  taskTitle: string;
}

const RULE_SEPARATOR = '=';

/**
 * Parses the rules textarea: one `pattern = task title` per line.
 * Blank lines, `#` comments and lines without both sides are ignored.
 */
export const parseRules = (text: string | undefined): Rule[] =>
  (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const idx = line.indexOf(RULE_SEPARATOR);
      return idx === -1
        ? null
        : {
            pattern: line.slice(0, idx).trim().toLowerCase(),
            taskTitle: line
              .slice(idx + 1)
              .trim()
              .toLowerCase(),
          };
    })
    .filter((rule): rule is Rule => !!rule && !!rule.pattern && !!rule.taskTitle);

/**
 * Issue references in a window title: Jira-style keys (`PROJ-123`) and
 * `#123` numbers (GitHub, GitLab, Gitea, …).
 */
export const extractIssueKeys = (title: string): string[] => {
  const keys = title.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
  const nums = (title.match(/#\d+\b/g) ?? []).map((n) => n.slice(1));
  return [...new Set([...keys, ...nums])];
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isTaskForIssueKey = (task: Task, key: string): boolean => {
  if (/^\d+$/.test(key)) {
    // Providers store the issue number as issueId (GitHub) or show `#123` in the title.
    return task.issueId === key || new RegExp(`#${key}\\b`).test(task.title);
  }
  // Jira-style keys live in the title (`PROJ-123 Summary`); issueId is an internal id.
  return new RegExp(`\\b${escapeRegExp(key)}\\b`).test(task.title);
};

/** Rules win over issue keys: they are the user's explicit intent. */
const findByRules = (sample: WindowSample, rules: Rule[], tasks: Task[]): Task | null => {
  const haystack = `${sample.app}\n${sample.title}`.toLowerCase();
  for (const rule of rules) {
    if (!haystack.includes(rule.pattern)) continue;
    const task = tasks.find((t) => t.title.trim().toLowerCase() === rule.taskTitle);
    if (task) return task;
  }
  return null;
};

/**
 * Only a unique match counts: `#12` in a chat or browser tab title would otherwise
 * point at whichever of several providers' tasks happens to come first.
 */
const findByIssueKey = (sample: WindowSample, tasks: Task[]): Task | null => {
  for (const key of extractIssueKeys(sample.title)) {
    const hits = tasks.filter((t) => isTaskForIssueKey(t, key));
    if (hits.length === 1) return hits[0];
  }
  return null;
};

/** Returns the open task the foreground window points at, or null. */
export const findTaskForWindow = (
  sample: WindowSample,
  rules: Rule[],
  tasks: Task[],
): Task | null => {
  const openTasks = tasks.filter((t) => !t.isDone);
  return findByRules(sample, rules, openTasks) ?? findByIssueKey(sample, openTasks);
};
