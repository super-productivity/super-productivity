import { FuzzStep, Intent } from './sync-fuzz-actions';
import { FuzzFailure } from './sync-fuzz-runner';

/**
 * Puts the failure signatures of a sweep in reading order and groups their
 * shrunk traces, so a human reads a few traces instead of every seed. Nothing
 * here clears a finding: an order-only row is read last, and a pin hint says
 * where to look first. A trace still needs the reachability check and the E2E
 * reproduction the README lists.
 */

export interface TriageRun {
  transport: string;
  /** `<profile>:<seed>` */
  name: string;
  failures: Pick<FuzzFailure, 'signature' | 'orderOnly'>[];
}

export interface TriageRow {
  signature: string;
  /** Seeds showing the signature, per transport. */
  seeds: Record<string, string[]>;
  runs: number;
  /** The runs among `runs` showing more than one list in another order. */
  beyondOrder: number;
  /** The first run showing more than order: the one to shrink. */
  first?: { transport: string; name: string };
}

/** One row per signature: those some run shows as more than order first. */
export const triage = (runs: TriageRun[]): TriageRow[] => {
  const rows = new Map<string, TriageRow>();
  for (const { transport, name, failures } of runs) {
    for (const { signature, orderOnly } of failures) {
      const row = rows.get(signature) ?? {
        signature,
        seeds: {},
        runs: 0,
        beyondOrder: 0,
      };
      rows.set(signature, row);
      (row.seeds[transport] ??= []).push(name);
      row.runs++;
      if (orderOnly) continue;
      row.beyondOrder++;
      row.first ??= { transport, name };
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(!a.first) - Number(!b.first) || a.signature.localeCompare(b.signature),
  );
};

/** The table a human reads: one line per signature, then the totals. */
export const formatTriage = (rows: TriageRow[], transports: string[]): string[] => {
  const lines = rows.map((row) =>
    [
      row.first ? 'CANDIDATE ' : 'ORDER-ONLY',
      transports.map((t) => `${t}=${row.seeds[t]?.length ?? 0}`).join(' '),
      row.signature,
      // A list signature can be order-only in one run and more in another.
      row.first && row.beyondOrder < row.runs
        ? `more-than-order=${row.beyondOrder}/${row.runs}`
        : '',
      row.first ? `first=${row.first.transport} ${row.first.name}` : '',
    ]
      .filter(Boolean)
      .join('  '),
  );
  const candidates = rows.filter((row) => row.first).length;
  return [
    ...lines,
    `signatures: candidate=${candidates} order-only=${rows.length - candidates}`,
  ];
};

const kindOf = (intent: Intent): string =>
  intent[0] === 'editNote' || intent[0] === 'editHabit'
    ? `${intent[0]}:${intent[2]}`
    : intent[0];

/**
 * The action kinds of a trace, with the field for the whole-entity edits
 * (their conflicts differ by field).
 */
export const shapeOf = (steps: FuzzStep[]): string =>
  [...new Set(steps.flatMap((step) => (step.a ? [kindOf(step.a)] : [])))]
    .sort()
    .join('+');

export interface TriagePin {
  class: string;
  ref: string;
  steps: FuzzStep[];
  /** Empty for a pin that expects a clean run. */
  signatures: string[];
}

/**
 * The pins whose traces use the same action kinds as `steps`: where to look
 * first, never a clearance, since the same kinds in another order or on other
 * devices are another trace. A clean pin (one that expects no failure) with
 * the same kinds is the one to replay first, not proof of a regression.
 */
export const pinHints = (pins: TriagePin[], steps: FuzzStep[]): string[] => {
  const shape = shapeOf(steps);
  if (!shape) return [];
  const hints = pins
    .filter((pin) => shapeOf(pin.steps) === shape)
    .map(
      (pin) =>
        `${pin.signatures.length ? 'failing' : 'clean'} pin ` +
        `${pin.class} (${pin.ref.slice(0, 40)})`,
    );
  return [...new Set(hints)];
};

export interface ShrunkTrace {
  steps: FuzzStep[];
  /** The candidate signatures whose runs shrank to exactly these steps. */
  signatures: string[];
}

/** One entry per distinct shrunk trace: several signatures often share one. */
export const distinctTraces = (
  shrunk: { signature: string; steps: FuzzStep[] }[],
): ShrunkTrace[] => {
  const traces = new Map<string, ShrunkTrace>();
  for (const { signature, steps } of shrunk) {
    const key = JSON.stringify(steps);
    const trace = traces.get(key) ?? { steps, signatures: [] };
    traces.set(key, trace);
    trace.signatures.push(signature);
  }
  return [...traces.values()];
};

/** What the replays of a trace showed on one transport: its signatures, with how many replays showed each. */
const formatReplays = (replays: string[][]): string => {
  const signatures = [...new Set(replays.flat())].sort();
  if (!signatures.length) return 'no failure';
  return signatures
    .map((s) => `${s} ${replays.filter((r) => r.includes(s)).length}/${replays.length}`)
    .join('; ');
};

/**
 * One line per distinct trace. `replays` holds the signatures of each replay
 * per transport, so a reader sees whether a transport shows another failure
 * or none, not only that the candidate signature is absent.
 */
export const formatShrunk = (
  trace: ShrunkTrace,
  replays: Record<string, string[][]>,
  pins: TriagePin[],
): string =>
  [
    `SHRUNK shape=${shapeOf(trace.steps)}`,
    `for=[${trace.signatures.join('; ')}]`,
    ...Object.entries(replays).map(([t, runs]) => `${t}=[${formatReplays(runs)}]`),
    `same-kinds=[${pinHints(pins, trace.steps).join('; ') || 'none'}]`,
    `trace=${JSON.stringify(trace.steps)}`,
  ].join(' ');
