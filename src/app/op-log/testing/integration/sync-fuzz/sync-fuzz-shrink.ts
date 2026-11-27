import { FuzzStep } from './sync-fuzz-actions';
import { FuzzOptions, FuzzResult, runFuzz } from './sync-fuzz-runner';

/**
 * Karma drops a browser that reports nothing for 30 s (browserNoActivityTimeout);
 * a shrink runs one `it` far longer, so report a heartbeat through the client.
 */
export const keepKarmaAlive = (tick: number): void => {
  const karma = (window as unknown as Record<string, { info?: (i: object) => void }>)[
    '__karma__'
  ];
  karma?.info?.({ syncFuzzHeartbeat: tick });
};

export interface ShrinkOptions extends Pick<FuzzOptions, 'fileTransport'> {
  maxRuns?: number;
}

/**
 * Delta debugging (ddmin) over steps, then a pass dropping single actions
 * and events. A candidate counts as failing only when `isSameFailure`
 * holds for its run (e.g. the same signature).
 */
export const shrinkTrace = async (
  steps: FuzzStep[],
  isSameFailure: (result: FuzzResult) => boolean,
  { maxRuns = 200, fileTransport }: ShrinkOptions = {},
): Promise<FuzzStep[]> => {
  let runs = 0;
  const fails = async (candidate: FuzzStep[]): Promise<boolean> => {
    runs++;
    keepKarmaAlive(runs);
    return isSameFailure(await runFuzz({ steps: candidate, fileTransport }));
  };

  let current = steps;
  let granularity = 2;
  while (current.length >= 2 && runs < maxRuns) {
    const chunk = Math.ceil(current.length / granularity);
    let reduced = false;
    for (let start = 0; start < current.length && runs < maxRuns; start += chunk) {
      const complement = [...current.slice(0, start), ...current.slice(start + chunk)];
      if (await fails(complement)) {
        current = complement;
        granularity = Math.max(granularity - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (granularity >= current.length) break;
      granularity = Math.min(granularity * 2, current.length);
    }
  }

  // Then try each step without its action or one of its events.
  for (let i = 0; i < current.length && runs < maxRuns; i++) {
    const { d, a, s, c, r, k, x } = current[i];
    // A dialog answer (`k`) and a kill (`x`) apply only to the step's sync, so
    // they go with it. The kill is tried first: one that survives is needed.
    const variants: [unknown, FuzzStep][] = [
      [x, { d, a, s, c, r, k }],
      [a, { d, s, c, r, k, x }],
      [s, { d, a, c, r }],
      [c, { d, a, s, r, k, x }],
      [r, { d, a, s, c, k, x }],
    ];
    for (const [dropped, simpler] of variants) {
      const { a: action, s: sync, c: compact, r: restart } = simpler;
      if (dropped === undefined || !(action || sync || compact || restart)) continue;
      const candidate = [...current.slice(0, i), simpler, ...current.slice(i + 1)];
      if (await fails(candidate)) {
        current = candidate;
        break;
      }
    }
  }
  return current;
};
