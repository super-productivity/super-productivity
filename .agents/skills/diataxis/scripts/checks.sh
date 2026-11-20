#!/usr/bin/env bash
set -u

export PATH="$HOME/.local/bin:$PATH"

status=0

# The tools are not npm dependencies; name what is missing instead of
# failing with "command not found" for each check.
missing=()
for tool in vale:vale markdownlint-cli2:markdownlint lychee:lychee python3:; do
  cmd="${tool%%:*}"
  readme="${tool#*:}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if [[ -n "$readme" ]]; then
      missing+=("$cmd (pinned version: docs/public/.meta/$readme/README.md)")
    else
      missing+=("$cmd")
    fi
  fi
done
if ((${#missing[@]} > 0)); then
  echo "docs:public:check needs tools that are not installed:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

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
