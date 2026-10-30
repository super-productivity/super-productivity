# Scripts

[checks.sh](checks.sh) runs the deterministic QC checks from the repository root:

```bash
bash .agents/skills/diataxis/scripts/checks.sh
```

It runs Vale, markdownlint, the two page checks, and lychee, and exits with a nonzero status if any check fails.
Set `DOCS_LYCHEE_OFFLINE=1` to check local links only, as CI does.
Edit the command list in the script to change the QC checks.

## Page checks

[frontmatter.py](frontmatter.py): every page under `docs/public/` carries `title`, `type`, and `domain`.
`type` matches the page's quadrant directory.
[visual.py](visual.py): tables are space-padded, and table, code, and diagram lines stay within 120 characters.
Verbatim material, the voice corpus, and local scratch are excluded.
The page checks skip `docs/public/.meta/`, which holds tooling rather than pages.
