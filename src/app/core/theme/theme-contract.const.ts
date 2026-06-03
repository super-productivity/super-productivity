/**
 * Public theme contract — single source of truth for what tokens an external
 * theme is expected to declare. Consumed by `validateThemeCss` to emit
 * non-blocking warnings when a token is missing.
 *
 * Tiers:
 *   - `required`    — theme cannot render coherently without these.
 *   - `recommended` — strongly suggested; missing them produces visible drift.
 *
 * Optional tokens (`--state-*-alpha`, `--focus-ring`) are documented in
 * `docs/theming-contract.md` but are NOT enumerated here — they always
 * inherit from the base layer and never produce warnings.
 *
 * The validator's warning pass is **presence-only** in v1 — it does NOT parse
 * selectors. A theme that declares `--surface-1` only at `:root` will pass
 * even though it would be mode-inconsistent at runtime (selector-aware
 * validation is a tracked follow-up).
 */
export interface ThemeTokenSpec {
  readonly name: `--${string}`;
  readonly tier: 'required' | 'recommended';
}

export interface ThemeCssWarning {
  readonly token: string;
}

export const THEME_CONTRACT: readonly ThemeTokenSpec[] = [
  // Required — minimum viable theme.
  { name: '--surface-1', tier: 'required' },
  { name: '--surface-2', tier: 'required' },
  { name: '--ink', tier: 'required' },
  { name: '--ink-on-channel', tier: 'required' },

  // Recommended — fills out the surface ladder + ink contract + separators.
  { name: '--surface-0', tier: 'recommended' },
  { name: '--surface-3', tier: 'recommended' },
  { name: '--surface-4', tier: 'recommended' },
  { name: '--ink-strong', tier: 'recommended' },
  { name: '--ink-muted', tier: 'recommended' },
  { name: '--separator', tier: 'recommended' },
  { name: '--divider', tier: 'recommended' },
  { name: '--scrim', tier: 'recommended' },
];
