# Implementation plan: Automatic Codex code review on pull requests

**Status:** Plan only · **Date:** 2026-08-13
**Baseline:** master `204ac0ebfc`.
**Difficulty:** Low. Roughly half an hour of settings work plus one small `AGENTS.md`
commit. No workflow YAML, no new dependencies, no CI secrets.
**Owner:** @johannesjo (the Codex cloud connection is account-bound and cannot be
delegated to a repo secret).

## Outcome and scope

Enable OpenAI Codex code review on pull requests through the **managed Codex cloud
GitHub integration**, billed against the existing ChatGPT Pro plan, and teach it this
repository's review doctrine through a `## Code Review Rules` section in `AGENTS.md`.

Rollout is staged: on-demand `@codex review` first, automatic reviews only after the
signal quality has been judged on real PRs.

Out of scope: a self-hosted `openai/codex-action` workflow (ruled out below), replacing
or modifying the existing `@claude` workflow in `.github/workflows/claude.yml`, and any
change to CI gating — Codex review is advisory and must never become a required check.

## Decision: managed integration, not a GitHub Actions workflow

Two routes exist. The managed one wins on this repository for two independent reasons,
either of which is sufficient on its own.

### Reason 1 — a ChatGPT plan cannot authenticate a GitHub Action

`openai/codex-action` requires an `openai-api-key` that works as an
`Authorization: Bearer <KEY>` header against the Responses API — that is metered
platform billing, entirely separate from a ChatGPT subscription. ChatGPT-plan auth is a
browser OAuth flow; headless auth for ChatGPT-linked plans is still an open feature
request ([openai/codex#3820](https://github.com/openai/codex/issues/3820)), and the
non-interactive Codex access tokens that do exist are **ChatGPT Enterprise-only**.

Pro is therefore usable by the managed integration and unusable by the Action. Choosing
the Action route means opening a second, metered API bill.

### Reason 2 — most PRs come from forks, where the Action route is unsafe

PR authorship over the 30 days to 2026-08-13 (`gh search prs`, measured 2026-08-13):

| Source                             | PRs/mo | Head repo |
| ---------------------------------- | ------ | --------- |
| johannesjo                         | 144    | same-repo |
| dependabot                         | 31     | same-repo |
| External contributors (~15 people) | ~100   | **fork**  |
| **Total**                          | ~275   |           |

About 100 PRs a month arrive from forks, and those are precisely the PRs where an
automated review is worth most. GitHub withholds secrets from `pull_request` runs
triggered by forks, so an Action-based review would fail on exactly that cohort.

Recovering the secret means `pull_request_target`, which runs with repository write
permission and full secret access **while checking out attacker-authored code**, and
then feeds that attacker-authored diff to an agent as its prompt. A prompt injection in
a PR diff could exfiltrate the key or push commits. For a public repo accepting PRs from
strangers this is a live risk, not a theoretical one. The `workflow_run` two-stage
pattern closes the hole but adds ~150 lines of security-critical YAML to own forever.

The managed integration runs outside GitHub Actions. There is no secret in CI to leak
and no untrusted-code-with-write-token window, so the entire class of problem is absent.

### Verification that the managed route actually reviews fork PRs

**OpenAI's documentation does not mention forks at all**, so this was established
empirically instead (measured 2026-08-13). Sampling 400 public PRs carrying comments
from `chatgpt-codex-connector[bot]` and filtering to those where
`head.repo != base.repo` yields confirmed fork reviews in large public repositories:

| Fork PR                                                                          | PR author (external) | Trigger                       |
| -------------------------------------------------------------------------------- | -------------------- | ----------------------------- |
| [home-assistant/core#179062](https://github.com/home-assistant/core/pull/179062) | David-Wu1119         | automatic                     |
| [dashpay/dash#7602](https://github.com/dashpay/dash/pull/7602)                   | knst                 | automatic                     |
| [alibaba/anolisa#2503](https://github.com/alibaba/anolisa/pull/2503)             | ikunkun-sys          | automatic                     |
| [StarRocks/starrocks#77748](https://github.com/StarRocks/starrocks/pull/77748)   | wyb                  | maintainer `@codex review`    |
| [entgra/device-mgt-core#200](https://github.com/entgra/device-mgt-core/pull/200) | IsuriSuhara27        | **PR author** `@codex review` |
| [pingdotgg/t3code#6454](https://github.com/pingdotgg/t3code/pull/6454)           | tarik02              | **PR author** `@codex review` |

Both modes work on fork PRs, and the bot's own comment ("Your team has set up Codex to
review pull requests") confirms the review runs against the **repository owner's**
connected Codex account. External contributors need no Codex or ChatGPT account.

`home-assistant/core` is the closest available analogue to this repository — large,
public, and almost entirely fork-driven — and it receives automatic reviews.

Because this is empirical rather than documented behavior, it is not contractual and
could change without notice. That risk is acceptable given the one-click rollback.

### What is given up

The managed route cannot run repository commands (`npm run checkFile`, the unit suite)
as part of a review, and its automatic mode has no built-in filtering by author, branch,
or draft status. Both are accepted: CI already runs the mechanical checks, and the
filtering gap is handled by staging the rollout rather than by configuration.

## Rollout

### Phase 1 — enable, on-demand only

1. Ensure Codex cloud is set up for `super-productivity/super-productivity`.
2. At <https://chatgpt.com/codex/settings/code-review>, toggle **Code review** on for
   the repository.
3. Leave **Automatic reviews** **off**.

Trigger a review by commenting `@codex review` on a PR. `@codex security review`
requests the deeper security pass (research preview).

Phase 1 costs nothing on the 144 self-authored PRs, produces zero contributor-facing
noise, and exists to answer one question: are the findings good enough to put in front
of an external contributor?

**Exit criterion:** ~10 on-demand reviews across a representative mix (a sync/op-log
change, a UI change, a first-time contributor's PR). Proceed only if the majority
surface something a human reviewer would have wanted, at an acceptable false-positive
rate.

### Phase 2 — teach it the repository's doctrine

Add the `## Code Review Rules` section below to the root `AGENTS.md`. This is where most
of the value is: the repo encodes review doctrine — schema-bump policy, persisted-model
field rules, the feature-creep gate — that a general-purpose reviewer cannot infer.

Do this before Phase 3, so automatic reviews are rule-aware from their first run.

### Phase 3 — decide on automatic reviews

Enable **Automatic reviews** only if Phase 1 met its exit criterion.

**Usage limits are not a constraint on Pro.** Pro includes 400–1,000 code reviews per
5-hour window; ~275 PRs/month is roughly 9/day. Even reviewing everything stays far
below the cap, and Codex is already included in the plan at no marginal cost. The
decision is therefore purely about **noise**, not budget.

The noise cost is real. Automatic mode reviews every new PR including drafts, with no
filtering for dependabot or branch patterns (open requests:
[openai/codex#13597](https://github.com/openai/codex/issues/13597) branch allowlist,
[openai/codex#5669](https://github.com/openai/codex/issues/5669) dependabot). At current
volume that is ~275 bot comments/month, a large share of them on drafts and dependency
bumps where the review adds nothing.

This sits directly against the manifesto rule in `AGENTS.md` — _less noise, more depth_,
and _anything attention-grabbing ships off by default and stays quiet_. A bot commenting
on every draft push is the failure mode that rule exists to prevent. Staying on
on-demand indefinitely is a legitimate outcome of this plan, not a failure of it.

## Re-review on new commits, and the budget-exhaustion question

The obvious worry is that one contributor pushing commit after commit triggers a review
each time and drains the plan's quota, implying some exponential-backoff throttle is
needed. **Measurement says that vector does not exist, so no throttle should be built.**

### Automatic mode reviews once per PR, not once per push

Sampling public PRs reviewed by `chatgpt-codex-connector[bot]` and filtering to those
with five or more commits (measured 2026-08-13, 24 PRs) returns **exactly one Codex
review on every single one**, regardless of how many commits the PR accumulated:

| PR                                   | Commits | Codex reviews |
| ------------------------------------ | ------- | ------------- |
| haibaratou/haibaratou#445            | 317     | 1             |
| LLM-CR-EVAL/argo-workflows-338-cr4#2 | 138     | 1             |
| Datta0/unsloth-staging-3#301         | 50      | 1             |
| danielhanchen/unsloth-staging-2#960  | 30      | 1             |
| finos/morphir-scala#962              | 22      | 1             |

A 317-commit PR received one review. Commit spam therefore cannot burn the quota, and
the backoff schedule it would justify has nothing to throttle.

The corollary matters just as much: **automatic mode never re-reviews on its own.** The
re-review has to be asked for with `@codex review`.

### Every serious implementation avoids re-review on push

Repositories that wire this up themselves converge on the same choice — trigger on PR
open or ready-for-review, never on `synchronize`:

- **DataDog/datadog-agent** — `types: [opened]`, same-repo PRs only, with a
  `no-draft-review` label opt-out and a second workflow that _deletes_ Codex draft
  artifacts once a PR is marked ready.
- **Expensify/App** — `types: [opened, ready_for_review]`, an `isAuthorizedContributor`
  gate before any budget is spent, `!endsWith(github.actor, '[bot]')` to skip dependabot,
  and a `concurrency` group with `cancel-in-progress` so rapid pushes supersede.
- **wende/cicada** — the naive `[opened, synchronize]` version, now disabled in place
  (`if: false`, `types: []`).

### Decision: no backoff workflow

Re-review stays manual. A maintainer comments `@codex review` when a PR has genuinely
changed enough to warrant another pass. That is human-rate-limited by construction,
costs nothing to build, and cannot run away.

Building the backoff instead would mean a `pull_request_target` workflow — the exact
security-critical trigger this plan's whole premise avoids — to solve a problem the data
says is not occurring. Per _avoid feature creep_, it does not earn its place.

### The residual vector is comment spam, not commit spam

External contributors **can** trigger `@codex review` on their own fork PRs, confirmed on
[entgra/device-mgt-core#200](https://github.com/entgra/device-mgt-core/pull/200) and
[pingdotgg/t3code#6454](https://github.com/pingdotgg/t3code/pull/6454). Each invocation
is a review against the repository owner's quota, and the managed integration exposes no
allowlist to restrict who may ask.

Sizing it against Pro's 400–1,000 reviews per 5-hour window: automatic mode's one review
per PR is ~275/month (~9/day), well under 1% of the ceiling. A contributor would have to
deliberately post hundreds of comments within a five-hour window to cause a problem, and
that is visible, attributable GitHub activity subject to normal moderation.

**If it ever happens**, the fallback ladder is: block the user, then turn Automatic
reviews off and rely on maintainer-triggered `@codex review`, and only then consider the
Expensify-shaped gated workflow. Do not pre-build for it.

### How to retrigger a review manually

Three mechanisms were investigated; only the first is free of setup cost.

**1. Comment `@codex review` — works, and accepts scoping instructions.** This is the
supported path and it can be repeated as often as wanted. The trigger also takes
free-form trailing instructions, including pinning to an exact commit, as seen on
[szl-holdings/khipu-consensus#25](https://github.com/szl-holdings/khipu-consensus/pull/25)
where two scoped re-reviews ran minutes apart:

```text
@codex review Please review exact head e3fb6c2c2d5d3e4147753e07aa725…
@codex review Please perform an exact-head security review of 3bc0a1…
```

That makes the manual path strictly more capable than any automatic one: a re-review can
be aimed at the commit and the concern that actually matter.

**2. GitHub's native "re-request review" button — not available.** Codex never registers
as a requested reviewer. Scanning the sampled PRs found zero `review_requested` events
naming the bot and zero PRs listing it in `requested_reviewers`; it posts reviews without
ever being a reviewer, so the ↻ affordance does not apply to it.

**3. Posting `@codex review` from a workflow — possible, but it needs a personal token.**
Intel's [ispc](https://github.com/ispc/ispc) workflow documents the constraint directly:

> it posts a comment "@codex review" **under the name of the person who has active OpenAI
> ChatGPT subscription** with Codex integration to this repo enabled. This triggers Codex
> review.

The comment must come from the subscribing account via a scoped PAT (`CODEX_TOKEN`), not
from `github-actions[bot]` with the default `GITHUB_TOKEN`. Note also that ispc
**disabled** its `pull_request_target` trigger "due to unclear security policies" and now
ships only a `workflow_dispatch` with a manual PR-number input — a fully manual button.

### If push-triggered re-review is still wanted

The viable shape is a **label gate**, not a backoff: trigger on
`pull_request_target: [synchronize]`, run only when the PR carries a `codex-review` label,
never check out the PR head, and post `@codex review` with a maintainer PAT. Opting a PR
in is the manual act; re-review on push follows automatically until the label is removed,
which bounds spend to the handful of PRs actively being worked through.

The costs are real and should be weighed before building it: a personal PAT lives in repo
secrets, every triggered comment appears under that person's name, and it reintroduces the
`pull_request_target` surface that Intel retreated from. For this repository's volume,
typing `@codex review` on the PRs that warrant it is cheaper, safer, and better targeted.

## Proposed `## Code Review Rules` section

Per OpenAI's guidance the rules are consequential, repository-specific, narrow, and
durable, and they deliberately **omit mechanical checks CI already enforces** —
prettier, lint, the `max-lines` service cap, and the `no-actions-in-effects` /
`require-hydration-guard` lint rules are all excluded because a linter already fails
those. What remains is the judgment a linter cannot make.

```markdown
## Code Review Rules

- New features: first ask whether it should exist, not whether the diff is correct.
  Check the linked issue for real demand and search closed issues for a prior "no".
- Never require a new field on a persisted model — type it optional plus a runtime
  default. Required fields break every existing install at typia hydration.
- Do not bump CURRENT_SCHEMA_VERSION. It never protects the released fleet, is
  near-irreversible, and hard-blocks lagging clients. Use a payload marker/envelope.
- Never add TODAY_TAG to task.tagIds — membership is derived from dueWithTime/dueDay.
- Multi-entity state changes belong in a meta-reducer, not an effect fan-out.
- Route "what day is this?" through DateService; pure reducers take
  startOfNextDayDiffMs as an argument so replay stays deterministic.
- Never log user content: Log.log({ id: task.id }), never Log.log(task).
- No new packages in the root dependencies or devDependencies.
- UI strings go through T/TranslateService, and only en.json is edited, except that
  adding placeholders updates every existing translation too.
- No local restyling of Angular Material or shared src/app/ui/ components
  (.mat-_, .mdc-_, button[mat-*] overrides).
- src/app/features/tasks/task/task.component.\* is a hot path rendered per task —
  flag template function calls, extra change detection, and uncleaned subscriptions.
```

`AGENTS.md` is an agent-control file under the repository's own rules, so this edit
requires explicit approval and must land as its own commit, isolated from any product
change. `CLAUDE.md` is a symlink to `AGENTS.md`, so the section reaches both agents from
a single edit — which also means it must stay useful to Claude, not only to Codex.

Nested `AGENTS.md` files are supported for path-scoped rules and are not used here; the
existing rules are repository-wide and the root file is the right home.

## Risks and open questions

| Risk                                                                                                                                      | Mitigation                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Bot noise on contributor PRs, especially drafts and dependabot                                                                            | Stage the rollout; on-demand is an acceptable end state                                                         |
| Overlap with the existing `@claude` workflow — two bots reviewing the same PR                                                             | Decide which owns PR review before Phase 3; `claude.yml` is mention-triggered, so no conflict yet               |
| Contributors read an advisory bot comment as a merge blocker                                                                              | Never make it a required check; consider a note in `CONTRIBUTING.md` if automatic is enabled                    |
| False positives on sync/op-log code, where `sync-severity-triage.md` already warns audit findings are low-precision, not low-yield        | Rules section front-loads the real invariants; treat findings as leads to verify, never as fixes to apply blind |
| Managed integration cannot run the test suite                                                                                             | Accepted — CI already gates the mechanical checks                                                               |
| External contributors can trigger `@codex review` on their own fork PRs, spending the owner's quota (observed on entgra#200, t3code#6454) | Not practical to abuse at Pro's 400–1,000 reviews / 5h against ~9 PRs/day; revisit only if it happens           |
| Fork-PR review is empirical, not documented, so it could regress without notice                                                           | Rollback is one toggle and no repository state depends on it                                                    |

**Open question:** whether automatic reviews should ever run on dependabot PRs. Current
behavior is reportedly inconsistent ([openai/codex#5669](https://github.com/openai/codex/issues/5669)).
Recommendation is no — a lockfile bump has no diff an LLM reviewer can usefully judge.

## Rollback

Toggle **Code review** off at <https://chatgpt.com/codex/settings/code-review>. It takes
effect immediately and leaves no repository state behind. Reverting the `AGENTS.md`
commit is independent and safe at any time. Because there is no workflow file, no
secret, and no dependency, this plan is fully reversible in one click.
