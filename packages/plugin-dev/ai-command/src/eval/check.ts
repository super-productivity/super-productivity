// Expectation matching for eval cases. A case states only what must hold; any
// change outside `allowTouch` or the named rows is a failure ("do only what
// was asked").

import type { AddRow, ChangeRow, Proposal, UpdateRow } from '../core/types';

export interface ExpectAdd {
  titleIncludes: string;
  dueDay?: string;
  projectId?: string;
  estimateMin?: number;
}

export interface ExpectUpdate {
  taskId: string;
  dueDay?: string | null;
  isDone?: boolean;
  projectId?: string;
  estimateMin?: number;
}

export interface Expect {
  adds?: ExpectAdd[];
  updates?: ExpectUpdate[];
  deletes?: string[];
  /** Tasks the answer may also change without failing, e.g. a day plan's pool. */
  allowTouch?: string[];
  /** The selection must list all of these. */
  selectionIncludes?: string[];
  isDayPlan?: boolean;
  isSay?: boolean;
}

const has = <T>(v: T | undefined): v is T => v !== undefined;

const addMatches = (row: AddRow, e: ExpectAdd): boolean =>
  row.title.toLowerCase().includes(e.titleIncludes.toLowerCase()) &&
  (!has(e.dueDay) || row.dueDay === e.dueDay) &&
  (!has(e.projectId) || row.projectId === e.projectId) &&
  (!has(e.estimateMin) || row.timeEstimate === e.estimateMin * 60000);

const updateProblem = (row: UpdateRow | undefined, e: ExpectUpdate): string | null => {
  if (!row) return `no update of ${e.taskId}`;
  if (has(e.dueDay) && row.dueDay !== e.dueDay)
    return `${e.taskId}: day ${row.dueDay} ≠ ${e.dueDay}`;
  if (has(e.isDone) && row.isDone !== e.isDone)
    return `${e.taskId}: done ${row.isDone} ≠ ${e.isDone}`;
  if (has(e.projectId) && row.projectId !== e.projectId)
    return `${e.taskId}: project ${row.projectId}`;
  if (has(e.estimateMin) && row.timeEstimate !== e.estimateMin * 60000) {
    return `${e.taskId}: estimate ${row.timeEstimate} ≠ ${e.estimateMin} min`;
  }
  return null;
};

const of = <K extends ChangeRow['kind']>(
  p: Proposal,
  kind: K,
): Extract<ChangeRow, { kind: K }>[] =>
  p.changes.filter((r): r is Extract<ChangeRow, { kind: K }> => r.kind === kind);

const addProblems = (p: Proposal, adds: ExpectAdd[]): string[] => {
  const rows = of(p, 'add');
  const missing = adds.filter((e) => !rows.some((r) => addMatches(r, e)));
  const extra =
    rows.length > adds.length ? [`${rows.length - adds.length} extra add(s)`] : [];
  return [...missing.map((e) => `no add like “${e.titleIncludes}”`), ...extra];
};

const touchProblems = (p: Proposal, e: Expect): string[] => {
  const allowed = new Set([
    ...(e.allowTouch ?? []),
    ...(e.updates ?? []).map((u) => u.taskId),
  ]);
  const deletes = new Set(e.deletes ?? []);
  return p.changes.flatMap((r) => {
    if (r.kind === 'update' && !allowed.has(r.taskId))
      return [`changed ${r.taskId} unasked`];
    if (r.kind === 'delete' && !deletes.has(r.taskId))
      return [`deleted ${r.taskId} unasked`];
    return [];
  });
};

const otherProblems = (p: Proposal, e: Expect): string[] => {
  const shown = new Set(p.selection?.items.map((i) => i.taskId) ?? []);
  return [
    ...(e.deletes ?? [])
      .filter((id) => !of(p, 'delete').some((r) => r.taskId === id))
      .map((id) => `no delete of ${id}`),
    ...(e.selectionIncludes ?? [])
      .filter((id) => !shown.has(id))
      .map((id) => `selection lacks ${id}`),
    ...(has(e.isDayPlan) && p.isDayPlan !== e.isDayPlan
      ? [`isDayPlan ${p.isDayPlan}`]
      : []),
    ...(e.isSay && !p.say ? ['no say'] : []),
  ];
};

/** Every way the proposal misses the expectation; empty means it matched. */
export const checkProposal = (p: Proposal, e: Expect): string[] => {
  const updates = of(p, 'update');
  return [
    ...addProblems(p, e.adds ?? []),
    ...(e.updates ?? []).flatMap(
      (u) =>
        updateProblem(
          updates.find((r) => r.taskId === u.taskId),
          u,
        ) ?? [],
    ),
    ...touchProblems(p, e),
    ...otherProblems(p, e),
  ];
};
