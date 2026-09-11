/**
 * Pure helpers for .github/workflows/issue-triage.yml.
 *
 * Everything here treats the model's output as hostile. The model reads issue
 * text written by strangers on a public repo, so it may only select from fixed
 * sets, and no model-authored string is ever returned for posting: the version
 * in the staleness note is rebuilt from parsed integers, and related issues are
 * emitted as numbers that must already appear in the retrieved candidate list.
 */

const AUTORESPONSE =
  "Thank you very much for opening up this issue! I am currently a bit overwhelmed by the many requests that arrive each week, so please forgive me, if I fail to respond personally. I am still very likely to at least skim read your request and I'll probably try to fix all (real) bugs if possible and I will likely review every single PR being made (please, give me a heads up if you intent to do so) and I will try to work on popular requests (please upvote via thumbs up on the original issue) whenever possible, but trying to respond to every single issue over the last years has been kind of draining and I need to adjust my approach for this project to remain fun for me and to make any progress with actually coding new stuff. Thanks for your understanding!";

const TYPE_LABELS = { bug: 'bug', enhancement: 'enhancement', question: 'question' };
const PLATFORM_LABELS = ['android', 'windows', 'firefox'];

const MISSING_ASKS = {
  version:
    '**Version** — which version and package type? (e.g. `v18.21.2 snap` or `v18.21.2 firefox`)',
  steps: '**Steps to reproduce** — the exact sequence of actions that triggers this.',
  expected: '**Expected behavior** — what you expected to happen instead.',
  syncProvider:
    '**Sync provider** — which one are you using? (Dropbox, WebDAV, local file sync or SuperSync)',
};

/**
 * The model is told to emit bare JSON but wraps it in a fenced block often
 * enough that slicing out the object is cheaper than retrying.
 * @returns {object|null} null whenever the response is unusable.
 */
const parseModelJson = (raw) => {
  if (typeof raw !== 'string') return null;
  const asObject = (text) => {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  };
  // Scan to the brace that balances the first one rather than to the last brace
  // in the string: the model often appends a sentence, and a stray `}` in it
  // used to discard an otherwise-valid classification.
  const start = raw.indexOf('{');
  if (start === -1) return asObject(raw.trim());
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === '"') inString = !inString;
    else if (!inString && ch === '{') depth++;
    else if (!inString && ch === '}' && --depth === 0) {
      return asObject(raw.slice(start, i + 1));
    }
  }
  return null;
};

const strings = (value) =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];

const parseVersion = (value) => {
  const match = typeof value === 'string' && value.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: +major, minor: +minor, text: `${major}.${minor}.${patch}` };
};

/**
 * Only a full minor behind counts as stale. Patch drift is normal here, and
 * asking someone to retest over it would be wrong more often than right.
 */
const isStale = (reported, latest) =>
  !!reported &&
  !!latest &&
  (reported.major < latest.major ||
    (reported.major === latest.major && reported.minor < latest.minor));

const pickLabels = (triage) => {
  const labels = [];
  if (Object.hasOwn(TYPE_LABELS, triage?.type ?? ''))
    labels.push(TYPE_LABELS[triage.type]);
  for (const platform of strings(triage?.platforms)) {
    if (PLATFORM_LABELS.includes(platform)) labels.push(platform);
  }
  const missing = strings(triage?.missing).filter((key) =>
    Object.hasOwn(MISSING_ASKS, key),
  );
  if (missing.length) labels.push('needs clarification');
  return { labels: [...new Set(labels)], missing };
};

/**
 * Search terms are derived by the model from attacker-controlled text, so strip
 * anything GitHub would read as a qualifier — `repo:`, `is:`, quotes, booleans,
 * a leading `-` (exclusion) — to keep the injected scope of the search fixed by
 * the caller.
 */
const buildSearchQueries = (triage) =>
  strings(triage?.searchTerms)
    .map((term) =>
      term
        .replace(/[^\p{L}\p{N} _-]/gu, ' ')
        .replace(/\b(AND|OR|NOT)\b/g, ' ')
        .replace(/(^|\s)-+/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80),
    )
    .filter((term) => term.length >= 3)
    .slice(0, 3);

/**
 * The hallucination guard: a number only survives if retrieval actually
 * returned it, so the model can rank candidates but never invent one.
 */
const pickRelated = (raw, candidates) => {
  const allowed = new Map(
    (Array.isArray(candidates) ? candidates : []).map((c) => [c?.number, c?.state]),
  );
  const related = parseModelJson(raw)?.related;
  if (!Array.isArray(related)) return [];
  return [...new Set(related.filter((n) => Number.isInteger(n) && allowed.has(n)))]
    .slice(0, 3)
    .map((number) => ({ number, state: allowed.get(number) }));
};

/**
 * With no notes this returns exactly the old autoresponse, so a failed
 * classification costs the reporter nothing.
 */
const buildComment = ({
  type,
  missing = [],
  reportedVersion,
  latestTag,
  related = [],
}) => {
  const notes = [];
  // Only a bug can be "already fixed"; a feature request that happens to
  // mention an old version must not be told to retest.
  const reported = type === 'bug' ? parseVersion(reportedVersion) : null;

  if (missing.length) {
    notes.push(
      'To help me get to this faster, could you add:\n' +
        missing.map((key) => `- ${MISSING_ASKS[key]}`).join('\n'),
    );
  }

  if (isStale(reported, parseVersion(latestTag))) {
    notes.push(
      `You reported **v${reported.text}** and the current release is **${latestTag}**. ` +
        'If you can, please retest on the latest version — this may already be fixed.',
    );
  }

  const refs = (entries) => entries.map(({ number }) => `#${number}`).join(', ');
  const open = related.filter(({ state }) => state !== 'closed');
  const closed = related.filter(({ state }) => state === 'closed');

  if (open.length) {
    notes.push(
      `Possibly related: ${refs(open)}. ` +
        'If one of them is the same problem, adding your details (and a 👍) there helps more than a separate issue.',
    );
  }

  if (closed.length) {
    notes.push(
      `Possibly related but already closed: ${refs(closed)}. ` +
        'If one of those matches, the fix may already have shipped.',
    );
  }

  if (!notes.length) return AUTORESPONSE;

  return [
    AUTORESPONSE,
    '---',
    '<sub>🤖 The rest of this comment is automated and sometimes wrong — ignore anything that does not apply.</sub>',
    notes.join('\n\n'),
  ].join('\n\n');
};

module.exports = {
  AUTORESPONSE,
  buildComment,
  buildSearchQueries,
  isStale,
  parseModelJson,
  parseVersion,
  pickLabels,
  pickRelated,
};
