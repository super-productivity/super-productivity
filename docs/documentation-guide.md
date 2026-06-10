# Documentation Guide

Rules and conventions for keeping Super Productivity's documentation in sync with the code.

## Why this matters

The `docs/wiki/` directory is the manually curated, human-focused wiki that ships to the [GitHub Wiki](https://github.com/super-productivity/super-productivity/wiki) via CI. It is intentionally separate from the auto-generated [DeepWiki](https://deepwiki.com/super-productivity/super-productivity), which describes code mechanics. The wiki is what users read for context, intent, and how features fit together.

## When to update the wiki

**When user-facing functionality changes, update `docs/wiki/` in the same PR.** Common cases and their target notes:

| Change                                                               | Note to edit                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| New/changed/removed setting, preference, or config option            | `3.02-Settings-and-Preferences.md`                                             |
| Added/changed/removed keyboard shortcut                              | `3.03-Keyboard-Shortcuts.md`                                                   |
| Short-syntax additions or changes                                    | `3.04-Short-Syntax.md`                                                         |
| New or changed REST / Plugin / Sync API surface                      | `3.01-API.md`                                                                  |
| New issue or sync provider, or behavior change in an existing one    | `3.07-Issue-Integration-Comparison.md` / `3.08-Sync-Integration-Comparison.md` |
| User data shape, storage location, or backup/import behavior changes | `3.06-User-Data.md`                                                            |
| New theming hook or theme variable change                            | `3.09-Theming.md`                                                              |
| Web vs desktop capability differences                                | `3.05-Web-App-vs-Desktop.md`                                                   |

If a change is purely internal (eg. refactor, test, perf, build), no wiki update is needed.
Some subsystems may be so specific that code comments alone would suffice; in this case no wiki update is needed unless it directly contradicts what has already been written.

## How to write wiki content

**Read [`docs/wiki/0.00-Wiki-Structure-and-Organization.md`](wiki/0.00-Wiki-Structure-and-Organization.md) before editing.** It defines the four note categories (Quickstarts, How-To, Reference, Concepts), the numbering scheme, and the [Diátaxis](https://diataxis.fr/)-style writing guidance for each. Reference notes describe accurately, comprehensively, and consistently — nothing more.

## Default to Reference notes (`3.XX`)

Reference notes are mechanical descriptions of what exists (settings, shortcuts, APIs, data shapes, comparisons). They are the safest target for code-driven updates. The other categories are more human-authored and should be touched with care:

- **Quickstarts (`1.XX`)** — teaching/onboarding narratives. Don't rewrite voice or restructure on your own.
- **How-To (`2.XX`)** — task recipes with assumed audience and tone. Update steps if a workflow genuinely changed; don't expand scope.
- **Concepts (`4.XX`)** — explanatory background and design rationale. Touch only with strong evidence; flag rather than rewrite.

If a change clearly affects a non-Reference note (e.g. a How-To step is now wrong because the UI moved), make the minimal correction needed and call it out in the PR description so a human can review the prose. If unsure which note to edit, or whether a change warrants a wiki update at all, ask before writing.

## Wiki linting and quality

Wiki notes are linted in CI before being synced to GitHub Wiki. See [`docs/wiki/0.02-Wiki-QA-and-Maintenance.md`](wiki/0.02-Wiki-QA-and-Maintenance.md) for linting rules and link-checking, and [`docs/wiki/0.01-Style-Guide.md`](wiki/0.01-Style-Guide.md) for markdown and formatting conventions.

## Developer-facing docs

The wiki is for both end-users and developers. There are still developer-facing docs (`docs/styling-guide.md`, `docs/sync-and-op-log/`, `docs/plugin-development.md`, `ARCHITECTURE-DECISIONS.md`) which are either too old or too new to have been considered for integration into the wiki. Regardless, follow the same "update alongside the code" rule when those notes requires changes and point out when they can be integrated into the main wiki. Never refactor them into the new wiki without warning as some devs may be relying on them in their current location.
