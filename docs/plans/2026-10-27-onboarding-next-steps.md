# Onboarding: next steps

## Objective

Close the "First run" gap (scorecard dimension 23: _Must not lose_, currently
_Worse_ against TickTick and Todoist, _Worse, by far_ against To Do List). Reviews
and #9225 call the app "intimidating"/"overwhelming". The goal is less overwhelm
and a faster first win, above all on phones. Teaching a productivity method is
not the goal.

## Decision: no day-planning ritual in onboarding

A "collect, then pick your top 3" flow during first run is declined:

- The gap is overwhelm, not planning. Daily planning already scores _Better_
  than TickTick (scorecard row 5).
- A new user has no tasks to collect or rank, so the flow would run on made-up
  input.
- It imposes one method ("Adapt, don't impose") and adds a permanent surface.
- No demand: no issue titles mention "plan your day", "top 3" or "most
  important". The onboarding issues (#8444, #8824) ask for presets, coordination
  and a findable tour.

An opt-in daily planning prompt is a separate feature with its own plan
(step 3).

## Current state (v19.3.0, released 2026-10-23)

- New installs start with a calm feature set (`new-install-app-features.const.ts`).
- One optional "getting started tips" example task (`example-tasks.service.ts`).
- Hint chips: create task → swipe (touch) → Today and Inbox → quick tour offer
  (`onboarding-hint.service.ts`, `onboarding-hint-steps.const.ts`).
- Quick tour on the user's own task: track time → subtask → task menu →
  organize → planner → "want more" (`quick-tour.service.ts`), re-runnable from
  Help → Quick tour.
- Both #10913 and #10957 shipped in v19.3.0. The scorecard still lists them as
  unreleased.

The upfront preset chooser that #8444 asks for and #8824 calls "genuinely good"
is gone: #10361 replaced it with the calm feature set plus a first-task tracking
offer. The rest of #8824 is addressed: the tour is offered, it can be re-run, and
the example task explains itself. Both issues are still open; #8444 gets a reply
proposing to close it (draft below).

## Steps

### 1. Baseline the first minute (phone and desktop)

Install v19.3.1 fresh on a real phone and on desktop and click through by hand
with screen recording on. Not with Playwright: the app skips onboarding and
switches every feature on under a Playwright user agent
(`startup.service.ts:414-421`, `new-install-app-features.const.ts:34-37`).

Record until the hints end, then note:

- every interruption, tap and wording problem until the first task exists;
- what the user sees once the tips and the tour are over;
- whether someone coming from Todoist or TickTick finds Import without opening
  the example task.

→ verify: a screenshot set plus a list of findings with the step, viewport and
problem. Step 2 changes only what this list shows.

#### Step 1 results (2026-10-27)

Run on master at `v19.3.1-7` (`ng serve`), not a real device: Chromium at
1280×800 with a mouse, and Pixel 5 emulation with touch. Playwright's default
user agent, so onboarding and the new-install feature set were active. No
runtime errors. Both flows reached the end without a dead end.

- Desktop: 3 tips (add task, Today and Inbox with the tour offer) and 5 tour
  steps, then the "Want more?" card. Phone: 3 tips (add, swipe, Today and
  Inbox) and 4 tour steps.
- **Swipe is taught twice on phones.** Tip 2 says "Swipe task left for more
  actions"; tour step 1 says "Swipe a task left for its menu" right after the
  user did exactly that.
- **Import is never shown.** Someone switching from Todoist or TickTick meets
  it only inside the example task's notes, and that task sits in the Inbox, out
  of view on Today. The "Want more?" card names Sync and backups but not Import.
- **The "Want more?" card is dense.** Six features and two or three tips; on a
  phone it fills the screen. It is the last thing a new user sees.
- **The empty Today says "Add more"** when there is nothing yet. The button opens
  the same composer as +, which the first tip points at.
- After the card, desktop users stay on the Planner and phone users on Today,
  with their task and nothing else on screen. Nothing needs fixing there.

Not checked: a real Android or iOS device (keyboard, back button, safe areas),
the Electron build, and slow devices.

### 2. Fix what step 1 finds, or stop

Only if step 1 lists real problems: fix each as its own small PR with an E2E or
a unit test against the hint service. If Import is hard to find, the leanest fix
is one line in the tour's "want more" step. If step 1 finds nothing worth
fixing, this step is skipped.

→ verify: the step 1 recording re-run shows the fixed item resolved, and the
onboarding E2Es pass.

### 3. Opt-in "Plan your day" (separate issue, not built here)

Open an issue describing an opt-in prompt on the first app open of a new day that
reuses Planner and Finish Day (both existing; Finish Day is off for new installs).
It needs demand (reactions from distinct users) and its own plan with a Prior art
section (Sunsama, Akiflow, TickTick "Plan your day", Todoist Today) before any code.

→ verify: issue exists and links this plan; no code lands for it in this work.

### 4. Refresh the scorecard

Move #10913 and #10957 from "Unreleased on master" to released in
`docs/market/scorecard.md`. Re-score dimension 23 only after step 2 ships.

→ verify: `rg -n '10913|10957' docs/market/scorecard.md` shows them under the
released state.

## Out of scope

- Rewording the first-run tips to teach "collect, then pick what matters". The
  Today/Inbox tip points at the first task's own Inbox chip, and that task is in
  both Today and Inbox, so "unplanned tasks wait in Inbox" is false there. With
  one task, "pick what matters most" has nothing to pick from.
- New onboarding screens, wizards, checklists, progress bars, streaks.
- Analytics or telemetry for funnel measurement (product principle).
- Changing the new-install feature set.
- Quick capture on phones: its own scorecard dimension and a larger project than
  onboarding.

## Draft reply for #8444

> The upfront feature chooser was replaced in #10361: new installs now start with
> a calm set (tasks, Planner, time tracking), and the last step of Help → Quick
> tour lists what else can be switched on under Settings. A chooser asks people
> to decide before they know the app, so we'd rather keep one calm default.
> Closing for now. If the calm default doesn't fit your workflow, please comment
> with what you had to switch on first.

## Risks

- With no analytics, step 1 is one person's view. Pair it with existing review
  quotes and #9225 rather than treating it as a measurement.
