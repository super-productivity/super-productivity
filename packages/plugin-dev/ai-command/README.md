# AI Command

An optional Super Productivity plugin: type or dictate a request ("call the
plumber tomorrow", "move these to Friday", "plan my day", "what's overdue?")
and Claude proposes changes to your tasks. You review and apply them, or turn
on "Apply without review" for small, clearly named changes.

Design and rules: [`docs/plans/2026-10-31-ai-plan-today.md`](../../../docs/plans/2026-10-31-ai-plan-today.md).

## What it sends

Only when you send a request: the request, the logical day and free time,
project and tag names, and the tasks relevant to the request (titles, days,
estimates, done state, priority, deadlines) under short aliases. Never notes,
attachments or task ids. The settings screen shows the exact JSON. Requests go
from this device straight to `api.anthropic.com` with your own API key; the key
and settings stay on this device and are never synced.

## Layout

- `src/core/`: pure logic shared by the panel and the eval (context, prompt,
  validation, auto-apply rules, apply, descriptions). Unit-tested.
- `src/ui/`: the side panel (iframe). `app.ts` is the view state machine.
- `src/plugin.ts`: runs in the app; holds the key and settings, registers the
  shortcut and tracks the current task.
- `src/eval/`, `eval/cases.json`: the Phase 0 eval.

## Commands

```bash
npm run build      # dist/: manifest.json, plugin.js, index.html (inlined), icon.svg
npm test           # core specs (node --test)
npm run typecheck
ANTHROPIC_API_KEY=... npm run eval                                  # default model
ANTHROPIC_API_KEY=... EVAL_MODELS=claude-haiku-5-5,claude-sonnet-5-5 npm run eval
```

The eval makes real, billed requests: about 16 per model, plus one retry per
unreadable answer. It reports per model how many cases matched, how many
answers were valid on the first try, and p50/p90 latency.
