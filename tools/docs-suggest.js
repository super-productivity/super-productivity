#!/usr/bin/env node
/**
 * Suggests up to three pages of the public docs (super-productivity.com/docs/) for a new
 * GitHub question, or nothing when no page is a confident match: a wrong link is worse
 * than silence. Deterministic term matching against page titles, descriptions and
 * headings from `docs/wiki/`; no network, no model.
 *
 *   node tools/docs-suggest.js <docs/wiki dir> <event.json> [comment output file]
 *
 * Prints the matches as JSON. When there is a match and an output file is given, writes the
 * comment to post there (docs-suggest.yml decides whether to post it).
 *
 * shortcut: bag-of-words with a fixed threshold, tuned on the fixtures in
 * docs-suggest.fixtures.js — if it misses too often, rank with Pagefind or a model instead.
 */
const fs = require('node:fs');
const path = require('node:path');
const { docsUrl, contributingPages } = require('./wiki-stubs');

const MAX_LINKS = 3;
// Minimum score for the best page; lower than this and we stay silent.
const MIN_SCORE = 4;
// Further pages must score at least this share of the best one.
const RELATIVE_CUTOFF = 0.8;
// Only the start of a long body says what the question is about.
const BODY_CHARS = 600;

const FIELD_WEIGHTS = { title: 3, description: 1.5, headings: 1 };
// Share of a page's distinctive title words the question must contain.
const MIN_COVERAGE = 0.6;

const STOPWORDS = new Set(
  `a about above after again all also am an and any app are as at be because been before
  being between both but by can cannot could did do does doing don done each even every
  few for from get gets getting go had has have having here how i if in into is it its just
  keep know let like make me more most my need no nor not now of off on once one only or
  other our out over own please same see seem should so some still such super productivity
  sp than thank thanks that the their them then there these they this those through to too
  under until up use used using very want was way we were what when where which while who
  why will with would yet you your hi hello hey question help issue problem possible thing
  things something anyone someone really sure work working`.split(/\s+/),
);

// Spelling variants of the same thing, not routing rules: map to the term the docs use.
const SYNONYMS = {
  recurring: 'repeat',
  recur: 'repeat',
  unarchive: 'archive',
  pomodoro: 'timer',
  backups: 'backup',
};

const stem = (word) => {
  const base = SYNONYMS[word] ?? word;
  for (const suffix of ['ing', 'ed', 'es', 'e', 's']) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 4) {
      return base.slice(0, -suffix.length);
    }
  }
  return base;
};

/** Lowercased, stemmed content words. */
const terms = (text) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(stem)
    .filter((word) => !STOPWORDS.has(word));

/** Drops code, images, links and HTML: they are noise, not the question. */
const cleanBody = (body = '') =>
  body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ');

const readPage = (file, source) => {
  const lines = source.split(/\r?\n/);
  const title = (lines.find((line) => /^#\s+\S/.test(line)) ?? file)
    .replace(/^#\s+/, '')
    .replace(/^\d+\.\d+[a-z]?[-\s]+/, '')
    .replace(/`/g, '')
    .trim();
  const description = source.match(/<!--\s*description:\s*([\s\S]*?)-->/)?.[1] ?? '';
  const headings = lines
    .filter((line) => /^#{2,3}\s/.test(line))
    .map((line) => line.replace(/^#+\s+/, ''))
    .join(' ');
  return { title, description, headings, body: source };
};

/** Published content pages: `{ url, title, fields: { title, description, headings } }`. */
const buildIndex = (wikiDir) => {
  const sidebar = path.join(wikiDir, '_Sidebar.md');
  const contributing = fs.existsSync(sidebar)
    ? contributingPages(fs.readFileSync(sidebar, 'utf8'))
    : new Set();
  const pages = [];
  for (const file of fs.readdirSync(wikiDir).sort()) {
    const name = file.replace(/\.md$/i, '');
    const url = file.endsWith('.md') ? docsUrl(name, contributing) : undefined;
    // the docs home and section pages only list other pages; contributor pages don't answer user questions
    if (
      !url ||
      url.endsWith('/docs/') ||
      /^\d+\.00-/.test(name) ||
      url.includes('/contributing/')
    ) {
      continue;
    }
    const page = readPage(name, fs.readFileSync(path.join(wikiDir, file), 'utf8'));
    // The URL slug and the H1 each name the page's topic; they differ for some pages (Worklog / "History").
    const slugWords = url.split('/').at(-2).replace(/-/g, ' ');
    pages.push({
      url,
      title: page.title,
      fields: {
        title: new Set([...terms(page.title), ...terms(slugWords)]),
        description: new Set(terms(page.description)),
        headings: new Set(terms(page.headings)),
      },
      keySets: [slugWords, page.title].map((name) =>
        [...new Set(terms(name))].filter((term) => !GENERIC_TITLE_TERMS.has(term)),
      ),
      all: new Set(terms(page.body)),
    });
  }
  return pages;
};

// Words too common in page titles to tell pages apart ("Manage Scheduled Tasks", "Inbox View").
const GENERIC_TITLE_TERMS = new Set(
  [
    'manage',
    'add',
    'task',
    'view',
    'set',
    'configure',
    'choose',
    'run',
    'build',
    'create',
    'time',
    'sync',
    'data',
    'app',
    'new',
    'index',
    'guide',
  ].map(stem),
);

const idf = (index) => {
  const df = new Map();
  for (const page of index)
    for (const term of page.all) df.set(term, (df.get(term) ?? 0) + 1);
  return (term) => Math.log((index.length + 1) / ((df.get(term) ?? 0) + 1));
};

const questionTerms = ({ title = '', body = '' }) => ({
  title: new Set(terms(title)),
  any: new Set([...terms(title), ...terms(cleanBody(body).slice(0, BODY_CHARS))]),
});

/**
 * A page qualifies only if the question names what the page is about: most of the distinctive
 * words of its URL slug or its H1 appear in the question, one of them in the question's title.
 * Description and heading matches then only rank qualifying pages.
 */
const scorePage = (page, question, weightOf) => {
  const names = (key) =>
    key.length > 0 &&
    key.some((term) => question.title.has(term)) &&
    key.filter((term) => question.any.has(term)).length / key.length >= MIN_COVERAGE;
  if (!page.keySets.some(names)) return 0;
  let score = 0;
  for (const term of question.any) {
    const field = Object.keys(FIELD_WEIGHTS).find((name) => page.fields[name].has(term));
    if (field)
      score += weightOf(term) * FIELD_WEIGHTS[field] * (question.title.has(term) ? 2 : 1);
  }
  return score;
};

/** Up to three `{ title, url, score }` for a `{ title, body }` question; empty when unsure. */
const suggest = (index, question) => {
  const query = questionTerms(question);
  const weightOf = idf(index);
  const ranked = index
    .map((page) => ({
      title: page.title,
      url: page.url,
      score: scorePage(page, query, weightOf),
    }))
    .filter((page) => page.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  if (best < MIN_SCORE) return [];
  return ranked
    .filter((page) => page.score >= best * RELATIVE_CUTOFF)
    .slice(0, MAX_LINKS)
    .map((page) => ({ ...page, score: Math.round(page.score * 10) / 10 }));
};

/** The reply to post, or null when there is nothing to suggest. */
const buildComment = (links) => {
  if (!links.length) return null;
  const intro =
    links.length === 1
      ? 'This page of the documentation may answer your question:'
      : 'These pages of the documentation may answer your question:';
  return [
    intro,
    '',
    ...links.map((link) => `- [${link.title}](${link.url})`),
    '',
    "This is an automatic suggestion. If this doesn't answer it, reply here and someone will follow up.",
  ].join('\n');
};

module.exports = { buildIndex, suggest, buildComment, cleanBody };

if (require.main === module) {
  const [wikiDir, eventPath, commentPath] = process.argv.slice(2);
  if (!wikiDir || !eventPath) {
    console.error(
      'usage: node tools/docs-suggest.js <docs/wiki dir> <event.json> [comment file]',
    );
    process.exit(1);
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const thread = event.discussion;
  if (!thread) throw new Error('not a discussion event');
  const links = suggest(buildIndex(wikiDir), {
    title: thread.title ?? '',
    body: thread.body ?? '',
  });
  const comment = buildComment(links);
  if (comment && commentPath) fs.writeFileSync(commentPath, comment);
  console.log(JSON.stringify({ links }, null, 2));
}
