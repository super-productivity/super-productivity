---
name: commit-messages
description: Write a commit message for this repo. Use when committing, crafting a commit message, or squashing. Enforces the Angular conventional-commit format and the test-scope rule.
---

# Commit messages

Angular conventional-commit format: `type(scope): description`.

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

**Examples:**

- `feat(tasks): add recurring task support`
- `fix(sync): handle network timeout`

**Rules:**

- Description is imperative, lower-case, no trailing period.
- **Never** `fix(test):` or `fix(e2e):` — changes to tests use the `test:` type (e.g. `test(sync): cover vector-clock pruning`).
- Scope is the touched feature/area (`tasks`, `sync`, `ui`, `plugins`, …); omit it only when the change is genuinely repo-wide.
