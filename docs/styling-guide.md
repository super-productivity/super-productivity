# Styling Guide

## Rules

- **All visual styling must use CSS variables** from `src/styles/_css-variables.scss` — never hardcode colors, spacing, shadows, transitions, or z-index.
- **Positioning/layout is fine as plain CSS** — flexbox, grid, display, position, dimensions.
- **Check `src/app/ui/` first** before creating new styled elements — 40+ reusable components exist.
- **Component SCSS should be minimal** — shared styles belong in `src/styles/components/` or as a mixin.
- **Material overlay components** (menus, dialogs, tooltips) render outside component scope — style them in `src/styles/components/` and add a comment in the component pointing there.

## Anti-Patterns

| Avoid | Do Instead |
|-------|-----------|
| Hardcoded colors (`#fff`, `red`) | CSS variables (`--text-color`, `--card-bg`, `--color-danger`) |
| Hardcoded spacing (`16px`, `1rem`) | Spacing variables (`--s2`, `--s`, `--s-half`) |
| Hardcoded shadows | Elevation variables (`--whiteframe-shadow-*dp`, `--md-sys-level*`) |
| Hardcoded transitions/durations | Transition variables (`--transition-standard`, `--transition-duration-*`) |
| Custom z-index values | Z-index variables (`--z-main-header`, `--z-backdrop`, etc.) |
| New styled elements without checking | Check `src/app/ui/` for existing reusable components first |

## Key Files

| File | Purpose |
|------|---------|
| `src/styles/_css-variables.scss` | All CSS custom properties (design tokens) |
| `src/styles/themes.scss` | Material theme setup + utility classes |
| `src/styles/page.scss` | Global page/body styles |
| `src/styles/util.scss` | Utility classes |
| `src/styles/components/` | Global component styles (Material overrides, shared patterns) |
| `src/styles/mixins/` | Reusable SCSS mixins |
| `src/app/ui/` | 40+ reusable Angular UI components |

## Spacing Variables (8px Grid)

| Variable | Value | Variable | Value |
|----------|-------|----------|-------|
| `--s-quarter` | 2px | `--s4` | 32px |
| `--s-half` | 4px | `--s5` | 40px |
| `--s` | 8px | `--s6` | 48px |
| `--s2` | 16px | `--s7` | 56px |
| `--s3` | 24px | `--s8` | 64px |

```scss
// ✅ Good
padding: var(--s2) var(--s3);
gap: var(--s-half);

// ❌ Bad
padding: 16px 24px;
gap: 4px;
```

## Color Variables

| Use case | Variables |
|----------|----------|
| Text | `--text-color`, `--text-color-muted`, `--text-color-most-intense` |
| Backgrounds | `--bg`, `--card-bg`, `--task-c-bg`, `--sub-task-c-bg` |
| Semantic | `--color-success` (#4caf50), `--color-warning` (#ff9800), `--color-danger` (#f44336) |
| Material palette | `--palette-primary-500`, `--palette-accent-500`, `--palette-warn-500` (100–900) |
| Overlays | `--c-dark-10` through `--c-dark-90`, `--c-light-05` through `--c-light-90` |
| Alpha coefficients | `--border-alpha` (0.12), `--overlay-alpha` (0.1), `--muted-alpha` (0.6), `--separator-alpha` (0.3) |

### Theme-Specific Values

Light theme sets: `--bg: #f8f8f7`, `--card-bg: #ffffff`, `--text-color: rgb(44, 44, 44)`
Dark theme sets: `--bg: #131314`, `--card-bg: var(--dark3)`, `--text-color: rgb(230, 230, 230)`

Dark elevation colors: `--dark0` (rgb(0,0,0)) through `--dark24` (rgb(56,56,56))

### Theme-Specific Overrides in Components

```scss
@include darkTheme() { /* dark-only styles */ }
@include lightTheme() { /* light-only styles */ }
```

Mixins are in `src/styles/mixins/_theming.scss`.

## Shadows & Elevation

- `--whiteframe-shadow-1dp` through `--whiteframe-shadow-24dp` — classic Material shadows
- `--md-sys-level1` through `--md-sys-level5` — Material Design 3 style

## Transitions & Animations

| Type | Variables |
|------|----------|
| Shorthands | `--transition-fast`, `--transition-standard`, `--transition-enter`, `--transition-leave` |
| Durations | `--transition-duration-xs` (90ms), `-s` (200ms), `-m` (250ms), `-l` (375ms) |
| Timing | `--ani-standard-timing`, `--ani-enter-timing`, `--ani-leave-timing`, `--ani-sharp-timing` |

## Z-Index Layers

| Variable | Value | Purpose |
|----------|-------|---------|
| `--z-check-done` | 11 | Task done checkbox |
| `--z-main-header` | 12 | Main header |
| `--z-task-title-focus` | 32 | Focused task title |
| `--z-mobile-bottom-nav` | 50 | Mobile bottom navigation |
| `--z-side-nav` | 60 | Side navigation |
| `--z-backdrop` | 222 | Backdrop overlay |
| `--z-add-task-bar` | 999 | Add task bar |
| `--z-search-bar` | 999 | Search bar |
| `--z-tour` | 1001 | Tour overlay |

## Layout Variables

| Variable | Value | Notes |
|----------|-------|-------|
| `--component-max-width` | 800px | 900–1000px on iPad |
| `--side-nav-width` | 200px | |
| `--side-nav-width-l` | 400px | |
| `--bar-height-large` | 56px | |
| `--bar-height` | 48px | |
| `--bar-height-small` | 40px | |

## Responsive Breakpoints

Available as CSS vars (`--layout-xxxs` through `--layout-xl`) and as SCSS mixins in `src/styles/mixins/_media-queries.scss`:

| Breakpoint | Value |
|------------|-------|
| `xxxs` | 398px |
| `xxs` | 450px |
| `xs` | 600px |
| `s` | 800px |
| `m` | 1000px |
| `l` | 1200px |
| `xl` | 2000px |

## Utility Classes

Defined in `src/styles/util.scss` and `src/styles/themes.scss`:

- Layout: `.center-wrapper`, `.mw` (max-width container)
- Responsive: `.hide-xs`, `.hide-xxs`, `.hide-gt-sm`
- Input: `.show-only-on-touch-primary`, `.show-only-on-mouse-primary`
- Theme: `.show-dark-only`, `.show-light-only`
- Color: `.bg-primary`, `.bgc-accent`, `.color-primary`, `.bg-success`, `.bg-warning`, `.bg-danger`
- Effects: `.milk-glass` (backdrop blur)

## Global Component Styles

Located in `src/styles/components/`, these are needed for elements that render outside component scope:

- `_overwrite-material.scss` — Material component customizations
- `_customizer-menu.scss`, `backdrop.scss`, `bottom-panel.scss`
- `markdown.scss`, `mentions.scss`, `table.scss`
- `fab-wrapper.scss`, `wrap-buttons.scss`, `multi-btn-wrapper.scss`
- `planner-shared.scss`, `formly-rows.scss`, `scrollbars.scss`
