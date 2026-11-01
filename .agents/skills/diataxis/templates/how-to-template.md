# How-to guide template

The skeleton for task-oriented pages: a competent reader, a named goal, directions only, forks and alternatives welcome, no teaching.
Use it when scaffolding a how-to target in [triage.md](../1-analysis/triage.md) or drafting one in [contracts.md](../2-production/contracts.md).

Brackets mark slots to fill with your material; the whole shape is a default, not a rule: modify it to suit the adopting repository's needs.
The frontmatter block is the exception: every page carries it.

<!-- Citations: link explanation and reference pages inline, as often as needed; see verify.md. -->

````markdown
---
title: How to [Solve Specific Problem/Achieve Specific Goal]
type: how-to
domain: [project-or-package]
---

# How to [Solve Specific Problem/Achieve Specific Goal]

> **How-to guide**: Shows how to [specific goal]. Use when you need to [scenario].

## When to use this guide

- [Scenario 1]
- [Scenario 2]

## Prerequisites

- [Tool/version requirement]
- [Knowledge requirement — assume competence]

---

## Steps

1. **[First major step]**

   [Instructions]:

   ```[language]
   [code or command]
   ```

   **Tip**: [Helpful advice or common variation]
   **If it fails**: [Common failure and its fix]

2. **[Second major step]**

   [Practical directions]:

   ```[language]
   [code or command]
   ```

   **Options**:
   - **Option A**: [When to use] — [how]
   - **Option B**: [When to use] — [how]

3. **[Continue as needed]**

---

## Verification

[How to verify the goal was achieved]:

```[language]
[verification command]
```

---

## Common variations

### [Alternative approach]

[When and how]:

```[language]
[alternative code]
```

---

## Related

- **Tutorial**: [Getting Started] — if you're new to [topic]
- **Reference**: [API/Config] — full details
- **Explanation**: [Understanding X] — why it works this way
````
