---
name: super-productivity
description: >
  Agent integration entry point for Super Productivity. Points to the
  authoritative docs and source files for the Local REST API, Plugin API,
  and Sync Server — read those rather than any prose restatement here.
triggers:
  - super productivity
  - superproductivity
  - add task to super productivity
  - local rest api
  - superproductivity plugin
---

# Super Productivity — Agent Integration

Full documentation is in **[`docs/wiki/3.01-API.md`](docs/wiki/3.01-API.md)**, which covers all three integration systems and points at the authoritative source files.

## Integration systems at a glance

| System | When available | Source of truth |
|--------|---------------|-----------------|
| **Local REST API** (`127.0.0.1:3876`) | Electron desktop only | [`src/app/core/electron/local-rest-api-handler.service.ts`](src/app/core/electron/local-rest-api-handler.service.ts) |
| **Plugin API** | Web + desktop | [`packages/plugin-api/`](packages/plugin-api/) · [`docs/plugin-development.md`](docs/plugin-development.md) |
| **Sync Server API** | Self-hosted server | [`docs/wiki/3.01-API.md`](docs/wiki/3.01-API.md) |

Read the source files for accurate parameter names, response shapes, and permission identifiers. Any prose copy of these details will drift.
