/** Pure aggregation and rendering of benchmark results. */

export interface Sample {
  scenario: string;
  profile: string;
  /** Execution order within the run, warm-ups included. */
  order: number;
  isWarmup: boolean;
  /** Input (or navigation start) to the frame after the endpoint, ms. */
  ms: number;
  /** Input to the endpoint DOM predicate, without the frame, ms. */
  readyMs: number;
}

export interface RunResult {
  status: 'valid' | 'invalid';
  error?: string;
  meta: Record<string, unknown>;
  samples: Sample[];
}

export interface Row {
  scenario: string;
  profile: string;
  values: number[];
  median: number;
  min: number;
  max: number;
  /** Median relative to the baseline profile of the same scenario in this run. */
  ratio: number | null;
}

export const BASELINE_PROFILE = 'baseline';

export const median = (values: number[]): number => {
  if (!values.length) throw new Error('median of empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Measured (non-warm-up) samples grouped by scenario and profile, in first-seen order. */
export const aggregate = (samples: Sample[]): Row[] => {
  const groups = new Map<string, Sample[]>();
  for (const s of samples.filter((x) => !x.isWarmup)) {
    const key = `${s.scenario}\u0000${s.profile}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const rows = [...groups.values()].map((group): Row => {
    const values = group.map((s) => s.ms);
    return {
      scenario: group[0].scenario,
      profile: group[0].profile,
      values,
      median: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
      ratio: null,
    };
  });
  const scenarios = [...new Set(rows.map((r) => r.scenario))];
  return rows
    .map((row) => {
      const base = rows.find(
        (r) => r.scenario === row.scenario && r.profile === BASELINE_PROFILE,
      );
      return { ...row, ratio: base ? row.median / base.median : null };
    })
    .sort(
      (a, b) =>
        scenarios.indexOf(a.scenario) - scenarios.indexOf(b.scenario) ||
        Number(b.profile === BASELINE_PROFILE) - Number(a.profile === BASELINE_PROFILE),
    );
};

const fmt = (n: number): string => n.toFixed(1);

export const renderMarkdown = (result: RunResult): string => {
  const rows = aggregate(result.samples);
  const lines = [
    `## Performance benchmark (${result.status})`,
    '',
    ...(result.error ? [`**Error:** ${result.error}`, ''] : []),
    'DOM response latency proxy in ms (input → first frame after the endpoint).',
    'Compare ratios within one run; milliseconds from different machines are not comparable.',
    '',
    '| Scenario | Profile | Median | Min | Max | × baseline | Samples |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r.scenario} | ${r.profile} | ${fmt(r.median)} | ${fmt(r.min)} | ${fmt(r.max)} | ` +
        `${r.ratio === null ? '–' : r.ratio.toFixed(2)} | ${r.values.map(fmt).join(', ')} |`,
    ),
    '',
    '<details><summary>Environment</summary>',
    '',
    ...Object.entries(result.meta).map(([k, v]) => `- ${k}: \`${JSON.stringify(v)}\``),
    '',
    '</details>',
    '',
  ];
  return lines.join('\n');
};
