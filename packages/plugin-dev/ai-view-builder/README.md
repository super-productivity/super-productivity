# AI View Builder

Bundled plugin, off by default. Users describe a view ("a kanban board by tag"),
Claude writes it as a single HTML document, and the plugin runs it against the
user's real data. User docs: [Build Views with AI](../../../docs/wiki/2.24-Build-Views-with-AI.md).

No build step: `manifest.json`, `plugin.js`, `index.html` and `icon.svg` are copied
as they are.

## How it fits together

```
app (host)
└─ plugin iframe: index.html          same-origin, filtered PluginAPI
   ├─ calls api.anthropic.com         streaming fetch, user's own key
   └─ view iframe (sandbox="allow-scripts", opaque origin, CSP: no network)
      └─ generated view, talks only to `sp` → postMessage → plugin iframe → PluginAPI
plugin.js                              holds the API key in secret storage
```

- **Key:** iframes cannot use secret storage, so `plugin.js` keeps the key
  (`setSecret`, local only) and hands it to the UI over the plugin message channel.
- **Generation:** raw HTTP from the plugin iframe. `PluginAPI.request` cannot stream
  and stops after 120 s, which a full view can exceed. The request carries only the
  prompt, the current view source and the earlier prompts, never app data.
- **Running a view:** the plugin builds the view document with a CSP meta tag and
  the `sp` runtime ahead of the generated markup, and renders it in a nested
  `sandbox="allow-scripts"` iframe. The plugin document's own `frame-src 'none'`
  stops a view from navigating its frame to an outside URL; if a view tries, the
  plugin puts it back once and shows an error.

## The `sp` contract

`AVB.VIEW_API_METHODS` in `index.html` is the whole surface a view can call; each
name maps to a handler in `viewApi`, and the system prompt documents each one
(`test/core.test.cjs` checks all three stay in step). Generated views are user
data that outlives plugin releases, so treat `sp` like a public API:

- Add methods freely. Removing or changing one breaks saved views.
- A breaking change needs a new `VIEW_API_VERSION`; views store the version they
  were built against (`apiVersion`), so the runtime can keep serving the old shape.
- Not exposed on purpose: project deletion, settings, secrets, network access,
  `executeNodeScript`, raw `dispatchAction`.

## Stored data

All under this plugin's id, synced like other plugin data:

| Key         | Content                                               | Bound                                                |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `view:<id>` | `{ id, title, html, prompts, apiVersion, updatedAt }` | one per user-created view, ≤ 200 KB, last 10 prompts |
| `data:<id>` | the view's own `sp.saveData` value                    | ≤ 100 KB per view                                    |
| `settings`  | `{ model }`                                           | fixed                                                |

Deleting a view writes empty entries, which drop out of `listSyncedDataKeys`.
Concurrent edits of the same view on two devices resolve last-writer-wins per key.

## Security notes

- The plugin iframe is same-origin with the app (see `PLUGIN_IFRAME_SANDBOX`), so
  the plugin itself is trusted code like any bundled plugin. The boundary that
  matters is the nested view iframe: opaque origin, no `allow-same-origin`, CSP
  `default-src 'none'`.
- Known gaps: the CSP does not cover WebRTC, and a view can make the host do what
  `sp` allows (for example delete tasks). The model never sees app data, which keeps
  prompt injection from task content out of the picture.
- Opaque-origin iframes did not paint on Windows desktop builds in #8467. Verified
  rendering on Linux Chromium and Linux Electron 44 over `file://`; Windows needs a
  manual check.
- On Android and iOS the request uses `CapacitorWebFetch` (the WebView's fetch)
  so it can stream; the API answers CORS for any origin. Not yet run on a device.

## Tests

```bash
npm test   # node --test: pure helpers in <script id="avb-core">
```
