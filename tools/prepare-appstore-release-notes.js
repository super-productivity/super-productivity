#!/usr/bin/env node
// Derive a plain-text "What's New" file for App Store Connect from the
// generated GitHub release notes (build/release-notes.md).
//
// App Store Connect release notes are plain text (no markdown), so this strips
// headings, emphasis and links and drops the GitHub-only downloads footer. The
// result is written for the App Store deliver lanes (fastlane/Fastfile).
//
// It also removes bullets that reference non-Apple platforms (Android, Linux,
// Windows, …). The shared release-notes generator intentionally keeps those for
// the GitHub/Play Store changelogs, but App Review guideline 2.3.10 rejects
// metadata that talks about third-party platforms ("Revise the app's What's New
// text to remove Android references"). Those changes also don't apply to the
// macOS/iOS builds, so dropping them is correct on both counts.
//
// Emoji are stripped for the same reason: App Store Connect rejects some of them
// outright in "What's New" (see EMOJI_PATTERN).
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

// Non-Apple platforms whose names must not appear in App Store metadata
// (guideline 2.3.10). Matched as whole words, case-insensitively. Intentionally
// aggressive: any changelog line naming one of these is dropped wholesale (and
// logged), since it describes a change that doesn't ship on the macOS/iOS builds
// anyway. The bias is deliberate — a false negative (a platform name leaking to
// Apple) costs another rejection, while a false positive (e.g. the plural noun
// "windows") only drops a line that is logged and recoverable. Edit this list —
// not the call sites — if a future platform needs covering.
const OTHER_PLATFORM_PATTERNS = [
  /\bandroid\b/i,
  /\blinux\b/i,
  /\bwindows\b/i,
  /\bgnome\b/i,
  /\bx11\b/i,
  /\bwayland\b/i,
  /\bkde\b/i,
  /\bflatpak\b/i,
  /\bappimage\b/i,
  /\bsnapcraft\b/i,
  /\baur\b/i,
];

// App Store Connect rejects individual emoji in "What's New" and names the
// offender in the error ("What's New in This Version can’t contain the following
// character(s): 🚨. - /data/attributes/whatsNew"). Apple documents neither which
// characters are blocked nor when the set changes, so strip pictographs
// wholesale instead of chasing a blocklist. Emoji reach the notes without anyone
// writing one deliberately: the bug-report issue template prefixes titles with
// "🚨 ", and a squash merge carries that into the commit subject the changelog is
// built from (this sank both Apple release lanes for 18.20.0, via #9530).
// Deliberately aggressive, mirroring OTHER_PLATFORM_PATTERNS: a missed emoji
// fails the release, while an over-eager match only costs decoration (©, ® and ™
// are pictographs too and go with it — they have never appeared in a changelog
// entry here, and Apple accepts the text either way). The trailing TAG block is
// the tail of a tag sequence (e.g. the England flag): invisible on its own, so
// leaving it behind would send Apple an unrenderable character and produce a CI
// error naming nothing.
const EMOJI_PATTERN =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0E}\u{FE0F}\u{20E3}\u{200D}\u{E0020}-\u{E007F}]/gu;

// Bullet/heading and emphasis markers, i.e. everything that can legitimately
// precede the text of a line. A line left with only these once its emoji are
// gone had no prose to begin with. Covers the markers the AI generation path can
// emit ("+", "_", ">"), not just the "- " the deterministic generator produces.
const LINE_MARKERS_ONLY = /^[\s*•\-#+_>]*$/;

const isMarkdownHeading = (line) => /^\s*#{1,6}\s/.test(line);

// Remove emoji, then repair the line: close the gap the removed character left
// ("- 🚨 Fix" -> "- Fix"), and blank out a line that was pure decoration ("- 🎉")
// so it leaves neither a bare bullet nor content that keeps an otherwise empty
// heading alive. Runs before stripOtherPlatformLines so dropEmptyHeadings sees
// the blanked lines.
const stripEmoji = (markdown) =>
  markdown
    .split('\n')
    .map((line) => {
      const stripped = line.replace(EMOJI_PATTERN, '');
      if (stripped === line) {
        return line;
      }
      const collapsed = stripped.replace(/[ \t]{2,}/g, ' ').trimEnd();
      return LINE_MARKERS_ONLY.test(collapsed) ? '' : collapsed;
    })
    .join('\n');

// Drop a section heading that has no content line after it (before the next
// heading). Single backward pass: walking bottom-up, "did real content follow
// this heading?" is already known by the time we reach the heading, so no
// per-heading forward re-scan is needed.
const dropEmptyHeadings = (lines) => {
  const reversed = [];
  let sawContentSinceHeading = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (isMarkdownHeading(line)) {
      if (!sawContentSinceHeading) {
        continue;
      }
      sawContentSinceHeading = false;
    } else if (line.trim() !== '') {
      sawContentSinceHeading = true;
    }
    reversed.push(line);
  }
  return reversed.reverse();
};

// Drop every line that names a non-Apple platform — bullets, but also section
// headings and intro prose, since the AI generation path (SP_RELEASE_NOTES_AI)
// can fold a platform name into a heading or sentence the deterministic
// generator never would, and a single leaked name re-triggers the 2.3.10
// rejection. Then drop any section heading the removals left empty (e.g. a
// release whose only "Fixes" were Android-specific must not emit a dangling
// "Fixes" header). `onDrop` reports each removed line for CI logs.
const stripOtherPlatformLines = (markdown, onDrop = () => {}) => {
  const kept = markdown.split('\n').filter((line) => {
    const namesOtherPlatform = OTHER_PLATFORM_PATTERNS.some((re) => re.test(line));
    if (namesOtherPlatform) {
      onDrop(line.trim());
    }
    return !namesOtherPlatform;
  });

  return dropEmptyHeadings(kept).join('\n');
};

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

// Truncate by code points (not UTF-16 units) so a multi-byte character (e.g. an
// emoji surrogate pair) is never cut in half. Keeps us within ASC's cap.
const truncateToMaxChars = (text, maxChars = MAX_CHARS) => {
  const chars = [...text];
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars
    .slice(0, maxChars - 1)
    .join('')
    .trimEnd()}…`;
};

const buildAppStoreReleaseNotes = (markdown, onDrop) =>
  truncateToMaxChars(toPlainText(stripOtherPlatformLines(stripEmoji(markdown), onDrop)));

const main = () => {
  const locale = process.argv[3] || 'en-US';
  const outFile =
    process.argv[2] ||
    path.join(ROOT_DIR, 'fastlane', 'appstore_metadata', locale, 'release_notes.txt');

  // Always ensure the deliver metadata dir exists so the App Store lanes never
  // fail on a missing metadata_path; an empty dir simply leaves "What's New"
  // untouched in App Store Connect.
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`No release notes source found at ${SOURCE_FILE}; skipping.`);
    process.exit(0);
  }

  const text = buildAppStoreReleaseNotes(fs.readFileSync(SOURCE_FILE, 'utf8'), (line) =>
    console.error(`Dropping non-Apple-platform release note: ${line}`),
  );

  if (!text) {
    console.error('Release notes are empty after processing; skipping.');
    process.exit(0);
  }

  fs.writeFileSync(outFile, `${text}\n`, 'utf8');
  console.log(`Wrote App Store release notes (${text.length} chars) to ${outFile}`);
};

if (require.main === module) {
  main();
}

module.exports = {
  EMOJI_PATTERN,
  MAX_CHARS,
  OTHER_PLATFORM_PATTERNS,
  buildAppStoreReleaseNotes,
  stripEmoji,
  stripOtherPlatformLines,
  toPlainText,
  truncateToMaxChars,
};
