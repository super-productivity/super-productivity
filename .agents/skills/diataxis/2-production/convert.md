# Production: convert

Convert handles a document that mixes quadrants.
Entered directly, it assesses its own source; tagging the mix and planning the split are its first steps; then it runs the per-target pipeline.
It answers *How does one document become quadrant-pure pages?* and produces the split set plus a conversion report.

1. **Take the baseline and tag the source.** Run [scripts/checks.sh](../scripts/checks.sh) read-only over the source; record the command, scope, exit status, and findings. Read the source completely; tag every fact or sentence `[T]` (tutorial), `[H]` (how-to), `[R]` (reference), or `[E]` (explanation). A paragraph that carries two facts is split before grouping. If a tag is contested, the compass settles it.
2. **Plan the targets.** Group tags into single-quadrant targets; check each group against existing owners and merge into the owner when one exists; name targets by the title conventions in [contracts.md](contracts.md). Record the plan before drafting:

   ```markdown
   # Conversion Work Plan: [source document]

   Audience: [who]
   Baseline: [command, scope, exit status, findings]
   Source: [path]

   | # | Source fact or passage | Quadrant | Target | Action |
   | --- | --- | --- | --- | --- |
   | 1 | [fact or lines] | Reference | [path] | Create / Update / Merge |

   Notes: [existing owners, missing neighbours, migrations underway]
   ```

3. **Extract per quadrant.** Draft each target from its tagged passages against the contract, primed the usual way. Conventional moves: the tutorial takes the guided path, checkpoints (`**You should see**`), and reliability; the how-to takes flexibility and verification; the reference takes the structured facts; the explanation takes the why, trade-offs, and links for everything procedural.
4. **Cross-link and retire the source.** Link the generated documents to each other. Then retire the source: **replace** redirects or leaves a stub pointer in the old location and deletes the old page only after redirects are live; **reduce** leaves an overview page linking the four; **archive** keeps a marked, non-authoritative page outside navigation. The migrated page takes the fact; the old page keeps a pointer until adopters switch. Do not leave a live copy beside its replacements.
5. **Report.**

```markdown
# Conversion Report: [source document]

## Content Distribution
| Quadrant | New Document | Lines from Source | Content Summary |
| --- | --- | --- | --- |

## Content Not Migrated
- [Any content dropped and why]

## Source Document Recommendation
[Replace / Reduce / Archive] — [rationale]
```

Every section of the source is accounted for: migrated, dropped with reason, or linked.
Each output passes a purity check (no mixing survives the split), and no content is duplicated across outputs.
Each output's Related block names the correct neighbour for the reader's next step.
