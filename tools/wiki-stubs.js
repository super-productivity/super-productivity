#!/usr/bin/env node
/**
 * Builds the GitHub Wiki as stubs: one page per `docs/wiki/` page that links to where it is
 * published on super-productivity.com/docs/ (wiki-sync.yml pushes the result).
 *
 * The GitHub Wiki can't redirect or set a canonical URL, so a link to the exact new page is the
 * only way to send readers and search engines there. `docs/wiki/` itself stays the source of the
 * website (the landing page repo builds /docs/ from it), so its content is not changed here.
 *
 *   node tools/wiki-stubs.js <docs/wiki dir> <output dir>
 *
 * URLs follow the landing page's converter (sp-landing-page, scripts/wiki-to-docs.mjs) and must
 * stay in step with it: `2.03-Add-Tasks` -> /docs/how-to/add-tasks/; sections 1 tutorials,
 * 2 how-to (pages in a "Contributing" sidebar group: contributing), 3 reference, 4 explanation;
 * `x.00` pages are the section pages and `Home` the docs home. Pages the website does not publish
 * (section 0 and SKIP_PAGES) link to their source file on GitHub instead.
 */
const fs = require('node:fs');
const path = require('node:path');

const SITE = 'https://super-productivity.com';
const REPO_BLOB =
  'https://github.com/super-productivity/super-productivity/blob/master/docs/wiki';
const SECTION_DIRS = { 1: 'tutorials', 2: 'how-to', 3: 'reference', 4: 'explanation' };
// Same list as SKIP_PAGES in the landing page's converter: not published on the website.
const SKIP_PAGES = new Set([
  '2.10-Configure-Obsidian-for-Wiki-Contributions',
  '4.22-Quick-History',
]);

const parseName = (name) => {
  const match = name.match(/^(\d+)\.(\d+)[a-z]?-(.+)$/);
  return match
    ? { section: Number(match[1]), minor: Number(match[2]), rest: match[3] }
    : undefined;
};

/** github-slugger's rules for the ASCII names the wiki uses: lowercase, punctuation out, spaces to dashes. */
const slug = (text) =>
  text
    .replace(/_/g, '-')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');

/** Pages listed under a `### …Contribut…` heading in `_Sidebar.md`. */
const contributingPages = (sidebarSource) => {
  const pages = new Set();
  let inContributing = false;
  for (const line of sidebarSource.split(/\r?\n/)) {
    if (/^#{2,3}\s/.test(line)) inContributing = /^###\s.*contribut/i.test(line);
    const item = line.match(/^\s*[-*]\s+\[\[([^\]|#]+)/);
    if (item && inContributing) pages.add(item[1].trim());
  }
  return pages;
};

/** The website URL a wiki page is published at, or undefined if the website leaves it out. */
const docsUrl = (name, contributing = new Set()) => {
  if (name === 'Home') return `${SITE}/docs/`;
  const parsed = parseName(name);
  const dir = parsed && SECTION_DIRS[parsed.section];
  if (!dir || SKIP_PAGES.has(name)) return undefined;
  if (parsed.minor === 0) return `${SITE}/docs/${dir}/`;
  const group =
    dir === 'how-to' && (contributing.has(name) || /contribut/i.test(name))
      ? 'contributing'
      : dir;
  return `${SITE}/docs/${group}/${slug(parsed.rest)}/`;
};

const pageTitle = (name, source) => {
  const h1 = source
    .split(/\r?\n/)
    .find((line) => /^#\s+\S/.test(line))
    ?.replace(/^#\s+/, '')
    .replace(/^\d+\.\d+[a-z]?[-\s]+/, '')
    .replace(/`/g, '')
    .trim();
  if (name === 'Home') return 'Super Productivity documentation';
  return h1 || (parseName(name)?.rest ?? name).replace(/[-_]/g, ' ');
};

const stubPage = (title, url, unpublished) =>
  [
    `# ${title}`,
    '',
    unpublished
      ? `This wiki page is no longer maintained here. Its source is [docs/wiki on GitHub](${url}); the documentation lives at [super-productivity.com/docs](${SITE}/docs/).`
      : `This page has moved to the Super Productivity documentation: **[${title}](${url})**`,
    '',
    'The GitHub Wiki is no longer updated.',
    '',
  ].join('\n');

const LINKS_ONLY = [
  '**[Super Productivity documentation](https://super-productivity.com/docs/)**',
  '',
  '- [Quickstarts](https://super-productivity.com/docs/tutorials/)',
  '- [How-to guides](https://super-productivity.com/docs/how-to/)',
  '- [Reference](https://super-productivity.com/docs/reference/)',
  '- [Concepts](https://super-productivity.com/docs/explanation/)',
  '',
].join('\n');

/** Writes the stub wiki into `outDir`; returns `{ file: url }` for each page. */
const buildStubs = (wikiPath, outputPath) => {
  const wikiDir = fs.realpathSync(path.resolve(wikiPath));
  const outDir = path.resolve(outputPath);
  const pages = fs.readdirSync(wikiDir).filter((entry) => /\.md$/i.test(entry));
  const sidebarPath = path.join(wikiDir, '_Sidebar.md');
  const contributing = fs.existsSync(sidebarPath)
    ? contributingPages(fs.readFileSync(sidebarPath, 'utf8'))
    : new Set();
  // outDir is wiped first: it must not be, contain or sit inside the wiki.
  // Check ancestors too: deleting one can remove the symlink through which
  // the other directory is reached. New output directories have no realpath yet.
  const passesThrough = (entry, tree) => {
    for (let dir = entry; ; dir = path.dirname(dir)) {
      if (fs.existsSync(dir)) {
        const rel = path.relative(tree, fs.realpathSync(dir));
        if (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
          return true;
      }
      if (dir === path.dirname(dir)) return false;
    }
  };
  if (
    passesThrough(outDir, wikiDir) ||
    (fs.existsSync(outDir) &&
      passesThrough(path.resolve(wikiPath), fs.realpathSync(outDir)))
  ) {
    throw new Error(`output dir ${outDir} must not overlap the wiki dir ${wikiDir}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const urls = {};
  for (const file of pages) {
    const name = file.replace(/\.md$/i, '');
    const out = path.join(outDir, file);
    if (name === '_Sidebar' || name === '_Footer') {
      fs.writeFileSync(
        out,
        name === '_Sidebar'
          ? `The documentation has moved to the Super Productivity website.\n\n${LINKS_ONLY}`
          : `The documentation lives at [super-productivity.com/docs](${SITE}/docs/).\n`,
      );
      continue;
    }
    const source = fs.readFileSync(path.join(wikiDir, file), 'utf8');
    const title = pageTitle(name, source);
    const url = docsUrl(name, contributing);
    if (name === 'Home') {
      fs.writeFileSync(
        out,
        `# ${title}\n\nThe documentation has moved to the Super Productivity website:\n\n${LINKS_ONLY}\nThe GitHub Wiki is no longer updated.\n`,
      );
    } else {
      const target = url ?? `${REPO_BLOB}/${encodeURI(file)}`;
      fs.writeFileSync(out, stubPage(title, target, !url));
    }
    urls[file] = url ?? null;
  }
  // keep image URLs working for anything that embeds or links them
  const assets = path.join(wikiDir, 'assets');
  if (fs.existsSync(assets)) {
    fs.cpSync(assets, path.join(outDir, 'assets'), { recursive: true });
  }
  return urls;
};

module.exports = { buildStubs, docsUrl, slug, contributingPages };

if (require.main === module) {
  const [wikiDir, outDir] = process.argv.slice(2);
  if (!wikiDir || !outDir) {
    console.error('usage: node tools/wiki-stubs.js <docs/wiki dir> <output dir>');
    process.exit(1);
  }
  const urls = buildStubs(wikiDir, outDir);
  for (const [file, url] of Object.entries(urls)) {
    console.log(`${file} -> ${url ?? '(source on GitHub)'}`);
  }
}
