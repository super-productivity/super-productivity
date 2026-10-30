# Maintainer documentation

This directory contains user documentation, maintainer runbooks, architecture
guidance, active plans, and research. These have different authority: a plan or
research note does not override the current code, tests, or an accepted decision.

## Maintained guides

Update these alongside the behavior or workflow they describe:

- [Repository content map](repository-map.md) — task keywords → code entry points,
  relevant constraints, and focused tests; start here to select what to read
- [`src/app` layer map](../src/app/README.md) — where things live, which way
  dependencies point, and which of those directions are lint-enforced
- [Documentation guide](documentation-guide.md)
- [Public documentation](public/README.md) — structure, quadrant map, and migration status
- [Development environment variables](ENV_SETUP.md)
- [Plugin development](plugin-development.md)
- [Adding an issue integration](add-new-integration.md)
- [Feature and PR review guide](feature-review-guide.md)
- [Market position](market/README.md) — where SP must be best, the competitor set
  and the monthly refresh; its [scorecard](market/scorecard.md) is a dated
  snapshot that the refresh updates
- [Styling guide](styling-guide.md) and [theming contract](theming-contract.md)
- [Android edge-to-edge and keyboard behavior](android-edge-to-edge-keyboard.md)
- [Android home-screen widget](android-home-screen-widget.md)
- [Release and publishing runbook](release-and-publishing.md)
- [Apple release automation](apple-release-automation.md)
- [Translation guide](TRANSLATING.md) and [i18n script usage](i18n-script-usage.md)

Public-facing documentation is migrating to [`public/`](public/), organized by
Diátaxis and checked with the [diataxis skill](../.agents/skills/diataxis/SKILL.md).
The legacy [`wiki/`](wiki/) remains the GitHub Wiki source until the migration
completes. Sync and operation-log architecture lives in
[`sync-and-op-log/`](sync-and-op-log/).

## Documentation tooling

The public docs checks run from [`docs/public/.meta/`](public/.meta/):

- [Vale](public/.meta/vale/README.md) checks prose and style.
- [markdownlint-cli2](public/.meta/markdownlint/README.md) checks Markdown structure.
- [lychee](public/.meta/lychee/README.md) checks links and anchors.
- [`npm run docs:public:check`](../.agents/skills/diataxis/scripts/checks.sh)
  runs all five checks, including the frontmatter and visual page checks.

## Decisions

Accepted decisions describe constraints that remain true even after the
implementation work is complete:

[`../ARCHITECTURE-DECISIONS.md`](../ARCHITECTURE-DECISIONS.md) is the index of all
of them. It holds the numbered records inline, and its
[Decisions Recorded Elsewhere](../ARCHITECTURE-DECISIONS.md#decisions-recorded-elsewhere)
table points at the ones that live in their own document or as a contributor rule
— such as
[SuperSync database encryption at rest](supersync-encryption-at-rest-decision.md).
A decision kept outside that file must still be listed there.

A decision must state its status and date, the chosen outcome, why it was chosen,
and what would justify revisiting it. Superseded decisions remain as history but
must link to their replacement, and keep their original number.

## Active plans

[`plans/`](plans/) and [`long-term-plans/`](long-term-plans/) contain proposals,
not current behavior. Every active plan should start with:

- status (`Proposed`, `Planned`, `In progress`, or `Deferred`);
- owner and tracking issue or pull request;
- date last verified against the code;
- completion or removal condition.

A plan for a user-facing interaction also includes a **Prior art** section →
[feature review guide § Prior art](feature-review-guide.md#prior-art).

When implementation lands, move enduring contracts or limitations into a
maintained guide, package README, code comment, or decision record, then delete
the completed plan. Do not leave handover notes or “next steps” documents as
permanent documentation.

## Research and audits

[`research/`](research/) records evidence gathered at a point in time. It is
non-normative unless a maintained guide or accepted decision adopts its result.
Research should state its snapshot date and tracking issue. Large audit outputs
may remain while findings are being triaged, but verified work should move to
issues and durable safety constraints should move to maintained documentation.

Delete a research note once its conclusions have moved into a maintained guide,
a decision record, or tracked issues. Git history keeps it retrievable.

A finding frozen against a past commit decays silently, so state what would make
it wrong: any claim about which releases carry a change must be re-derived with
`git tag --contains`, never recalled, because the next tag can invert it without
any code changing.

- [Recurring events implementation plan](research/recurring-events-implementation-plan.md)
- [Snap Wayland GPU root cause and shipped fix](research/snap-wayland-gpu-fix-research.md)
  — kept past its research life because `electron-builder.yaml`,
  `tools/afterPack.js` and `build/linux/snap-wrapper.sh` cite it for the reason
  their guards exist

## Review checklist

When changing behavior or operations:

1. Update the relevant maintained guide in the same change.
2. Verify commands, paths, API names, workflow triggers, and secret names against
   the repository rather than copying them from an older plan.
3. Link new documents from this index, a package README, or another canonical
   document so they are discoverable.
4. Remove or mark superseded documents that now contradict the new source.
5. Never put credentials, user data, or production-specific secret values in
   documentation.
6. Run `npm run docs:check-links`; for a `docs/public/` change, also run
   `npm run docs:public:check`.
