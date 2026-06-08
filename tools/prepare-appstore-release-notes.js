#!/usr/bin/env node
// Derive a plain-text "What's New" file for App Store Connect from the
// generated GitHub release notes (build/release-notes.md).
//
// App Store Connect release notes are plain text (no markdown), so this strips
// headings, emphasis and links and drops the GitHub-only downloads footer. The
// result is written for the App Store deliver lanes (fastlane/Fastfile).
//
// Usage: node tools/prepare-appstore-release-notes.js [outFile] [locale]
//   outFile  defaults to fastlane/appstore_metadata/<locale>/release_notes.txt
//   locale   defaults to en-US

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT_DIR, 'build', 'release-notes.md');
// App Store Connect caps "What's New" at 4000 characters.
const MAX_CHARS = 4000;

const locale = process.argv[3] || 'en-US';
const outFile =
  process.argv[2] ||
  path.join(ROOT_DIR, 'fastlane', 'appstore_metadata', locale, 'release_notes.txt');

// GitHub-only footer lines that don't belong in an App Store "What's New".
// Anchored to the start of the line so they can't swallow a legitimate content
// line that merely mentions "download" (e.g. a fix about a download dialog).
const FOOTER_PATTERNS = [
  /check the wiki/i,
  /^\s*for all current downloads/i,
  /^\s*for the latest version/i,
  /^\s*(see|view|read) the (full )?changelog/i,
  /releases\/latest\b/i,
  /^\s*visit:?\s*$/i,
  /^\s*https?:\/\/\S+\s*$/i,
];

const toPlainText = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => !FOOTER_PATTERNS.some((re) => re.test(line)))
    .map((line) =>
      line
        // headings: "## Features" -> "Features"
        .replace(/^#{1,6}\s*/, '')
        // bold: "**text**" -> "text"
        .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '$1')
        // italic "*text*" -> "text" (markers must hug non-space and be bounded
        // by whitespace/edges, so stray asterisks like "*.md" or "a * b" survive)
        .replace(/(^|\s)\*(?=\S)([^*\n]+?)\*(?=\s|$)/g, '$1$2')
        // italic "_text_" -> "text" (intra-word underscores like snake_case
        // are left untouched by the boundary requirements)
        .replace(/(^|\s)_(?=\S)([^_\n]+?)_(?=\s|$)/g, '$1$2')
        // links: "[text](url)" -> "text"
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // list bullets: "- item" / "* item" -> "• item"
        .replace(/^\s*[-*]\s+/, '• '),
    )
    .join('\n')
    // collapse 3+ blank lines down to a single blank line
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Always ensure the deliver metadata dir exists so the App Store lanes never
// fail on a missing metadata_path; an empty dir simply leaves "What's New"
// untouched in App Store Connect.
fs.mkdirSync(path.dirname(outFile), { recursive: true });

if (!fs.existsSync(SOURCE_FILE)) {
  console.error(`No release notes source found at ${SOURCE_FILE}; skipping.`);
  process.exit(0);
}

let text = toPlainText(fs.readFileSync(SOURCE_FILE, 'utf8'));

if (!text) {
  console.error('Release notes are empty after processing; skipping.');
  process.exit(0);
}

const chars = [...text];
if (chars.length > MAX_CHARS) {
  // Slice by code points (not UTF-16 units) so a multi-byte character (e.g. an
  // emoji surrogate pair) is never cut in half. Keeps us within ASC's cap.
  text = `${chars.slice(0, MAX_CHARS - 1).join('').trimEnd()}…`;
}

fs.writeFileSync(outFile, `${text}\n`, 'utf8');
console.log(`Wrote App Store release notes (${text.length} chars) to ${outFile}`);
