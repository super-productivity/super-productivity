# lychee

lychee checks links in public documentation.

## Configuration

[lychee.toml](lychee.toml) sets repository exclusions and enables anchor checks with `include_fragments = "full"`.
Add noisy hosts under `exclude` instead of disabling link checking.

## Install

CI installs lychee 0.24.2.
Install the same release into `~/.local/bin`:

```bash
curl -sL -o /tmp/lychee.tar.gz \
  https://github.com/lycheeverse/lychee/releases/download/lychee-v0.24.2/lychee-x86_64-unknown-linux-gnu.tar.gz
tar -xzf /tmp/lychee.tar.gz -C /tmp
mv /tmp/lychee-x86_64-unknown-linux-gnu/lychee ~/.local/bin/lychee
```

## Run

```bash
lychee --no-progress --config docs/public/.meta/lychee/lychee.toml 'docs/public/**/*.md'
```

`npm run docs:public:lychee` runs the same command.
CI sets `DOCS_LYCHEE_OFFLINE=1`, so pull-request checks validate local links and anchors only.
Run the command without that variable to check external links.
External failures can be transient; re-run before treating one as durable.
