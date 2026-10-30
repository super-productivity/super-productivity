# Validation: style

Fix voice and mechanics in documents that already exist.
The pass assumes the content is correct and only the writing is poor: it does not fact-check, and it does not restructure, which is production's territory.
It does reshape prose at whatever scope the standard requires (a sentence, a paragraph, a page's overall shape), because conformance, not diff size, is the criterion.
The diff should read as prose editing, not as content editing: facts, links, and section order stay.

Load [SKILL.md](../SKILL.md) for mode context.
The pass runs after any production pass, passive or active.
Where the facts are being re-checked, it runs after [verify.md](verify.md), so a correction never invalidates a shaping.

## Pre-flight: collect every constraint before editing

A pass starts by gathering everything that will judge the writing.
A constraint discovered after a rewrite forces the rewrite again:

- **Checker configuration, installed or not.** Each checker carries a configuration and hard limits (line and table widths, frontmatter shape, link form, banned phrases). Read them, and any in-repo checker scripts, before editing.
- **The repo's style guide and voice pattern library.** Read the pattern library first (this toolkit's is [voice/PATTERNS.md](../voice/PATTERNS.md)), then only the quoted passage it cites. The exemplar corpus is for targeted grep, not a read-through.
- **The in-scope quadrant tenets.** A set pass loads the in-scope quadrants' tenets ([tenets/](../tenets/)); the voice pivots are what the pass enforces.
- **The patterns' structural shapes.** Start with the quadrant's patterns in [voice/PATTERNS.md](../voice/PATTERNS.md). When a pattern needs a concrete match, grep the corpus for the cited passage and copy the shape, never the content: opener, paragraph flow, list-versus-prose, table use, endings.

Only then edit.

## The mechanical QC checks

The QC checks run from [scripts/checks.sh](../scripts/checks.sh); run the script over the whole tree, not just the prose and Markdown checkers.
The adopting repo's deterministic checkers are the QC checks; implementations differ; the conventions this toolkit applies are:

- **Error-level findings block.** Fix every error; the pass is not done while one stands.
- **Configuration binds without the tool.** A checker's configuration defines its rules even before the tool is installed or wired up; apply the configured rules by hand until it runs, and run every checker the repo ships, in-repo scripts included.
- **Warnings and suggestions are candidates, not verdicts.** Review each against the intent of the rule before changing text; passive-voice and punctuation rules are the usual false-positive classes.
- **Extend the accepted vocabulary, never suppress rules.** A product name flagged by spellcheck goes in the accepted-terms list; a rule nobody agrees with is a problem for the maintainers, not for you.
- **Run the QC checks over the whole tree at the end**, not just touched files. Cross-file conventions (heading shape, list style) are what a per-file run misses. Fix what this work introduced or aggravated; report a pre-existing finding outside the touched documents instead of sweeping it into the diff.

The QC checks cover functional quality: accuracy, consistency, completeness.
Deep quality, including flow and fit, cannot be checked or measured; it stays with the author.

The patterns below extend the checkers; apply them as a read-through for anything the checkers do not catch.

## The voice contract

Machine-writing and disciplined prose both have recognizable patterns.
The pass works at two levels, and both are standard:

- **Sentence level:** hold every sentence against the patterns below.
- **Paragraph level and overall shape:** hold every paragraph, and the page as a whole, against the quadrant's patterns in [voice/PATTERNS.md](../voice/PATTERNS.md): opener shape, flow instead of bullet dumps, list-versus-prose choices, bounded claims, endings that point forward. The pivots below name what each quadrant sounds like; the patterns' quoted passages show it. Sentence-level fixes alone do not make a page sound like its quadrant.

The adopting repository may provide its own tone guide, pattern library, or exemplar corpus; that outranks this list.

### Patterns that kill machine-writing

1. **No sentences that announce the document.** "In this document, we will explore…" carries no information. State the artifact and the reader's goal instead. A tutorial's "In this tutorial, we will…" is the lesson frame, not an announcement; the banned shape is the learning promise ("you will learn…").
2. **No empty adverbs.** "Seamlessly, effortlessly, robustly, powerfully" do not describe behavior. Describe the mechanics and drop the adverbs.
3. **No hedges.** "May vary", "generally recommended", "you might consider" name nothing. Name the variable, the deciding party, or the decision rule.
4. **Lists must carry items that exist.** "Fast, secure, and intuitive" advertises. Write a list only when each item names a step, an option, or a fact of the product.
5. **No connectives substituting content.** "Furthermore, moreover, additionally, ultimately" survive deletion and are not missed.
6. **Verification is literal output, not reassurance.** "That worked!" cannot fail and therefore does not verify. Show command, then output.
7. **Endings point forward or carry information; they do not recap.** No "In summary, we covered…". Close with the next applicable rule or the deeper page.
8. **Claims stay bounded.** State the exact boundary of a behavior in the paragraph that makes the claim.
9. **Personality must carry a fact about the material.** Warm sentences commenting on the writing itself get cut.
10. **Sentence level: declarative, one idea per sentence, active voice.**

### Quadrant voice pivots

| Quadrant    | Voice                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| Tutorial    | First-person plural; visible result after each step; minimal explanation; no choices       |
| How-to      | Conditional imperatives; one action per step; observable result; no preamble, no teaching  |
| Reference   | Austere; facts in tables; type/default/behavior; no opinion, no procedure                  |
| Explanation | Discursive; alternatives compared; claims bounded as made; no procedure                    |

The compressed language rules behind each pivot (the exact phrasings each quadrant uses and forbids) are in [tutorial.md](../tenets/tutorial.md), [how-to.md](../tenets/how-to.md), [reference.md](../tenets/reference.md), and [explanation.md](../tenets/explanation.md).
Load one when a page needs its voice judged close-up, not just pattern-checked.

### Judgment rules with no linter

These live outside deterministic checkers but sit here as part of the pass:

- Most common use case first, before the rare ones.
- Headings stay sentence case; no skipped levels; one H1 per page.
- Lists: parallel structure within one list; no nested list unless the content nests.
- UI elements stay in their formatted quotes without decoration; commands stay monospaced.
- Titles belong to production ([contracts.md](../2-production/contracts.md)); style may adjust one in passing, but does not redefine the convention.

### Formatting and width

- Write prose one sentence per line; start each sentence on a new line and never split one sentence across lines.
- Keep list items, tables, code blocks, frontmatter, and quoted material in their own formats.
- Keep table, code-block, and diagram lines at 120 characters or fewer, and pad every table column to one width.
- Do not hard-wrap within a sentence; let the renderer soft-wrap long prose lines.
- The 120-character limit applies to tables, code blocks, and diagrams, not prose.
- Link reference definitions and standalone link-only lines are exempt from the width limit.

## Guardrails

- Fix violations of the above. Do not rewrite for taste; reshaping to the quadrant's pattern shape is not taste.
- Do not change facts, numbers, commands, or links during a style pass. If a fact looks wrong, note it and leave it for [verify.md](verify.md).
- Size is not the criterion; conformance is. Leave text that already matches the standard; reshape whatever does not. A pass that invents content or drifts structure is the failure, not one with a large honest diff.
- When in doubt about a suggestion, keep the original. You own the semantics; the checker owns mechanics.
- In review of others' work, style findings are advisory and must cite the rule; never demand taste changes.

## Output

- Documents that pass the QC checks: zero errors, and every reviewed warning or suggestion kept or resolved for a stated reason.
- A reviewed-but-kept list a reviewer can audit: for a set pass, every machine-writing pattern gets a verdict per document (fixed, or kept with its reason). A bare list of kept items is not a pass report.
