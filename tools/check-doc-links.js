#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const EXTERNAL_TARGET = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_LINE_LENGTH = 16 * 1024;
const MAX_DIAGNOSTICS = 100;

// Source files cite documents in comments ("see the styling guide under docs").
// Those references rot silently: the document scan never opens a .ts, so a deleted
// doc leaves dangling pointers that no check can see. This second pass reads source
// for `docs/**` paths and verifies the file exists, resolving each path against both
// the repository root and the nearest enclosing package (a comment inside
// packages/foo/ may mean packages/foo/docs/bar.md).
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
  '.kt',
  '.java',
  '.swift',
  '.scss',
  '.css',
  '.html',
  '.yaml',
  '.yml',
  '.sh',
]);
const DEFAULT_SOURCE_ROOTS = [
  'src',
  'packages',
  'electron',
  'android',
  'ios',
  'tools',
  'e2e',
  'build',
  '.github',
  'capacitor.config.ts',
  'electron-builder.yaml',
];
const IGNORED_SOURCE_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build-output',
  'app-builds',
  'coverage',
  '.git',
  '.angular',
  '.claude',
  '.worktrees',
  '.tmp',
  'tmp',
]);
// A repo-relative docs path, optionally inside a same-repo GitHub blob URL. The
// match deliberately stops at the extension so `#anchor` suffixes fall away —
// this pass checks existence only, not anchors.
const DOCS_PATH_IN_SOURCE =
  /(?<![\w.\-/])docs\/[\w.\-]+(?:\/[\w.\-]+)*\.(?:md|markdown|html|htm)/gi;

const listDocuments = (inputPaths) => {
  const documents = new Set();
  const pending = [...inputPaths];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) {
      continue;
    }
    const currentStats = fs.lstatSync(current);
    if (currentStats.isSymbolicLink()) {
      continue;
    }
    if (currentStats.isFile()) {
      if (DOCUMENT_EXTENSIONS.has(path.extname(current).toLowerCase())) {
        documents.add(fs.realpathSync(current));
      }
      continue;
    }

    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => b.name.localeCompare(a.name));

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (
        entry.isFile() &&
        DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        documents.add(fs.realpathSync(entryPath));
      }
    }
  }

  return [...documents].sort();
};

const decodeTargetPart = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const splitTarget = (target) => {
  const trimmed = target.trim();
  const hashIndex = trimmed.indexOf('#');
  const beforeFragment = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
  const queryIndex = beforeFragment.indexOf('?');
  const pathname =
    queryIndex === -1 ? beforeFragment : beforeFragment.slice(0, queryIndex);

  return {
    fragment: hashIndex === -1 ? '' : decodeTargetPart(trimmed.slice(hashIndex + 1)),
    pathname: decodeTargetPart(pathname),
  };
};

const findRepositoryBoundary = (rootDir) => {
  const realRoot = fs.realpathSync(rootDir);
  const start = fs.statSync(realRoot).isDirectory() ? realRoot : path.dirname(realRoot);
  let current = start;

  while (true) {
    const gitMarker = path.join(current, '.git');
    const hasGitMarker =
      fs.existsSync(gitMarker) &&
      (fs.statSync(gitMarker).isFile() || fs.existsSync(path.join(gitMarker, 'HEAD')));
    if (hasGitMarker) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
};

const isWithin = (boundary, candidate) => {
  const relative = path.relative(boundary, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};

const pathCandidates = ({ boundary, sourceFile, pathname }) => {
  if (!pathname) {
    return [sourceFile];
  }

  const baseDir = path.dirname(sourceFile);
  const resolved = pathname.startsWith('/')
    ? path.resolve(boundary, pathname.slice(1))
    : path.resolve(baseDir, pathname);
  const candidates = [resolved];

  if (!resolved.toLowerCase().endsWith('.md')) {
    candidates.push(`${resolved}.md`);
  }
  candidates.push(path.join(resolved, 'README.md'));

  return candidates;
};

const linksFromLine = (line) => {
  const links = [];
  const withoutInlineCode = line.replace(/`+[^`]*`+/g, '');
  const markdownLink = /!?\[[^\]]*]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  const htmlLink = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  const wikiLink = /\[\[([^\]]+)]]/g;

  for (const match of withoutInlineCode.matchAll(markdownLink)) {
    links.push({ target: match[1] || match[2] });
  }

  for (const match of withoutInlineCode.matchAll(wikiLink)) {
    const parts = match[1].split('|').map((part) => part.trim());
    if (parts.length > 1) {
      links.push({
        target: match[1].trim(),
        issue: 'unsupported wiki-link alias',
      });
      continue;
    }

    links.push({ target: parts[0] });
  }

  for (const match of withoutInlineCode.matchAll(htmlLink)) {
    links.push({ target: match[1] });
  }

  return links;
};

const findBalancedEnd = (value, start, open, close) => {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
    } else if (value[index] === open) {
      depth += 1;
    } else if (value[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
};

const findLinkDestinationEnd = (value, start) => {
  let depth = 0;
  let angleDestination = false;
  let titleQuote = null;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (angleDestination) {
      angleDestination = character !== '>';
      continue;
    }
    if (titleQuote) {
      if (character === titleQuote) {
        titleQuote = null;
      }
      continue;
    }
    if (character === '<' && index === start + 1) {
      angleDestination = true;
    } else if (
      depth === 1 &&
      (character === '"' || character === "'") &&
      /\s/.test(value[index - 1])
    ) {
      titleQuote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
};

const renderMarkdownLinks = (value) => {
  let output = '';
  let index = 0;

  while (index < value.length) {
    const labelStart =
      value[index] === '!' && value[index + 1] === '['
        ? index + 1
        : value[index] === '['
          ? index
          : -1;
    const labelEnd =
      labelStart === -1 ? -1 : findBalancedEnd(value, labelStart, '[', ']');

    if (labelEnd !== -1 && value[labelEnd + 1] === '(') {
      const destinationEnd = findLinkDestinationEnd(value, labelEnd + 1);
      if (destinationEnd !== -1) {
        output += value.slice(labelStart + 1, labelEnd);
        index = destinationEnd + 1;
        continue;
      }
    }

    let referenceStart = labelEnd + 1;
    while (referenceStart > 0 && /\s/.test(value[referenceStart])) {
      referenceStart += 1;
    }
    if (labelEnd !== -1 && value[referenceStart] === '[') {
      const referenceEnd = findBalancedEnd(value, referenceStart, '[', ']');
      if (referenceEnd !== -1) {
        output += value.slice(labelStart + 1, labelEnd);
        index = referenceEnd + 1;
        continue;
      }
    }

    output += value[index];
    index += 1;
  }

  return output;
};

const renderUnderscoreEmphasis = (value) => {
  const emphasis = /(^|[^\p{L}\p{N}\\])(_{1,3})(?=\S)(.*?\S)\2(?=$|[^\p{L}\p{N}])/gu;
  let rendered = value;
  let previous;
  do {
    previous = rendered;
    rendered = rendered.replace(emphasis, '$1$3');
  } while (rendered !== previous);
  return rendered;
};

// Strip to a fix point: one pass over `<<span>span>` leaves a second `<span>`
// behind, which would then survive into the slug. Same idiom as
// renderUnderscoreEmphasis above.
const stripHtmlTags = (value) => {
  const tag = /<\/?[a-z][a-z\d-]*(?:\s[^>]*)?>/gi;
  let stripped = value;
  let previous;
  do {
    previous = stripped;
    stripped = stripped.replace(tag, '');
  } while (stripped !== previous);
  return stripped;
};

const renderedHeadingText = (heading) =>
  renderUnderscoreEmphasis(
    stripHtmlTags(renderMarkdownLinks(heading)).replace(/`+([^`]*)`+/g, '$1'),
  );

const headingSlug = (heading) =>
  renderedHeadingText(heading)
    .trim()
    .toLowerCase()
    .replace(/[\u2000-\u206f\u2e00-\u2e7f\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
    .replace(/\s/g, '-');

const markdownFenceState = (line, currentFence) => {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) {
    return { fence: currentFence, isCode: Boolean(currentFence) };
  }

  const marker = match[1];
  const remainder = match[2];
  if (!currentFence) {
    if (marker[0] === '`' && remainder.includes('`')) {
      return { fence: null, isCode: false };
    }
    return {
      fence: { character: marker[0], length: marker.length },
      isCode: true,
    };
  }

  const closesFence =
    marker[0] === currentFence.character &&
    marker.length >= currentFence.length &&
    /^[ \t]*$/.test(remainder);
  return {
    fence: closesFence ? null : currentFence,
    isCode: true,
  };
};

const linesOutsideMarkdownCode = (lines) => {
  const visibleLines = [];
  let fence = null;

  for (const line of lines) {
    const fenceResult = markdownFenceState(line, fence);
    fence = fenceResult.fence;
    if (fenceResult.isCode) {
      visibleLines.push('');
      continue;
    }

    visibleLines.push(/^(?: {4}|\t)/.test(line) ? '' : line.replace(/`+[^`]*`+/g, ''));
  }

  return visibleLines;
};

const htmlAttribute = (tag, attribute) =>
  tag.match(new RegExp(`\\s${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];

const anchorsFromDocument = (filePath) => {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_DOCUMENT_BYTES) {
    return { issue: `anchor target exceeds ${MAX_DOCUMENT_BYTES} byte limit` };
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  if (lines.some((line) => line.length > MAX_LINE_LENGTH)) {
    return { issue: `anchor target has a line over ${MAX_LINE_LENGTH} characters` };
  }

  const isMarkdown = MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  const visibleLines = isMarkdown ? linesOutsideMarkdownCode(lines) : lines;
  // Strip HTML comments, terminated or not: `-->` closes one, and an
  // unterminated comment runs to end of input. Both alternatives are required —
  // without the `$` arm, an anchor parked inside an unterminated comment
  // validates as real and a link to it silently passes, which is the exact
  // false negative this tool exists to catch. One pass suffices because every
  // `<!--` is consumed by construction, and HTML comments do not nest, so text
  // after the first `-->` is genuinely visible and must survive.
  const visibleContents = visibleLines.join('\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const anchors = new Set();
  const htmlTag = /<([a-z][\w:-]*)\b[^>]*>/gi;
  for (const match of visibleContents.matchAll(htmlTag)) {
    const id = htmlAttribute(match[0], 'id');
    if (id) {
      anchors.add(id);
    }
    if (match[1].toLowerCase() === 'a') {
      const name = htmlAttribute(match[0], 'name');
      if (name) {
        anchors.add(name);
      }
    }
  }

  if (isMarkdown) {
    const headingAnchors = new Set();
    let previousLine = '';

    for (const line of visibleContents.split('\n')) {
      const atxHeading = line.match(
        /^\s{0,3}#{1,6}(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/,
      )?.[1];
      const setextHeading =
        previousLine && /^\s{0,3}(?:=+|-+)\s*$/.test(line) ? previousLine.trim() : '';
      const heading = atxHeading || setextHeading;

      if (heading) {
        const baseSlug = headingSlug(heading);
        let slug = baseSlug;
        let suffix = 1;
        while (headingAnchors.has(slug)) {
          slug = `${baseSlug}-${suffix}`;
          suffix += 1;
        }
        headingAnchors.add(slug);
        anchors.add(slug);
      }

      previousLine = line;
    }
  }

  return { anchors };
};

const resolveTarget = ({ anchorCache, boundary, sourceFile, target }) => {
  if (!target || EXTERNAL_TARGET.test(target.trim())) {
    return {};
  }

  const { fragment, pathname } = splitTarget(target);
  let escapedBoundary = false;

  for (const candidate of pathCandidates({ boundary, sourceFile, pathname })) {
    if (!isWithin(boundary, candidate)) {
      escapedBoundary = true;
      continue;
    }
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const realCandidate = fs.realpathSync(candidate);
    if (!isWithin(boundary, realCandidate)) {
      escapedBoundary = true;
      continue;
    }

    const stats = fs.statSync(realCandidate);
    if (!stats.isFile() && !stats.isDirectory()) {
      continue;
    }
    if (fragment && stats.isDirectory()) {
      continue;
    }

    if (fragment && DOCUMENT_EXTENSIONS.has(path.extname(candidate).toLowerCase())) {
      let anchorResult = anchorCache.get(realCandidate);
      if (!anchorResult) {
        anchorResult = anchorsFromDocument(realCandidate);
        anchorCache.set(realCandidate, anchorResult);
      }
      if (anchorResult.issue) {
        return { issue: anchorResult.issue };
      }
      if (!anchorResult.anchors.has(fragment)) {
        return { issue: 'missing anchor' };
      }
    }

    return {};
  }

  return escapedBoundary
    ? { issue: 'link target escapes repository' }
    : { missing: true };
};

const checkDocLinks = (inputs) => {
  const inputPaths = (Array.isArray(inputs) ? inputs : [inputs]).map((input) =>
    path.resolve(input),
  );
  const firstExistingInput = inputPaths.find((input) => fs.existsSync(input));
  if (!firstExistingInput) {
    return { brokenLinks: [], total: 0 };
  }
  const boundary = findRepositoryBoundary(firstExistingInput);
  const brokenLinks = [];
  const anchorCache = new Map();
  let total = 0;

  const record = (problem) => {
    total += 1;
    if (brokenLinks.length < MAX_DIAGNOSTICS) {
      brokenLinks.push(problem);
    }
  };

  for (const sourceFile of listDocuments(inputPaths)) {
    const relativeFile = path.relative(boundary, sourceFile);
    const stats = fs.statSync(sourceFile);
    if (stats.size > MAX_DOCUMENT_BYTES) {
      record({
        file: relativeFile,
        issue: `document exceeds ${MAX_DOCUMENT_BYTES} byte limit`,
        line: 1,
        target: '',
      });
      continue;
    }

    const lines = fs.readFileSync(sourceFile, 'utf8').split(/\r?\n/);
    let fence = null;

    lines.forEach((line, index) => {
      if (line.length > MAX_LINE_LENGTH) {
        record({
          file: relativeFile,
          issue: `line exceeds ${MAX_LINE_LENGTH} character limit`,
          line: index + 1,
          target: '',
        });
        return;
      }

      const fenceResult = markdownFenceState(line, fence);
      fence = fenceResult.fence;
      if (fenceResult.isCode) {
        return;
      }

      for (const link of linksFromLine(line)) {
        if (link.issue) {
          record({
            file: relativeFile,
            issue: link.issue,
            line: index + 1,
            target: link.target,
          });
          continue;
        }

        const result = resolveTarget({
          anchorCache,
          boundary,
          sourceFile,
          target: link.target,
        });

        if (result.issue || result.missing) {
          const problem = {
            file: relativeFile,
            line: index + 1,
            target: link.target,
          };
          if (result.issue) {
            problem.issue = result.issue;
          }
          record(problem);
        }
      }
    });
  }

  return { brokenLinks, total };
};

const findBrokenLinks = (rootDir) => checkDocLinks(rootDir).brokenLinks;

const listSourceFiles = (inputPaths) => {
  const sources = new Set();
  const pending = [...inputPaths];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) {
      continue;
    }
    const currentStats = fs.lstatSync(current);
    if (currentStats.isSymbolicLink()) {
      continue;
    }
    if (currentStats.isFile()) {
      if (SOURCE_EXTENSIONS.has(path.extname(current).toLowerCase())) {
        sources.add(fs.realpathSync(current));
      }
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || IGNORED_SOURCE_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        sources.add(fs.realpathSync(entryPath));
      }
    }
  }

  return [...sources].sort();
};

/**
 * Verify every repo-relative `docs/**` path mentioned in source files exists.
 * Complements checkDocLinks, which only ever opens document files.
 *
 * @param {string} rootDir repository root to resolve `docs/…` paths against
 * @param {string[]} [roots] source roots, relative to rootDir
 * @returns {{brokenRefs: {file: string, line: number, target: string}[], total: number}}
 */
const checkSourceDocRefs = (rootDir, roots = DEFAULT_SOURCE_ROOTS) => {
  const boundary = path.resolve(rootDir);
  const inputPaths = roots.map((root) => path.resolve(boundary, root));
  const brokenRefs = [];
  const seen = new Set();
  const packageBaseCache = new Map();
  let total = 0;

  // Bases a docs mention in this file could be relative to: the repo root, and any
  // enclosing package directory. Resolving against both keeps package-local docs
  // (a file under packages/foo/docs/, cited without the package prefix) from
  // reporting as stale.
  const basesFor = (sourceFile) => {
    const startDir = path.dirname(sourceFile);
    if (packageBaseCache.has(startDir)) {
      return packageBaseCache.get(startDir);
    }
    const bases = [boundary];
    let current = startDir;
    while (isWithin(boundary, current) && current !== boundary) {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        bases.push(current);
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    packageBaseCache.set(startDir, bases);
    return bases;
  };

  for (const sourceFile of listSourceFiles(inputPaths)) {
    const stats = fs.statSync(sourceFile);
    if (stats.size > MAX_DOCUMENT_BYTES) {
      continue;
    }
    const relativeFile = path.relative(boundary, sourceFile);
    const lines = fs.readFileSync(sourceFile, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.length > MAX_LINE_LENGTH) {
        return;
      }
      for (const match of line.match(DOCS_PATH_IN_SOURCE) ?? []) {
        const target = match.replace(/\\/g, '/');
        const resolvesSomewhere = basesFor(sourceFile).some((base) => {
          const resolved = path.resolve(base, target);
          return isWithin(boundary, resolved) && fs.existsSync(resolved);
        });
        if (resolvesSomewhere) {
          continue;
        }
        // One diagnostic per (file, target): a path cited on many lines of the
        // same file is one stale pointer to fix, not N findings.
        const key = `${relativeFile} ${target}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        total += 1;
        if (brokenRefs.length < MAX_DIAGNOSTICS) {
          brokenRefs.push({ file: relativeFile, line: index + 1, target });
        }
      }
    });
  }

  return { brokenRefs, total };
};

const EMPTY_RESULT = { brokenLinks: [], brokenRefs: [], total: 0 };

if (require.main === module) {
  const args = process.argv.slice(2);
  // CI feeds document lists through xargs, which may invoke this script several
  // times. Without these flags the source scan would repeat per batch and
  // double-report the same stale reference, so each pass is separately selectable.
  const docsOnly = args.includes('--docs-only');
  const sourcesOnly = args.includes('--sources-only');
  const inputs = args.filter((arg) => !arg.startsWith('--'));

  const { brokenLinks, total } = sourcesOnly
    ? EMPTY_RESULT
    : checkDocLinks(inputs.length > 0 ? inputs : ['docs']);

  const sourceResult = docsOnly
    ? EMPTY_RESULT
    : checkSourceDocRefs(findRepositoryBoundary(process.cwd()));

  if (total === 0 && sourceResult.total === 0) {
    console.log('Documentation links are valid.');
  } else {
    for (const link of brokenLinks) {
      const issue = link.issue || 'missing link target';
      const target = link.target ? ` "${link.target}"` : '';
      console.error(`${link.file}:${link.line}: ${issue}${target}`);
    }
    if (brokenLinks.length < total) {
      console.error(`${total} problems found; showing the first ${brokenLinks.length}.`);
    }
    for (const ref of sourceResult.brokenRefs) {
      console.error(
        `${ref.file}:${ref.line}: source cites a missing document "${ref.target}"`,
      );
    }
    if (sourceResult.brokenRefs.length < sourceResult.total) {
      console.error(
        `${sourceResult.total} stale source references found; showing the first ${sourceResult.brokenRefs.length}.`,
      );
    }
    process.exitCode = 1;
  }
}

module.exports = {
  checkDocLinks,
  checkSourceDocRefs,
  DEFAULT_SOURCE_ROOTS,
  findBrokenLinks,
  MAX_DIAGNOSTICS,
  MAX_DOCUMENT_BYTES,
  MAX_LINE_LENGTH,
};
