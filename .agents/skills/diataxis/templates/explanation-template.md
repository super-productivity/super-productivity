# Explanation template

The skeleton for understanding-oriented pages: the why of one bounded topic, how it works, what it trades off, and which decisions shaped it.
Use it when scaffolding an explanation target in [triage.md](../1-analysis/triage.md) or drafting one in [contracts.md](../2-production/contracts.md).

Brackets mark slots to fill with your material; the whole shape is a default, not a rule: modify it to suit the adopting repository's needs.
The frontmatter block is the exception: every page carries it.

<!-- Citations: footnote each source as `[^slug]: `path:Lstart-Lend` — what it decides` at the page bottom; see verify.md. -->

````markdown
---
title: About [Concept/Topic]
type: explanation
domain: [project-or-package]
---

# About [Concept/Topic]

> **Explanation**: Explores [topic] — how it works, why it matters,
> and the design decisions behind it.

## Introduction

[Why understanding this matters]

---

## What is [concept]?

[Clear explanation in plain language]

[Historical context if relevant]

---

## Why [concept] matters

### Problem it solves
[Description]

### Benefits
[Discussion]

### Trade-offs
[Honest limitations]

---

## How [concept] works

### Key principles
1. **[Principle]**: [Explanation]
2. **[Principle]**: [Explanation]

### Under the hood
[Deeper mechanism]

---

## Design decisions

### Why [choice]?

**Alternatives considered**:
- [Alternative]: [Why not chosen]

**Benefits**: [Of chosen approach]
**Trade-offs**: [Accepted]

---

## Common misconceptions

### Misconception: [false belief]
**Reality**: [Correct understanding]

---

## Related

- **Tutorial**: [Getting Started] — hands-on learning
- **How-to**: [Solve Problem] — practical application
- **Reference**: [API/Config] — technical details
````
