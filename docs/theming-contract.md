# Theming Contract

Public contract for authoring custom themes for Super Productivity. This document is authoritative — the validator's warning pass keys off the same contract (`src/app/core/theme/theme-contract.const.ts`).

## TL;DR

Drop a CSS file with at minimum these four declarations into Settings → Theme → "Install theme…":

```css
body {
  --surface-1: #f8f8f7;
  --surface-2: #fff;
  --ink: rgb(44, 44, 44);
  --ink-on-channel: 0, 0, 0;
}
```

For a polished theme, declare the **recommended** tokens too (see table below). Themes are pure CSS — no scripts, no remote URLs, no bundled assets.

## How theming works

The CSS variable architecture has three layers:

1. **Primitives** — surface ladder (`--surface-0` through `--surface-4`), ink (`--ink`, `--ink-strong`, `--ink-muted`, `--ink-on-channel`), `--separator`, `--divider`, `--scrim`, `--bg-overlay`, `--brand`, `--focus-ring`. These are the knobs themes turn to feel different.
2. **Semantic aliases** — high-level tokens like `--bg`, `--card-bg`, `--text-color`. Most of them resolve to a primitive, so changing one primitive ripples through dozens of semantic tokens automatically.
3. **Category-B tokens** — true light/dark splits whose relationship genuinely differs between modes (e.g. `--close-btn-bg`, `--scrollbar-thumb`). Themes that want to override these must declare both light and dark values.

Every theme builds on top of the base. If your CSS doesn't declare a token, the base value applies.

## Required tokens

| Token              | What it controls                                    | Notes                                                                                                                                                             |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--surface-1`      | App background                                      | Base of the surface ladder.                                                                                                                                       |
| `--surface-2`      | Card / task / panel background                      | One step up from `--surface-1`.                                                                                                                                   |
| `--ink`            | Body text color                                     | Most text uses this directly.                                                                                                                                     |
| `--ink-on-channel` | RGB triplet (no `rgb()` wrapper) for overlay tokens | E.g. `0, 0, 0` for light, `255, 255, 255` for dark. Used as `rgba(var(--ink-on-channel), α)` to make hover/focus overlays mode-correct from a single declaration. |

## Recommended tokens

| Token          | What it controls                                                         |
| -------------- | ------------------------------------------------------------------------ |
| `--surface-0`  | Slightly darker than `--surface-1` (used for `--bg-darker` on toolbars). |
| `--surface-3`  | Elevated surface (current task, drag-drop targets).                      |
| `--surface-4`  | Highest surface (banner, mobile bottom panel).                           |
| `--ink-strong` | Maximum-contrast text (used for emphasized labels).                      |
| `--ink-muted`  | Muted text (helper labels, placeholders).                                |
| `--separator`  | Soft separator color (between rows).                                     |
| `--divider`    | Default divider color (used by Material).                                |
| `--scrim`      | Backdrop / overlay scrim color.                                          |

If any of these are missing, the validator emits a warning listing the token names and surfaces a snackbar after install. The theme still installs — the warning is informational.

## Optional tokens

| Token                    | What it controls                          | Default        |
| ------------------------ | ----------------------------------------- | -------------- |
| `--state-hover-alpha`    | Hover overlay opacity                     | `0.06`         |
| `--state-focus-alpha`    | Focus overlay opacity                     | `0.10`         |
| `--state-pressed-alpha`  | Active/pressed overlay opacity            | `0.14`         |
| `--state-selected-alpha` | Selected-row overlay opacity              | `0.10`         |
| `--state-disabled-alpha` | Disabled element opacity                  | `0.40`         |
| `--focus-ring`           | Focus-ring color (defaults to `--brand`). | `var(--brand)` |
| `--system-surface`       | Native Android system-bar backdrop.       | `var(--bg)`    |

These are **alpha scalars** (or single colors), not rgba colors. The base composes them with `--ink-on-channel` to produce the actual overlay color, so a theme tuning `--state-hover-alpha` to `0.10` automatically gets a stronger hover in both light and dark modes.

`--system-surface` must resolve to an opaque `#rgb`, `#rrggbb`, or integer-channel `rgb(...)` color without alpha. Transparent values, percentage channels, and gradients fall back to the Default-theme surface because Android's native color parser cannot use them.

## Special tokens

### `--ink-on-channel`

This is the keystone primitive. It's an **RGB triplet** — not an `rgb()` value, not a hex literal — so it can be slotted into `rgba(var(--ink-on-channel), 0.06)` to produce mode-correct overlays from a single declaration.

```css
body {
  --ink-on-channel: 0, 0, 0; /* light mode → black overlays */
}
body.isDarkTheme {
  --ink-on-channel: 255, 255, 255; /* dark mode → white overlays */
}
```

### `--state-*-alpha` and the legacy bridge

Older themes historically declared `--hover-bg-opacity`, `--focus-bg-opacity`, `--pressed-bg-opacity`, and `--disabled-opacity` directly. The base declares the canonical names with those legacy names as `var()` fallbacks:

```css
:where(body, body.isDarkTheme) {
  --state-hover-alpha: var(--hover-bg-opacity, 0.06);
  --state-focus-alpha: var(--focus-bg-opacity, 0.1);
  --state-pressed-alpha: var(--pressed-bg-opacity, 0.14);
  --state-selected-alpha: var(--selected-bg-opacity, 0.1);
  --state-disabled-alpha: var(--disabled-opacity, 0.4);
}
```

If your theme already uses the legacy names, they continue to work — you do not need to rename. New themes should prefer the `--state-*-alpha` names.

## Selector contract

This part is load-bearing. Read it before debugging "my theme works in light mode but not dark."

| Layer                                               | Where it lives                            | Specificity                                          |
| --------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| Primitives (e.g. `--surface-1`, `--ink-on-channel`) | `body` (light), `body.isDarkTheme` (dark) | (0,0,1) and (0,1,1)                                  |
| Semantic aliases (e.g. `--bg`, `--card-bg`)         | `:where(body, body.isDarkTheme)`          | (0,0,0) — `:where()` is the zero-specificity wrapper |
| Category-B tokens (per-mode)                        | `body` (light), `body.isDarkTheme` (dark) | (0,0,1) and (0,1,1)                                  |

**Themes overriding primitives MUST use `body` and/or `body.isDarkTheme` selectors.** A declaration at `:root` is inherited by `body`, but the base declares the same property directly on `body`. A direct declaration always wins over an inherited value; selector specificity is never compared across those two elements. A `:root`-only primitive therefore has no effect on the body in either mode.

Always declare light primitives under `body` and dark primitives under `body.isDarkTheme`.

**Themes overriding semantic aliases** should use the same body selectors. Aliases live at `:where(...)` (specificity 0,0,0), so a later `body` or `body.isDarkTheme` rule wins normally. A `:root` alias remains inherited and cannot replace an alias declared directly on the body.

The validator's warning pass is **presence-only** in v1: it does not parse selectors. A theme that declares `--surface-1` only at `:root` will pass validation even though that declaration is ineffective on the body. Selector-aware warnings are a tracked follow-up.

## Forking instructions

1. Pick the closest shipped theme as a starting point: `src/assets/themes/{arc,catppuccin-mocha,cybr,dark-base,dracula,everforest,glass,lines,liquid-glass,nord-polar-night,nord-snow-storm,plainspace,rainbow,velvet,zen}.css`.
2. Copy it to a new file. Rename `.css` to whatever you want — the picker uses the filename slug as the theme id.
3. Edit the primitive declarations under `body` and `body.isDarkTheme`. Start with `--surface-1`, `--surface-2`, `--ink`, `--ink-on-channel`. Leave everything else default.
4. Drop the file into Settings → Theme → "Install theme…". The file lives in IndexedDB; nothing leaves your machine.

## Examples

### Minimal six-line theme

```css
body {
  --surface-1: #fef9f3;
  --surface-2: #ffffff;
  --ink: #2c1810;
  --ink-on-channel: 44, 24, 16;
}
```

### Tuning state alphas

```css
body {
  --surface-1: #f8f8f7;
  --surface-2: #fff;
  --ink: rgb(44, 44, 44);
  --ink-on-channel: 0, 0, 0;
  /* Subtler hover, more dramatic pressed */
  --state-hover-alpha: 0.04;
  --state-pressed-alpha: 0.18;
}
```

### Light + dark pair

```css
body {
  --surface-1: #fef9f3;
  --surface-2: #fff;
  --ink: #2c1810;
  --ink-on-channel: 0, 0, 0;
  --separator: #e0d6c8;
  --divider: rgba(0, 0, 0, 0.12);
}
body.isDarkTheme {
  --surface-1: #1a1410;
  --surface-2: #2c1810;
  --ink: rgb(245, 230, 215);
  --ink-on-channel: 255, 255, 255;
  --separator: rgba(255, 255, 255, 0.1);
  --divider: rgba(255, 255, 255, 0.12);
}
```

## Validation rules

The validator (`src/app/core/theme/validate-theme-css.util.ts`) runs at install time. Warnings are persisted alongside the theme in IndexedDB so the picker can display them without another read. Stored CSS is also re-validated before every load; a theme accepted by an older client therefore cannot bypass newer safety rules. Contract warnings remain the snapshot from installation until the user re-uploads the file.

**Hard rejects (theme will not install):**

- `url(...)` arguments that resolve to a remote URL (`http:`, `https:`, `//host/...`, `data:` URIs, schemeless absolute, or any other protocol)
- Relative `url(...)` paths (no bundled assets in v1)
- `src(...)` arguments (CSS Fonts L4 form) — same rules as `url(...)`
- Any `@import` rule
- Advanced image functions: any `image(...)` or `image-set(...)`
- Files larger than 500 KB
- Unterminated `/* comments` (malformed CSS)

**Soft warnings (theme installs, snackbar shown):**

- Any required or recommended token missing — the snackbar lists token names. Optional tokens are not warned about (they always inherit from the base layer).

The validator handles `\xx`-escape attempts on keywords (`u\72l(`, `\55RL(`, `s\72\63(`, `--surf\61ce-1`, etc.) and `/* */` injection inside string literals or `url-tokens` — see `validate-theme-css.util.spec.ts` for the full attack-surface test list.

Security keywords are matched conservatively. `url(` and `src(` are scanned on the raw (decoded) source, so they are rejected even inside a comment or CSS string — a disguised token must never be able to hide a later live fetch. The keyword-presence bans (`@import`, `image(`, `image-set(`) are scanned on the comment-stripped source instead: they are **allowed inside comments** (a theme may document the restriction) but still rejected inside CSS string values, since blanking strings safely is not possible after escape decoding. Avoid these literal sequences in theme string values and generated labels.

## Legacy migration note

If you already have a theme that worked before the token-model refactor, nothing is required. The validator's warning pass is non-blocking, and the 15 built-in CSS themes provide examples that satisfy the minimum contract. If your theme used the legacy names (`--hover-bg-opacity`, `--focus-bg-opacity`, `--pressed-bg-opacity`, `--disabled-opacity`), they continue to work through the `var()` fallback bridge in the base.

If you want the contract warnings to be quiet, declare the four required tokens (`--surface-1`, `--surface-2`, `--ink`, `--ink-on-channel`) under `body` (and `body.isDarkTheme` if your theme has a dark mode). The recommended tokens are nice-to-have but not required.
