# Tutorial template

The skeleton for learning-oriented pages: a single lesson walked step by step toward a concrete result, with a visible checkpoint after every action.
Use it when scaffolding a tutorial target in [triage.md](../1-analysis/triage.md) or drafting one in [contracts.md](../2-production/contracts.md).

Brackets mark slots to fill with your material; the whole shape is a default, not a rule: modify it to suit the adopting repository's needs.
The frontmatter block is the exception: every page carries it.

<!-- Citations: link how-to and explanation pages where appropriate; see verify.md. -->

````markdown
---
title: [Tutorial Title: What We'll Build]
type: tutorial
domain: [project-or-package]
---

# [Tutorial Title: What We'll Build]

> **Tutorial**: In this tutorial, we will [achieve X] step by step and finish
> with [concrete result].

## What we'll build

[Brief description of the end result]

## Prerequisites

- [Tool/software version]
- [Basic knowledge requirement]
- [Time estimate: X minutes]

## What we'll do

- [Milestone or action 1]
- [Milestone or action 2]
- [Milestone or action 3]

---

## Step 1: [first action — imperative verb]

[Concrete action]:

```[language]
[code or command]
```

**You should see**: [Expected output or result]
**If it fails**: [Common issue and its fix]

---

## Step 2: [next action — imperative verb]

[Continue: action, code, expected result]

```[language]
[code or command]
```

**You should see**: [Expected output or result]

---

[Continue steps until the learner has a complete result]

---

## Clean up

[Remove the resources this lesson created, if the subject requires it.]

## What we built

We built [concrete result]. [One sentence on where to go next.]

## Related

- **How-to**: [Task-specific guide] — solve the next problem
- **Reference**: [API/Config] — full details on what you used
- **Explanation**: [Concept] — why it works the way it does
````
