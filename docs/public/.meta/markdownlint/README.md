# markdownlint-cli2

markdownlint-cli2 checks Markdown structure for public documentation.

## Configuration

[.markdownlint-cli2.jsonc](.markdownlint-cli2.jsonc) disables `MD013` line-length enforcement because the style rules limit sentence length instead.
It also stops a front matter `title` from counting as a top-level heading for `MD025`.

## Install

CI installs markdownlint-cli2 0.24.0.
Install the same release into a user-level prefix:

```bash
npm install --global --prefix "$HOME/.local" markdownlint-cli2@0.24.0
```

## Run

```bash
markdownlint-cli2 --config docs/public/.meta/markdownlint/.markdownlint-cli2.jsonc \
  'docs/public/**/*.md'
```

`npm run docs:public:markdownlint` runs the same command.
The exit code is `0` when clean and `1` when findings exist.
Findings block.
