#!/usr/bin/env bash
set -u

export PATH="$HOME/.local/bin:$PATH"

status=0

vale --config docs/public/.meta/vale/.vale.ini --minAlertLevel suggestion --glob='!**/voice/**' docs/public || status=1
markdownlint-cli2 --config docs/public/.meta/markdownlint/.markdownlint-cli2.jsonc 'docs/public/**/*.md' || status=1
python3 .agents/skills/diataxis/scripts/frontmatter.py docs/public || status=1
python3 .agents/skills/diataxis/scripts/visual.py docs/public || status=1

lychee_args=(--no-progress --config docs/public/.meta/lychee/lychee.toml)
if [[ "${DOCS_LYCHEE_OFFLINE:-0}" == "1" ]]; then
  lychee_args+=(--offline)
fi
lychee "${lychee_args[@]}" 'docs/public/**/*.md' || status=1

exit "$status"
