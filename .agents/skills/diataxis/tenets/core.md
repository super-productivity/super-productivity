# Tenets: core ideas and cross-quadrant guidance

Faithful extraction of principles stated on diataxis.fr (fetched 2026-09-17).
Sources: home (/), map (/map/), foundations (/foundations/), compass (/compass/).
Per-quadrant specs live in sibling files: [tutorial.md](tutorial.md), [how-to.md](how-to.md), [reference.md](reference.md), [explanation.md](explanation.md).

## Core ideas

- **What it is.** "Diátaxis is a way of thinking about and doing documentation."
  It "prescribes approaches to content, architecture and form that emerge from a
  systematic approach to understanding the needs of documentation users." (home)
- **Four needs, four forms.** "Diátaxis identifies four distinct needs, and four
  corresponding forms of documentation - tutorials, how-to guides, technical
  reference and explanation. It places them in a systematic relationship, and
  proposes that documentation should itself be organised around the structures of
  those needs." (home)
- **Solves three problems.** "Diátaxis solves problems related to documentation
  _content_ (what to write), _style_ (how to write it) and _architecture_ (how to
  organise it)." (home)
- **Two axes, two dimensions of craft.** A craft contains both "**action**
  (practical knowledge, knowing _how_, what we do) and **cognition**
  (theoretical knowledge, knowing _that_, what we think)"; and a
  practitioner's relationship to the craft is to be both "**acquired** ... and
  **applied**" ("at study" vs "at work"). These are "two dimensions of skill"
  on "a map of the territory of craft": the practical↔theoretical and
  learning↔working axes. (foundations)
- **Exactly four, not arbitrary.** "This is a _complete_ map. There are only two
  dimensions, and they don't just cover the entire territory, they define it.
  This is why there are necessarily four quarters to it, and there could not be
  three, or five." The four forms are "a complete enumeration of the types of
  documentation that serve practitioners in a craft... There is simply no other
  territory to cover." (foundations)
- **One job per piece of content.** "Each piece of content is of a kind that not
  only has one particular job to do, that job is also clearly distinguished from
  and contrasted with the other functions of documentation." (map)
- **Two-dimensional, not a list.** It "describes a **two-dimensional structure**,
  rather than a _list_... Each one occupies a space in the mental territory it
  outlines, and the boundaries between them highlight their distinctions." (map)
- **Expectations + guidance.** It provides both "clear _expectations_ (to the
  reader) and _guidance_ (to the author). It's clear what the purpose of any
  particular piece of content is, it specifies how it should be written and it
  shows where it should be placed." (map)
- **Docs serve the user in front of you.** "Diátaxis is based on the principle
  that documentation must serve the needs of its users." (foundations) Users
  "may enter the documentation anywhere in search of guidance on some
  particular subject, and what they want to read will change from moment to
  moment" (map); tutorials serve the user's _study_, how-to serves the
  already-competent user "in their work". (tutorials, how-to)
- **Value to maintainers.** "As well as serving the users of documentation,
  Diátaxis has value for documentation creators and maintainers. It is
  light-weight, easy to grasp and straightforward to apply. It doesn't impose
  implementation constraints. It brings an active principle of quality to
  documentation." (home)
- **Name.** From Ancient Greek δῐᾰ́τᾰξῐς: _dia_ ("across") + _taxis_
  ("arrangement"). (home)
- **The compass as decision tool.** "The Diátaxis compass is something like a
  truth-table or decision-tree of documentation. It reduces a more complex,
  two-dimensional problem to its simpler parts" (compass).

## Cross-quadrant guidance

- **The compass (decision table).**
  - informs action + acquisition of skill → tutorial
  - informs action + application of skill → how-to guide
  - informs cognition + application of skill → reference
  - informs cognition + acquisition of skill → explanation
  - "just two questions need to be asked: _action or cognition?_ _acquisition or
    application?_ And it yields the answer." Terms: action = "practical steps,
    doing"; cognition = "theoretical or propositional knowledge, thinking";
    acquisition = "study"; application = "work". Apply it "close-up, at the
    level of sentences and words, or from a wider perspective, considering an
    entire document." It is effective when you think that you are doing one
    thing but are troubled by a sense of doubt. "The compass forces you to
    stop and reconsider."
- **Journey / cycle of interaction.** "Diátaxis is intended to help documentation
  better serve users in their _cycle of interaction_ with a product." Phases:
  learning-oriented → goal-oriented → information-oriented →
  explanation-oriented ("away from the work, we reflect... to understand the
  whole"). "And then it's back to the beginning". Not a strict sequence: "It is
  not the case that a user must encounter the different kinds of documentation
  in the order tutorials > how-to guides > technical reference > explanation...
  an actual user may enter the documentation anywhere..."
- **Blur (drift).** "there is a kind of natural affinity between each of the
  different forms of documentation and its neighbours on the map, and a natural
  tendency to blur the distinctions". Affinity pairs: how-to ↔ tutorials (guide
  action); how-to ↔ reference (serve the application of skill); reference ↔
  explanation (contain propositional knowledge); tutorials ↔ explanation (serve
  the acquisition of skill). "When these distinctions are allowed to blur, the
  different kinds of documentation bleed into each other. Writing style and
  content make their way into inappropriate places. It also causes structural
  problems, which make it even more difficult to maintain the discipline of
  appropriate writing." "In the worst case there is a complete or partial
  collapse of tutorials and how-to guides into each other, making it impossible
  to meet the needs served by either."
- **Architecture infects content.** "When documentation fails to attain a good
  structure, it's rarely just a problem of structure... Architectural faults
  infect and undermine content too." Organising around product features "is
  rarely successful"; adopt "a scheme that tries to provide an answer to the
  question: how to arrange documentation _in general?_" Any "orderly attempt to
  organise documentation into clear content categories will help improve it."
- **Cross-linking instead of cross-mixing.** Reference: "Instead, link to
  how-to guides, explanation and introductory tutorials." Tutorials: for
  explanation "provide a link or reference to that explanation, so that it's
  available, but doesn't get in the way." How-to: "Refer to the x reference
  guide for a full list of options."
- **Naming as disambiguation.** "There is a sense of arbitrariness" in
  category-less lists; how-to titles must say exactly what they show; explanation
  titles take an "About" prefix.

## Tenets summary

- Docs are organized around four user needs → four forms: tutorials, how-to,
  reference, explanation.
- Four = a complete, non-arbitrary enumeration: two dimensions of craft
  (action/cognition × acquisition/application) define exactly four quarters.
- Structure is a two-dimensional map, not a list; boundaries are meaningful.
- Each piece of content has one job, distinguished from the others.
- The structure gives readers expectations and authors guidance.
- The compass reduces classification to two questions: "action or cognition?
  acquisition or application?"
- Tutorials: learning-oriented lessons; first-person plural; don't try to
  teach; minimize explanation; results early and often; perfect reliability.
- How-to: goal-oriented directions from the user's perspective; action and only
  action; conditional imperatives; "How to…" titles.
- Reference: austere, neutral description of the machinery; consulted not read;
  mirrors product structure; no instruction or opinion: link out instead.
- Explanation: understanding-oriented, discursive, "about" a topic; opinion and
  alternatives allowed; must stay bounded.
- Users move through a cycle (learn → apply → consult → reflect) but may enter
  anywhere.
- Drift/"blur": natural affinity between neighbor quadrants causes content to
  bleed; worst case is collapse of tutorials into how-to.
- Architectural faults infect content; structure around needs, not features.
- Cross-quadrant contamination is fixed by linking, not inlining.

## Surprising principles

- "The first rule of teaching is simply: don't try to teach". Suppress the
  teacher's urge to explain.
- "You are required to be present, but condemned to be absent". A tutorial
  must work for its intended reader without a teacher present.
- How-to guides are explicitly not procedures: real problems fork, overlap,
  have multiple entry/exit points.
- Reference material is "led by the product it describes", inverting the
  user-led orientation of the other quadrants.
- Explanation "is not a luxury". Without it the practitioner's craft exercise
  becomes "anxious".
- The how-to guide list itself is product marketing: it frames "what your
  product can actually do".
- "Repetition is not the best teacher - sometimes it's the only teacher".

## Extensions to the framework

Everything above is extracted from diataxis.fr.
The rest of this section does not come from diataxis.fr: it lists the process rules this toolkit adds so Diátaxis survives automated, agent-driven use.
Each extension is a deliberate decision, recorded so fidelity to the framework can be audited.

- **One fact, one authoritative home.** The framework links instead of
  mixing (cross-linking, above); the toolkit makes ownership explicit:
  copies are defects, and every fact has a single owner to update.
- **One quadrant per document, one job.** The framework states one job per
  piece of content; the toolkit makes a whole document the unit.
- **Expansion is a decision.** New pages, moves, and migrations are planned
  work; they do not belong in a corrective edit.
- **The lint checks own mechanics.** Deterministic checkers judge mechanics;
  structure and voice stay judgment calls.
- **The analysis roles.** The framework names no process roles; the toolkit
  adds triage, audit, and plan: roles that read, classify, and decide
  without editing.
- **The validation stage.** Style and verify run as a distinct stage with
  two roles, each owning its check-and-fix loop; the framework treats these as
  quality concerns, not pipeline steps.
- **Required frontmatter.** `title`, `type`, and `domain` make pages
  processable by static site generators and deterministic checks.
- **Voice tooling.** Slop, STE, and readability rules encode
  machine-writing failure modes; they are repo tooling, and an adopting
  repo's own guide outranks them.
