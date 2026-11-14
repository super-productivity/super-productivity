# Validation: verify

Check that written documentation is correct against its sources (the code and tests, the generated reference, the API surface), not against other documentation.
The pass checks facts only; voice is the style pass's responsibility, wherever it runs in the sequence.
It is the one pass that checks claims against sources, and it runs over the written page, never at intake.
Not to be confused with a procedure page's `## Verification` section, which is content this pass checks.

Load [method.md](../1-analysis/method.md) for the authority hierarchy.
Never run this pass concurrently with the style pass.
When the prose is being reshaped, run it first: corrections change wording, and the style pass then shapes fact-final text (see [active.md](../0-modes/active.md)).

## Steps

### 1. List the claims

Extract every factual claim from the document: settings and defaults, commands and flags, paths and file names, versions and compatibility statements, platform differences, behavior statements ("if you do X, Y happens"), and integration points.

### 2. Find the source

For each claim, locate the authoritative home and check against it.
The hierarchy:

1. **Code and tests:** behavior is what the implementation does.
2. **Generated reference:** authoritative for the API surface it covers.
3. **Canonical prose:** the document owns its facts already; another document never verifies anything.
4. **Dated notes and plans:** supporting material, never authoritative.

Two rules have no exceptions.
**A copy is not a source**: verifying claim A by reading document B is checking one transcription against another.
**Do not verify by paraphrasing**: a claim either matches the source or it does not.

### 3. Verdict the claims

Mark each claim **confirmed**, **wrong**, or **unverifiable**.
An unverifiable claim marked confirmed is worse than an open question, because the open question invites follow-up work while the false confirmation invites none.

### 4. Classify the failures

- **Documentation error:** the doc misstates correct behavior. Fix the document.
- **Code error:** the doc describes intended behavior that the code does not deliver. Report it as a code issue for the maintainers. Do not silently document the bug; recording intent does not make the code correct.
- Record which way each verdict went.

### 5. Apply and cite

- Apply the documentation fixes. Report the code issues separately.
- Citations belong to this pass, not the style pass: precision is a fact-level concern. Every verified claim the reader may want to check carries its source in the form its quadrant prescribes:

| Quadrant               | Cite with              | Pointing at                                              |
| ---------------------- | ---------------------- | -------------------------------------------------------- |
| Reference, Explanation | GitHub-style footnote  | Code (`path:Lstart-Lend`), or an already-vetted source   |
| Tutorial               | Ordinary markdown link | How-to and explanation pages, where appropriate          |
| How-to                 | Ordinary markdown link | Explanation and reference pages, as often as needed      |

- **Reference and explanation pages cite the code directly.** Put a GitHub-style footnote reference (`[^short-slug]`) at the claim and its definition at the page bottom:
  ``[^theme-validation]: `src/app/core/theme/validate-theme-css.util.ts:L51-L137` — the rejected URL forms and the size cap.``
  A line range is revision-relative: it is exact for the commit verified and drifts with later code, so cite the range as seen. One footnote per source, reused by slug; keep the definition to the path, the range, and one clause on what it decides. Prefer a file-level pointer over a range when the whole file decides. Use a vetted canonical source instead of code only where one exists and has been explicitly checked (a generated reference, the upstream API documentation itself); a restatement in another document is never a source: link it, do not cite it.
- **Tutorial and how-to pages cite their neighbours with ordinary links.** Tutorials link the how-to and explanation pages a reader needs next; how-tos link the explanation and reference pages that carry the detail, as often as needed. These links serve use, not provenance: link pages, not lines.
- A claim left uncited is an open question: record it in the pass output rather than implying its source was checked.

## Guardrails

- Do not verify by reading another document. Verify against the code, the tests, or the generated reference.
- Do not "verify" a claim by explaining rather than matching it.
- An unverified claim is allowed. An unverified claim marked confirmed is not.
- Voice stays untouched here; if a fix needs re-wording beyond the claim, hand it to the style pass rather than editing style silently.

## Reviewing the work of others

An automated review of another author's change reports; it does not re-author.

- **Cite the source.** Every factual finding cites its source (file, line) and is decided by it.
- **QC findings cite the rule.** A style finding names the checker rule or guide section it violates. Do not report a style finding without a rule.
- **Inclusion, deletion, level of detail, and prose are the author's call.** Never require a page to cover something because it "should": that is taste, not correctness. Note an omission only when it makes a stated fact misleading, and mark it an observation, not a defect.
- **No replacement prose.** Point at the source that decides; do not draft sentences for the author. Suggested edits are reserved for factual corrections whose fix is mechanical.
- **Scope is the diff.** Pre-existing text is out of scope; findings outside the diff are observations at most.
- **The author may decline anything.** A review is a report, not a QC check; only deterministic checks and factual errors bind.

## Output

- Documents with confirmed content and the quadrant's citations applied.
- A list of corrections, each with its source, and code issues separated out for a maintainer.
- The uncited claims that remain open, if any.
