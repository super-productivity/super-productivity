# Vale

Vale checks prose and style for public documentation.
The diataxis skill runs it as part of `npm run docs:public:check`.

## Configuration

[.vale.ini](.vale.ini) sets `StylesPath = styles`, `MinAlertLevel = suggestion`, and the `Project` and `Toolkit` vocabularies.
The styles are vendored under [styles/](styles/).
Third-party notices: [NOTICE](NOTICE).
Do not run `vale sync`: it replaces the vendored styles with upstream packages and drops local rule changes.
Update them by copying the matching directories from the [diataxis-toolkit](https://github.com/zenoprax/diataxis-toolkit).

The `docs/public/<quadrant>/` sections add the quadrant style and readability targets.
Markdown outside those sections, including these tooling pages, gets the default Vale checks only.

## Rule targets

All readability indices are suggestions.
Flesch-Kincaid grades each paragraph; SMOG and Gunning-Fog grade the page, and SMOG needs about 30 sentences to be stable.

| Quadrant    | Flesch-Kincaid | SMOG     | Gunning-Fog |
| ----------- | -------------- | -------- | ----------- |
| Tutorial    | above 11       | above 11 | above 13    |
| How-to      | above 11       | above 11 | above 13    |
| Reference   | above 11       | above 11 | above 15    |
| Explanation | above 11       | above 11 | above 15    |

`Plain.Sentence` suggests splitting a sentence above 25 words; `Plain.SentenceHard` warns above 50.
`HowTo.Title` requires an imperative verb and rejects `How to ...`, gerunds, articles, and bare noun titles such as "Deployment".
`HowTo.Opening` was removed: Ubuntu opens with the outcome, while Diátaxis also allows "This guide shows you how to ...", so no single required phrase fits both.
`Tutorial.Opening`, `Tutorial.Options`, and `Tutorial.Teaching` are suggestions; `Tutorial.Opening` accepts Ubuntu's forms such as "This tutorial will guide you" and "Let's walk through".
`Explanation.Reference` allows up to eight table rows.

Flesch-Kincaid is the paragraph prompt, SMOG the page-level vocabulary signal, and Gunning-Fog a secondary check.
Do not optimize all three at once: the result is short, choppy prose that reads less like Ubuntu.

The rules are heuristics; the Diátaxis tenets are the contract.
Where a rule and a tenet disagree, the tenet wins, and a clean Vale run is not proof that a page follows Diátaxis.

Deliberate overrides:

- `Tutorial.Steps` is off: the tutorial template uses heading steps.
- `HowTo.Steps` is off: a how-to can use lists, headings, tabs, or definition lists.
- `Tutorial.Opening` is off on tutorial index pages; `HowTo.Title` is off on how-to index pages.
- `Reference.Examples` is off: a reference page may have no code to show.
- `Explanation.Why` is off: explanations answer why through mechanism and consequence.
- `signs-of-ai-writing.Passive` is off everywhere; technical description needs passive voice when the actor is unknown.
- `signs-of-ai-writing.Transitions` is off for explanation.

## Install

CI installs Vale 3.25.1.
Install the same release into `~/.local/bin`:

```bash
tag=v3.25.1
curl -sL -o /tmp/vale.tar.gz \
  "https://github.com/vale-cli/vale/releases/download/${tag}/vale_${tag#v}_Linux_64-bit.tar.gz"
tar -xzf /tmp/vale.tar.gz -C ~/.local/bin vale
```

## Run

```bash
vale --config docs/public/.meta/vale/.vale.ini --minAlertLevel suggestion \
  --glob='!**/voice/**' docs/public
```

`npm run docs:public:vale` runs the same command.
Errors block.
Warnings and suggestions are candidates; review each against the rule before changing text.

## Vocabularies

Add project and product names to [Project](styles/config/vocabularies/Project/accept.txt) as plain words, one per line.
Do not use regular expressions in a vocabulary; they break `Vale.Terms`.
