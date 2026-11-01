# Mobile dialog autofocus

## Problem

On phones, many dialogs open with their first text field focused. The
on-screen keyboard comes up and covers the dialog the user just opened. For
example, "Edit board" focuses the board's title field. Angular Material's
`MatDialog` defaults to `autoFocus: 'first-tabbable'`.

`main.ts` already provided `MAT_DIALOG_DEFAULT_OPTIONS = { autoFocus: false }`
when `IS_TOUCH_PRIMARY` was true at boot. That had two gaps:

- **Static detection.** Devices that `detect-it` reports as hybrid with a mouse
  as the primary input never got it, even when used by touch.
  `InputIntentService` already tracks the live input for these.
- **It replaced Material's whole default config.** `MatDialog` uses
  `MAT_DIALOG_DEFAULT_OPTIONS` _instead of_ `new MatDialogConfig()`; it does not
  merge the two. So on touch devices, dialogs lost `role="dialog"` and lost
  focus restore on close, among other defaults. The unit test reproduces both.

## Design

One default and one opt-in, both in `src/app/util/dialog-auto-focus.ts`.

- **Default.** `MAT_DIALOG_DEFAULT_OPTIONS` is `createDialogDefaultOptions()`:
  all of `MatDialogConfig`'s defaults, plus an `autoFocus` getter. `MatDialog`
  spreads the defaults into each dialog's config on open, so the getter runs at
  open time:
  - **Touch is the active input** (`isTouchActive()`): `'dialog'`. The dialog
    container gets focus. Screen readers announce the dialog, a hardware
    keyboard can Tab into it, and focus returns to the trigger on close. No text
    field is focused, so the on-screen keyboard stays down.
  - **Otherwise:** `'first-tabbable'`, the same as Material's default, so
    desktop is unchanged.
- **Opt-in.** Pass `autoFocus: DIALOG_AUTO_FOCUS_TYPING` when opening a dialog
  whose first step is typing. Any explicit `autoFocus` at the call site already
  wins over the default; the constant names the intent and is easy to grep.

Narrow screens alone do not change anything. A narrow desktop window used with
a mouse has no on-screen keyboard to avoid.

Rejected alternatives:

- **Let each dialog component declare the opt-in.** That needs either private
  container API or a second, manual focus call in each component.
- **Use a CSS-selector default.** When the selector matches nothing, focus
  stays outside the dialog, which breaks accessibility.

## Dialogs that focus a text field today (desktop, `first-tabbable`)

**Typing is the first step: opt in.**

- `DialogPromptComponent`. These prompts only ask for text: add section, add
  tag, create or rename folder, rename project or tag, new project or tag
  folder.
  - Not the Jira cookie prompt. It opens on a link, so it gains nothing.
- `DialogCreateTagComponent`: both "create tag" call sites.
- `DialogCreateProjectComponent`: all three call sites create a project.
- `DialogSimpleCounterEditSettingsComponent`: new habit only. Editing a habit
  keeps the default.
- `DialogImportFromUrlComponent`: the URL field.
- `DialogUnsplashPickerComponent`: the search field.
- Encryption password dialogs the user opens from sync settings or setup:
  `DialogEnableEncryptionComponent` and
  `DialogChangeEncryptionPasswordComponent`.
- `PlainspaceConnectDialogComponent`: the email field.

These already pass an explicit text `autoFocus` and are unchanged:

- `DialogAddNoteComponent` and `DialogFullscreenMarkdownComponent`
  (`autoFocus: 'textarea'`).
- The add-task bar is not a dialog. It focuses its own input.

**Typing is not the first step: they get the touch default.**

- `DialogBoardEditComponent`
- `DialogWorkContextSettingsComponent`
- `DialogEditTaskRepeatCfgComponent`: title prefilled.
- `DialogSimpleCounterEditSettingsComponent`: edit.
- `DialogSimpleCounterEditComponent`
- `DialogPomodoroSettingsComponent`
- `DialogFocusSessionEditComponent`
- `DialogSelectDateTimeComponent`
- `DialogIdleComponent`: prefilled task.
- `DialogTrackingReminderComponent`
- `DialogGitlabSubmitWorklogForDayComponent`
- `DialogGetAndEnterAuthCodeComponent`: the link comes first, and the dialog
  focuses the input itself after the link is tapped.
- `DialogEditIssueProviderComponent`: setups without a help section.
- Password dialogs that sync opens on its own: `DialogEnterEncryptionPasswordComponent`,
  `DialogHandleDecryptErrorComponent`, and the "encryption required"
  `DialogEnableEncryptionComponent` (all in `sync-wrapper.service.ts`). The
  user did not tap anything, so the keyboard should not pop up unasked. One
  tap on the field raises it.
- `PluginConfigDialogComponent`

**Plugin dialogs.** `PluginDialogComponent` drops its explicit
`autoFocus: true`, so plugin HTML follows the default. Desktop is unchanged,
because the default there is the same first-tabbable.

The other explicit `autoFocus: true` sites open on buttons (confirm dialogs,
finish-day). They raise no keyboard and stay as they are.

## Tests

- **Unit:** `dialog-auto-focus.spec.ts`, with a real `MatDialog`:
  - Not touch: the first field is focused.
  - Touch: the container is focused, with `role="dialog"`.
  - Touch with the opt-in: the field is focused.
  - Touch: focus returns to the trigger on close.
  - The options keep all other Material defaults.
- **E2E:** `e2e/tests/mobile/dialog-auto-focus-touch.spec.ts`, at 400×800 with
  `hasTouch` and `isMobile`:
  - "Edit board" focuses its container, not its title, and gives focus back to
    the button on close.
  - "Create project" (an opt-in) focuses its title field.

## Not covered here

Real on-screen keyboard behaviour (Android IME, iOS WKWebView) needs a device.
See `tools/android-verify/`.

Known gap, with no instance today: the `autoFocus` getter reads the
`isTouchActive` signal on every `MatDialog.open`. A dialog opened synchronously
inside an `effect()` or `computed()` would therefore track input-intent
changes and could reopen when a hybrid device switches between mouse and touch.
No effect in `src/` opens a dialog (measured 2026-11). If one ever does, read
the signal with `untracked` in the getter.
