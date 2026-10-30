# AI View Builder

Bundled plugin, off by default. The user says or types the view they want ("a
kanban board", "group by project", "add today's tracked time on top") and the
view rearranges while Claude answers. Design and rationale:
[generative views plan](../../../docs/plans/2026-10-30-generative-views.md).
User docs: [Build Views with AI](../../../docs/wiki/2.24-Build-Views-with-AI.md).

## How it fits together

```
plugin.js (src/background.ts)   API key in secret storage; work-context button
index.html (src/ui/*)           command bar, voice, renderer, edit loop
  └─ src/core/*                 pure: view spec, steps, queries, board rules, model loop
```

- **A view is data**: a versioned spec of components by id and named queries
  (`src/core/spec.ts`). No generated code runs. The renderer draws it with
  `textContent` and a fixed set of task actions.
- **The model only edits the spec**: tools `put_component`, `remove_component`,
  `put_query`, `remove_query`, `set_view`, `use_recipe`, `say`. Each call is
  applied when its block finishes streaming and the view animates to the new
  state (FLIP). Rejected calls go back to the model as tool errors for up to 4
  rounds. The result is saved once; Stop or an error restores the saved spec.
  A placeholder shows from submit until the first part of a new view arrives.
- **Ready-made views are recipes** (`src/core/recipes.ts`): ordinary steps, so
  the chips on an empty view apply them locally with no key and no model call,
  and the model can pick one with `use_recipe` and then adjust it.
- **Tasks change only through the user**: check, track, open, drag between
  board columns (native board panel semantics: add the column's tags, remove
  its excluded tags, set done).
- **Sent to Anthropic**: system prompt, tools, the current spec, the selected
  component id and the request. Never tasks, projects, tags or notes.

## The spec contract

Specs are synced user data that outlive plugin releases:

- The validator keeps unknown fields and component types; steps merge into
  components, so an older device never strips a newer device's fields. Unknown
  types render as a placeholder.
- Additive changes (new component types, fields, query keys) need no version
  bump. A breaking change bumps `SPEC_VERSION` with a migration; a spec from a
  newer version opens read-only.
- Concepts map onto SP's native building blocks (board panels, the work-view
  customizer) so a host-native renderer can draw the same specs later.

## Stored data

| Key         | Content                               | Bound                                           |
| ----------- | ------------------------------------- | ----------------------------------------------- |
| `view:<id>` | `{ id, spec, requests, updatedAt }`   | one per user-created view, ≤ 64 KB, 10 requests |
| `settings`  | `{ model, voiceConsent? }`            | fixed                                           |
| `embeds`    | context ids that show a view in place | one id per project or tag the user toggled      |

Undo history stays on the device.

## Host APIs it relies on

`dataChanged` and `dayChange` hooks, `getDayContext()`, `getCurrentTaskId()`,
`startTracking()`, `stopTracking()`; feature-detected, with fallbacks to the
older hooks and the calendar day.

## Voice

Push-to-talk only in the web build (Web Speech API, on-device when the browser
reports it, otherwise after a one-time notice). Elsewhere the prompt box takes
the system's dictation. A host speech service for every platform is Phase 2 of
the plan.

## Commands

```bash
npm run build      # esbuild → dist/ (index.html with the UI bundle inlined)
npm test           # node --test over src/**/*.spec.ts
npm run typecheck
ANTHROPIC_API_KEY=... npm run eval   # billed: latency and step validity per model
```

The eval (`eval/cases.json`) reports time to the first change, total time,
rejected steps and loosely checked outcomes. Pick model and effort defaults
from it; `EVAL_MODELS` and `EVAL_EFFORTS` narrow a run.
