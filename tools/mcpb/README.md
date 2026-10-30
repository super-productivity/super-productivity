# Super Productivity extension for Claude Desktop

Claude Desktop only runs local MCP servers over stdio. This extension is a
dependency-free stdio → HTTP bridge to the assistant (MCP) endpoint of the
running Super Productivity desktop app (`http://127.0.0.1:3876/mcp`). All
permission checks happen in the app; the bridge stores nothing.

## Use

1. In Super Productivity: Settings → Misc → enable assistant access, choose
   permissions, generate an access key.
2. Download `super-productivity.mcpb` from the
   [latest release](https://github.com/super-productivity/super-productivity/releases/latest)
   (the app links to it under "Connect an assistant"), or build it:
   `node tools/mcpb/pack.js` → `dist/super-productivity.mcpb`.
3. Open the file with Claude Desktop (or drag it into Settings → Extensions)
   and paste the access key when asked.

## Release

Tag builds pack the bundle in the Linux release job and upload it to the
draft release (`.github/workflows/build.yml`). `pack.js` sets the packed
manifest's `version` to the app version and adds the app icon as `icon.png`,
so `manifest.json` here keeps a placeholder version. The asset name
`super-productivity.mcpb` is linked from the app; keep it.

Clients that support HTTP MCP servers (Claude Code, Codex, …) do not need this
bridge; see the setup snippets in the app's settings.
