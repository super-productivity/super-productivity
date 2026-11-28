#!/usr/bin/env python3
"""Validate the required frontmatter on public documentation pages.

Rules:
- Every page under docs/public carries a
  frontmatter block with `title`, `type`, and `domain`.
- `type` matches the page's quadrant directory: tutorials -> tutorial,
  how-to -> how-to, reference -> reference, explanation -> explanation.
- Pages directly under docs/public use `type: index`.
- Tooling under `.meta/` is not a documentation page and is skipped.

Usage: frontmatter.py [docs_root]   (default: docs/public)
Exit: 0 clean, 1 findings.
"""

import pathlib
import sys

QUADRANT_TYPES = {
    "tutorials": "tutorial",
    "how-to": "how-to",
    "reference": "reference",
    "explanation": "explanation",
}
REQUIRED = ("title", "type", "domain")
SKIP_DIRECTORIES = {".meta"}


def parse_frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end == -1:
        return None
    fields = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields


def expected_type(rel):
    if len(rel.parts) == 1:
        return "index"
    return QUADRANT_TYPES.get(rel.parts[0], "index")


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "docs/public")
    findings = 0
    checked = 0
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        if any(part in SKIP_DIRECTORIES for part in rel.parts[:-1]):
            continue
        checked += 1
        fields = parse_frontmatter(path.read_text(encoding="utf-8"))
        if fields is None:
            print(f"{path}: missing frontmatter block")
            findings += 1
            continue
        for key in REQUIRED:
            if not fields.get(key):
                print(f"{path}: missing frontmatter key '{key}'")
                findings += 1
        want = expected_type(rel)
        if fields.get("type") and fields["type"] != want:
            print(f"{path}: type '{fields['type']}' does not match expected '{want}'")
            findings += 1
    print(f"{checked} pages checked, {findings} findings")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
