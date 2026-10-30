# Generative views: research synthesis and options

Oct 30, 2026. Input to rev. 3 of the
[generative views plan](../../plans/2026-10-30-generative-views.md). Four
independent research reports sit next to this file; each claim below points to
the report with the evidence.

| Report                                                       | Question                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| [A. Generative-UI prior art](a-genui-prior-art.md)           | How A2UI, json-render, MCP Apps, Gemini, Claude etc. do it    |
| [B. View systems and demand](b-views-and-demand.md)          | What the catalog should contain; what SP users ask for        |
| [C. Native vs plugin](c-native-vs-plugin.md)                 | Can SP's own components render for a plugin, and at what cost |
| [D. Plugin ceiling and magic](d-plugin-ceiling-and-magic.md) | How good a plugin iframe can get; what makes it feel magical  |
| [E. Native spike](e-native-spike.md)                         | SP's own components rendering one spec; ops written           |

## 1. The maintainer's direction

The model does not see task data. It defines the forms and UI, and the user's
real data flows through them. It composes from a wide catalog of pre-built
components (task rows, planner days, boards, dashboard widgets), so views build
fast. A specific project or tag may play a special role. Custom HTML/JS
components can come later. Plugin preferred, because some users dislike AI in
core; the rendering question is open and must be evaluated.

## 2. Why the first attempt is not magical

The four reports converge on three causes. None of them is "the model lacks
data".

1. **The catalog is too low-level and the binding vocabulary too thin.** Six
   primitives with a basic filter cannot say overdue, deadline radar, time per
   project, a week agenda or "my Acme project" (B §0, A §1). Every mature view
   system has a few layouts but a rich binding vocabulary; no public generative
   UI system ships a domain-level catalog, which is SP's opening (A §1.2).
2. **It is slow where it could be instant.** Opus by default, the suggestion
   chips call the model although they are fixed requests, no skeleton before the
   first step (D §5). Public generative-UI systems take 20-90 s; the fastest
   reported path made the model only choose and let code bind (A §1.3-1.4).
3. **Look-alike cards read as "a web page", not SP** (C §5, D §4).

## 3. What carries over unchanged

These hold whichever way rendering goes, and match the field's consensus (A §5):

- Spec as data, merge-by-id streamed steps, undo, validate-and-repair loop.
- Data by reference, resolved on the device; specs persist through
  `persistDataSynced` (no new entity, no schema bump; C §4).
- Prompt caching, the eval harness, the E2E harness.

## 4. What the spec needs (rendering-independent)

From B §4-5 and A §5:

- **Domain components, Tier 1:** `taskList` (group + sub-group, multi-sort,
  fields, density, add-here), `board` (lanes by predicate or `laneBy`;
  Eisenhower is a 2×2 preset), `agenda` (N days with planned and scheduled
  tasks, overdue optional), `metric`, `timeBreakdown` (time per project, tag or
  day as bars), `text`, `stack`/`columns`. Tier 2: `schedule`, `nextUp`, `tabs`,
  `controls`, `heatmap`, `progress`, `counters`.
- **Binding vocabulary:** stored and derived fields (`dueBucket`,
  `deadlineBucket`, `remaining`, `ageDays`, `doneDay`), and/or/not filters,
  relative date ranges on the logical day, aggregates with a range and `per`.
- **Roles for special projects and tags:** `roles: { client: { kind: "project",
ref: "Acme" } }`. The model takes the name from the request; the device
  resolves it and pins the id; an unresolved name shows a one-tap picker. Aliases
  `@urgent`, `@important`, `@doing` map to SP's existing board tags, so generated
  boards share tags with native ones.
- **Recipes:** about 12 named views (weekly review, plan my week, Eisenhower,
  kanban, deadline radar, time by project…) applied locally in one frame; the
  model selects and parameterizes them, and composes freely only beyond them
  (A §5.2, B §4.4, D §5 rank 1). They double as eval cases.
- **Write-backs** stay single user intents: done, drop to lane, move to day, add
  with inherited predicate, track, open (B §5.5).

## 5. Rendering options

| Option                                              | Feel                                                                                        | Cost                                                        | Long-term cost                            | AI in core |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- | ---------- |
| **P. Plugin draws look-alikes** (today, improved)   | Native-looking and fast; no context menu, dialogs, shortcuts, cross-list drag or live theme | Low; the D §6 list is plugin-only                           | None outside the plugin; drift upkeep     | No         |
| **N. Plugin + generic host `showNativeView(spec)`** | Real SP components: task rows, planner cards, board panels, charts, menus, detail panel     | Medium-high: ~1.5-2.5k lines in core plus hardening (below) | A permanent public plugin API and catalog | No         |
| W. Web components into the iframe                   | Breaks: cross-realm elements, styles, CDK drag, overlays                                    | Very high, needs a new root dependency                      | Two public surfaces                       | No         |
| K. Core feature                                     | Native                                                                                      | Highest                                                     | New persisted model, AI client in core    | Yes        |

W is rejected (C §4, ~85% confident). K is deferred: N is a prerequisite for it
anyway, and AI in core is an open product decision.

**N needs host hardening before any spec renders** (C §3): a read-only mode for
`task-list` (its drops write section ops), a no-persist mode for `board-panel`
(reorders write synced ops even when ephemeral), a pure query engine extracted
from the root-singleton customizer, suppressed `addTag` side effects, and new
bridge wiring in its own file (`plugin-bridge.service.ts` is at its line cap).
Cheap to host: `board-panel`, `planner-task`, `planner-day`, `lazy-chart`,
`heatmap`, counters. Not spec-drivable without refactoring: the planner plan
view, schedule, focus main, worklog week.

**The reports disagree on one point.** C judges that P cannot reach the bar
(~80%). D judges that P reaches native appearance and speed (~85%) and that the
complaint is mostly latency and card fidelity (~60%). Both agree full
integration needs host API. This is a judgement about feel, best settled by
looking at both, not by more reading.

## 6. Risks across options

- **Latency is unmeasured** for every model on this prompt. It decides the
  default model and whether recipes plus small edits meet the 2 s target
  (A §1.4: about 100-200 output tokens per edit).
- **Demand is a bet.** No SP issue asks for AI-built views; the nearest is #7056.
  Underlying asks do exist: cross-project lists (#7353, #6717), sort and group in
  boards (#4688), saved filters (#10347), time per project (#2034, #614) (B §2).
- **Privacy is a design property, not a guarantee.** Plugins are not sandboxed
  and manifest permissions are mostly unenforced (`plugin-security.ts:264-268`);
  say so in user docs (C §4).
- **N's API is permanent.** Prove it with a second consumer
  (`yesterday-tasks-plugin` hand-draws task rows) before it ships (C §7).
- **Hot paths:** N touches `task-list` and `board-panel`; regressions in real
  drag-and-drop need E2E coverage.

## 7. Recommended next steps

Order chosen so the plugin-vs-native decision is made on evidence:

1. **Eval now** (billed; the current $200 credit expires Nov 10): latency and
   step validity per model on the existing harness. → verify: numbers per model
   and effort in the eval report.
2. **Native spike, throwaway** (1-2 days): mount a hard-coded spec (board panel,
   planner cards, a chart) natively in the work-context embed slot, next to the
   plugin rendering the same spec. → verify: side-by-side feel, a list of hidden
   dependencies found, no ops written while viewing.
3. **Decide P or N**, then write plan rev. 3 with spec v2 (§4), recipes and the
   local tier, and an ADR if N.
4. **Build spec v2 + recipes + the D §6 latency items first**: they pay off
   under either option.

## 8. Update after the spike, the eval and a review

- **Spike (E):** `board`/`board-panel`, `planner-day` and `lazy-chart` rendered
  one hard-coded spec in ~350 lines with 0 ops while viewing. A drag on an
  in-memory board panel wrote an orphan `UPD:BOARD` op unless persistence was
  switched off. Screenshots were kept local (`.tmp/`), not committed.
- **Eval (plan §2):** p50 first change 1.2-1.5 s on all three models, so latency
  is not the main cause at p50 (§2 cause 2 is refuted for p50, not for the slow
  tail). The two repeated failures were a prompt redundancy and an archive gap.
- **Adversarial review:** the side-by-side was skewed (the plugin board had no
  card fields, another scope, one component vs four), and the spike skipped
  the costly parts of N. Verdict: improve the plugin first (P-plus), keep the
  spec renderer-agnostic, decide N after a fair side-by-side. Plan rev. 3
  §6.12.

### Native (Angular) vs plugin (iframe)

| Aspect                       | Native in SP                                                           | Plugin iframe (P-plus)                           | Edge   |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ | ------ |
| Look                         | Identical by definition                                                | Close copy; drifts as SP changes                 | Native |
| Interaction                  | Context menu, detail panel, dialogs, shortcuts, multi-select, drag out | Check off, track, drag between lanes, open in SP | Native |
| SP improvements              | Inherited                                                              | Re-implemented by hand                           | Native |
| Theme, dark mode             | Live                                                                   | Copied at load                                   | Native |
| Accessibility, keyboard      | SP's own                                                               | Rebuilt; untested                                | Native |
| Cost now                     | ~1.5-2.5k lines in core plus hardening (estimate)                      | ~300-500 lines, plugin only (estimate)           | Plugin |
| Long-term cost               | Permanent plugin API; hosted inputs become a public contract           | Contained in the plugin; deletable               | Plugin |
| Op safety                    | Hidden write paths in hosted components (measured)                     | Every write is one explicit API call             | Plugin |
| Animating streamed edits     | Untested                                                               | Works (FLIP)                                     | Plugin |
| Custom HTML components later | Mixed native and iframe islands                                        | Same document                                    | Plugin |
| Archived tasks               | Not in the store; needs host work                                      | Readable through the plugin API                  | Plugin |
| Placement                    | Work-context slot or a new host surface                                | Own route or side panel                          | Plugin |
| Large lists, mobile          | Untested                                                               | Untested                                         | Open   |
| Benefit to other plugins     | Generic API others could use                                           | None                                             | Native |
| Demand needed to justify     | High (permanent API)                                                   | Low                                              | Plugin |

Native wins on daily feel; the plugin wins on cost, risk and reversibility. The
interaction row is the one the plugin cannot close; the side-by-side should
test whether it matters in use.
