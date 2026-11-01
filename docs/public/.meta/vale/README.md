# Vale

Vale checks prose and style for public documentation.
The diataxis skill runs it as part of `npm run docs:public:check`.

## Configuration

[.vale.ini](.vale.ini) sets `StylesPath = styles`, `MinAlertLevel = suggestion`, and the `Project` and `Toolkit` vocabularies.
The styles are vendored under [styles/](styles/).
Third-party notices: [NOTICE](NOTICE).
Do not run `vale sync`: it replaces the vendored styles with upstream packages and drops local rule changes.
Update them by copying the matching directories from the [diataxis-toolkit](https://github.com/zenoprax/diataxis-toolkit).

The `docs/public/<quadrant>/` sections add the quadrant style and readability targets.
The `[docs/public/.meta/**/*.md]` section covers the tooling pages.

## Install

CI installs Vale 3.25.1.
Install the same release into `~/.local/bin`:

```bash
tag=v3.25.1
curl -sL -o /tmp/vale.tar.gz \
  "https://github.com/vale-cli/vale/releases/download/${tag}/vale_${tag#v}_Linux_64-bit.tar.gz"
tar -xzf /tmp/vale.tar.gz -C ~/.local/bin vale
```

## Run

```bash
vale --config docs/public/.meta/vale/.vale.ini --minAlertLevel suggestion \
  --glob='!**/voice/**' docs/public
```

`npm run docs:public:vale` runs the same command.
Errors block.
Warnings and suggestions are candidates; review each against the rule before changing text.

## Vocabularies

Add project and product names to [Project](styles/config/vocabularies/Project/accept.txt) as plain words, one per line.
Do not use regular expressions in a vocabulary; they break `Vale.Terms`.
