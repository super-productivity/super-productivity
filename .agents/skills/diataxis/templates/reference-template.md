# Reference template

The skeleton for information-oriented pages: complete, exact facts arranged for consultation, not reading; syntax before tokens, options in tables, defaults in the table, no opinions.
Use it when scaffolding a reference target in [triage.md](../1-analysis/triage.md) or drafting one in [contracts.md](../2-production/contracts.md).

Brackets mark slots to fill with your material.
The whole shape is a default, not a rule: it is meant to be modified to suit the adopting repository's needs.
The frontmatter block is the exception: every page carries it.

<!-- Citations: footnote each source as `[^slug]: `path:Lstart-Lend` — what it decides` at the page bottom; see verify.md. -->

````markdown
---
title: [API/Module/Feature] Reference
type: reference
domain: [project-or-package]
---

# [API/Module/Feature] Reference

> **Reference**: Complete technical documentation for [feature/API/module].

## Overview

[Brief factual description]

**Package**: `[package.name]`
**Since version**: [version]

---

## [Function/Method Name]

[One-line description]

### Signature

```[language]
[function_signature(parameters) -> return_type]
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `param1` | `type` | Yes | — | [Description] |
| `param2` | `type` | No | `value` | [Description] |

### Returns

**Type**: `return_type`

### Raises/Throws

- **`ErrorType`**: [When raised]

### Examples

```[language]
[minimal example]
```

---

## Configuration options

### `option_name`

**Type**: `type`
**Default**: `value`
**Required**: Yes/No

[Description]

**Valid values**:
- `value1`: [Effect]
- `value2`: [Effect]

---

## Data structures

### `StructureName`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field1` | `type` | Yes | [Description] |

---

## Error codes

### `ERROR_CODE`

**Code**: `value`
**Description**: [What it means]
**Common causes**: [What causes it]

---

## Related

- **Tutorial**: [Getting Started] — practical introduction
- **How-to**: [Task] — usage examples
- **Explanation**: [Concept] — background
````
