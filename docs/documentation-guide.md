# Documentation Guide

Rules and conventions for Super Productivity's documentation.
The [Diátaxis skill](../.agents/skills/diataxis/SKILL.md) owns how a public page is planned, written, and verified.

## The three documentation sets

| Set             | Location                  | Role                                                           |
| --------------- | ------------------------- | -------------------------------------------------------------- |
| Public docs     | [`docs/public/`](public/) | User, contributor, and integrator docs, organized by Diátaxis. |
| Legacy wiki     | [`docs/wiki/`](wiki/)     | GitHub Wiki source; migration to public docs is in progress.   |
| Maintainer docs | [`docs/`](README.md)      | Internal guides, decisions, runbooks, plans, and research.     |

Canonical prose lives in `docs/public/` once a page exists; until then, the legacy wiki owns the user-facing description.

## Before public documentation work

Read and use the [Diátaxis skill](../.agents/skills/diataxis/SKILL.md).
Read [the public docs index](public/README.md) for the directory map and frontmatter.

Public pages follow these rules:

- A page serves exactly one quadrant: tutorials, how-to, reference, or explanation.
- Every page opens with `title`, `type`, and `domain` frontmatter, and `type` matches its quadrant directory.
- Every page ends with a `## Related` section that links its neighbours.
- Reference and explanation pages cite code by footnote; tutorial and how-to pages link their neighbours.
- Link to the authoritative home of a fact instead of copying it.

## When user-facing behavior changes

1. If a `docs/public/` page already owns the behavior, update it in the same PR. Use passive mode in the skill.
2. If only a legacy wiki note documents the behavior, make the minimal correction there and name the intended public page in the PR. Do not add a new wiki note.
3. If the change adds a new user-facing feature, create the public page in active mode and link it from an index. Do not add a new wiki note.
4. If the change is purely internal, leave public docs alone. Update the maintainer guide or code comment that owns the fact.

During the migration, do not duplicate a fact in both `docs/public/` and `docs/wiki/`.
Convert a wiki note by creating the quadrant-pure public page first and then redirect the reader to the updated page.
Never move or restructure `docs/wiki/` without warning: [`wiki-sync.yml`](../.github/workflows/wiki-sync.yml) mirrors it to the GitHub Wiki.

## Legacy wiki rules

Until a note is migrated, the old wiki rules still apply.
Read [`0.00-Wiki-Structure-and-Organization.md`](wiki/0.00-Wiki-Structure-and-Organization.md) before editing.
The wiki's flat structure, wiki-style links, and numbering exist for the GitHub Wiki mirror.

### Common change targets

| Change                         | Legacy note                            |
| ------------------------------ | -------------------------------------- |
| Setting, preference, or config | `3.02-Settings-and-Preferences.md`     |
| Keyboard shortcut              | `3.03-Keyboard-Shortcuts.md`           |
| Short syntax                   | `3.04-Short-Syntax.md`                 |
| Issue provider                 | `3.07-Issue-Integration-Comparison.md` |
| Sync provider                  | `3.08-Sync-Integration-Comparison.md`  |
| User data, storage, or backup  | `3.06-User-Data.md`                    |

### Default to Reference notes

Reference notes are mechanical descriptions of what exists: settings, shortcuts, APIs, data shapes, and comparisons.
They are the safest target for a code-driven correction.
The other categories are more human-authored:

- **Quickstarts (`1.XX`)** are teaching and onboarding narratives. Do not rewrite voice or restructure them on your own.
- **How-To (`2.XX`)** notes are task recipes with an assumed audience and tone. Update a step when a workflow genuinely changed; do not expand its scope.
- **Concepts (`4.XX`)** notes carry explanatory background and design rationale. Touch them only with strong evidence; flag rather than rewrite.

When a change affects a non-Reference note, make the minimal correction and call it out in the PR description so a human can review the prose.
If you are unsure which note to edit, ask before writing.

### Wiki checks

Wiki notes are linted in CI before they are synced to the GitHub Wiki.
Run the local checks before submitting:

```bash
npm run docs:check-links
pymarkdownlnt --disable-rules line-length,no-inline-html scan docs/wiki
```

See [`0.02-Wiki-QA-and-Maintenance.md`](wiki/0.02-Wiki-QA-and-Maintenance.md) for linting and link policy, and [`0.01-Style-Guide.md`](wiki/0.01-Style-Guide.md) for Markdown and formatting conventions.
External URLs are not crawled in the wiki PR gate because transient failures make them unsuitable as a required check.
Open any external link you add or change.

## Public docs checks

`npm run docs:public:check` runs the five deterministic checks:

- **Vale** checks prose, style, accessibility, and readability with [the repository configuration](public/.meta/vale/README.md).
- **markdownlint-cli2** checks Markdown structure with [the repository configuration](public/.meta/markdownlint/README.md).
- **frontmatter.py** requires `title`, `type`, and `domain`, and checks that `type` matches the quadrant directory.
- **visual.py** requires padded tables and keeps table, code, and diagram lines within 120 characters.
- **lychee** checks links and anchors with [the repository configuration](public/.meta/lychee/README.md).

The individual scripts are `docs:public:vale`, `docs:public:markdownlint`, `docs:public:frontmatter`, `docs:public:visual`, and `docs:public:lychee`.
The tool READMEs carry the install commands and pinned CI versions.
The page checks require Python 3.
The skill and checker configurations are vendored from the [diataxis-toolkit](https://github.com/zenoprax/diataxis-toolkit).
CI runs the same suite in the [`Documentation Links`](../.github/workflows/docs-links.yml) workflow with `DOCS_LYCHEE_OFFLINE=1`, so pull requests validate local links and anchors only.
Run `docs:public:lychee` without that variable to check external links.
External failures can be transient; re-run before treating one as durable.

`npm run docs:check-links` checks the `docs/` tree, including the legacy wiki.
CI also runs the checker over all tracked Markdown and HTML and scans `docs/**` references in source comments.
It remains required.
The CI link job excludes the skill's `voice/example-text/` corpus because those files are verbatim reference material with site-relative links.

## Developer-facing docs

Public docs serve users, contributors, and integrators.
Maintainer-facing documentation remains in `docs/`, package READMEs, and [`ARCHITECTURE-DECISIONS.md`](../ARCHITECTURE-DECISIONS.md).
Examples include `docs/styling-guide.md`, `docs/sync-and-op-log/`, `docs/plugin-development.md`, `docs/plans/`, and `docs/research/`.
Update those notes alongside the code they describe.
Do not move a maintainer guide into `docs/public/` without warning, because some developers rely on its current location.

## Before you finish

- The public page carries frontmatter, serves one quadrant, links its neighbours, and cites its facts.
- `npm run docs:public:check` passes.
- `npm run docs:check-links` passes.
- A legacy wiki change, if any, passes the wiki checks.
- The new page is linked from an index or another canonical document.
