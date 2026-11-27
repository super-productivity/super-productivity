#!/usr/bin/env node
/**
 * Docs suggestions for a new GitHub question, in two halves around a model call
 * (docs-suggest.yml):
 *
 *   node tools/docs-suggest.js candidates <docs/wiki dir> <event.json> <work dir>
 *     Writes title.txt, body.txt and candidates.txt (the prompt inputs) and candidates.json.
 *   node tools/docs-suggest.js comment <work dir> <model response file>
 *     Writes comment.md when the model picked a page from the list; prints the links.
 *
 * Retrieval is plain term matching against page titles, descriptions, headings and text in
 * `docs/wiki/`. It only shortlists; the model decides which page, if any, answers the
 * question, because term matching alone linked the wrong page on about half of its posts.
 */
const fs = require('node:fs');
const path = require('node:path');
const { docsUrl, contributingPages } = require('./wiki-stubs');

const MAX_LINKS = 3;
const MAX_CANDIDATES = 8;
// Pages scoring lower share too little with the question to be worth showing the model.
const MIN_SCORE = 2;
// Only the start of a long body says what the question is about.
const BODY_CHARS = 600;

const FIELD_WEIGHTS = { title: 3, description: 1.5, headings: 1 };
// Words only in a page's text count a little: enough to shortlist, not to outrank a title.
const BODY_WEIGHT = 0.3;

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
    const slugWords = url.split('/').at(-2).replace(/-/g, ' ');
    pages.push({
      url,
      title: page.title,
      description: page.description.replace(/\s+/g, ' ').trim(),
      fields: {
        title: new Set([...terms(page.title), ...terms(slugWords)]),
        description: new Set(terms(page.description)),
        headings: new Set(terms(page.headings)),
      },
      all: new Set(terms(page.body)),
    });
  }
  return pages;
};

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

const scorePage = (page, question, weightOf) => {
  let score = 0;
  for (const term of question.any) {
    const field = Object.keys(FIELD_WEIGHTS).find((name) => page.fields[name].has(term));
    const weight = field ? FIELD_WEIGHTS[field] : page.all.has(term) ? BODY_WEIGHT : 0;
    score += weightOf(term) * weight * (question.title.has(term) ? 2 : 1);
  }
  return score;
};

/**
 * Up to MAX_CANDIDATES pages that share words with a `{ title, body }` question, best first.
 * Deliberately loose: the model decides which, if any, answer the question.
 */
const candidates = (index, question) => {
  const query = questionTerms(question);
  const weightOf = idf(index);
  return index
    .map((page) => ({
      title: page.title,
      url: page.url,
      description: page.description,
      score: scorePage(page, query, weightOf),
    }))
    .filter((page) => page.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
};

/** The candidate list as the model sees it: numbered, title and description only. */
const formatCandidates = (pages) =>
  pages
    .map(
      (page, i) =>
        `${i + 1}. ${page.title}${page.description ? `: ${page.description}` : ''}`,
    )
    .join('\n');

/**
 * The pages the model picked, as `{ title, url }`. Anything not a number from the candidate
 * list is dropped, so a malformed or injected reply can only ever cost a link, never add one.
 */
const pickLinks = (response, pages) => {
  let picked;
  try {
    picked = JSON.parse(String(response ?? '').trim()).pages;
  } catch {
    // not JSON: the model ignored the format, so suggest nothing rather than guess
    return [];
  }
  if (!Array.isArray(picked)) return [];
  const chosen = [...new Set(picked)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= pages.length)
    .map((n) => pages[n - 1]);
  return chosen.slice(0, MAX_LINKS).map(({ title, url }) => ({ title, url }));
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

module.exports = {
  buildIndex,
  candidates,
  formatCandidates,
  pickLinks,
  buildComment,
  cleanBody,
};

const writeCandidates = (wikiDir, eventPath, workDir) => {
  const thread = JSON.parse(fs.readFileSync(eventPath, 'utf8')).discussion;
  if (!thread) throw new Error('not a discussion event');
  const question = { title: thread.title ?? '', body: thread.body ?? '' };
  const pages = candidates(buildIndex(wikiDir), question);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'title.txt'), question.title);
  fs.writeFileSync(
    path.join(workDir, 'body.txt'),
    cleanBody(question.body).slice(0, 4000),
  );
  fs.writeFileSync(path.join(workDir, 'candidates.txt'), formatCandidates(pages));
  fs.writeFileSync(path.join(workDir, 'candidates.json'), JSON.stringify(pages, null, 2));
  console.log(JSON.stringify({ candidates: pages.map((page) => page.url) }, null, 2));
};

const writeComment = (workDir, responsePath) => {
  const pages = JSON.parse(
    fs.readFileSync(path.join(workDir, 'candidates.json'), 'utf8'),
  );
  const response = fs.existsSync(responsePath)
    ? fs.readFileSync(responsePath, 'utf8')
    : '';
  const links = pickLinks(response, pages);
  const comment = buildComment(links);
  if (comment) fs.writeFileSync(path.join(workDir, 'comment.md'), comment);
  console.log(JSON.stringify({ links }, null, 2));
};

if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'candidates' && args.length === 3) writeCandidates(...args);
  else if (mode === 'comment' && args.length === 2) writeComment(...args);
  else {
    console.error(
      'usage: node tools/docs-suggest.js candidates <docs/wiki dir> <event.json> <work dir>\n' +
        '       node tools/docs-suggest.js comment <work dir> <model response file>',
    );
    process.exit(1);
  }
}
