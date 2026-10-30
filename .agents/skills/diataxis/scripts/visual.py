#!/usr/bin/env python3
"""Check visual entities in the toolkit's markdown.

Rules:
- Table lines and fenced code block lines (including mermaid and ASCII
  diagrams) stay within 120 characters.
- Tables are space-padded: every row of a table pads each column to the same
  width, so the pipes line up when read as plain text.

Verbatim material and local scratch are excluded by default: the voice
corpus, the pattern quotes, the local workspace, and `docs/public/.meta/`.

Usage: visual.py [root]   (default: repository root)
Exit: 0 clean, 1 findings.
"""

import pathlib
import re
import sys

MAX_WIDTH = 120
EXCLUDES = (
    ".git/",
    ".agents/skills/diataxis/voice/",
    ".meta/",
    "docs/public/.meta/",
)

fence_re = re.compile(r"^\s*(```|~~~)")
table_re = re.compile(r"^\s*\|")
cell_split_re = re.compile(r"(?<!\\)\|")


def split_cells(line):
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return cell_split_re.split(stripped)


def check_table(block, findings):
    widths = {}
    for lineno, line in block:
        if len(line) > MAX_WIDTH:
            findings.append(f"{lineno}: table line is {len(line)} characters (max {MAX_WIDTH})")
        for index, cell in enumerate(split_cells(line)):
            widths.setdefault(index, set()).add(len(cell))
    for index, sizes in widths.items():
        if len(sizes) > 1:
            findings.append(
                f"{block[0][0]}: table column {index + 1} is not padded to one width {sorted(sizes)}"
            )


def check_file(path, findings):
    lines = path.read_text(encoding="utf-8").splitlines()
    in_fence = False
    table = []
    for lineno, line in enumerate(lines, start=1):
        if fence_re.match(line):
            if table:
                check_table(table, findings)
                table = []
            in_fence = not in_fence
            continue
        if in_fence:
            if len(line) > MAX_WIDTH:
                findings.append(f"{lineno}: code line is {len(line)} characters (max {MAX_WIDTH})")
            continue
        if table_re.match(line):
            table.append((lineno, line))
            continue
        if table:
            check_table(table, findings)
            table = []
    if table:
        check_table(table, findings)


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    findings = []
    checked = 0
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root).as_posix()
        if any(rel.startswith(prefix) for prefix in EXCLUDES):
            continue
        checked += 1
        before = len(findings)
        check_file(path, findings)
        if len(findings) > before:
            findings.insert(before, f"\n{path}")
    if findings:
        print("\n".join(findings))
    print(f"{checked} files checked, {len(findings)} findings")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
