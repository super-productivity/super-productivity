/**
 * Host theme tokens copied into plugin iframes. An iframe cannot inherit the
 * host's custom properties, so every token the UI kit (plugin-ui-kit.css.ts) or
 * plugin CSS may use has to be listed here. These names are a public plugin
 * API (documented in docs/plugin-development.md): add freely, never remove.
 *
 * `--card-bg`, `--c-warn-contrast` and `--is-dark-theme` are not listed: they
 * are derived or renamed, see createPluginCssInjection().
 */
export const PLUGIN_THEME_VAR_NAMES: readonly string[] = [
  // Surfaces & text
  '--bg',
  '--bg-darker',
  '--bg-lighter',
  '--text-color',
  '--text-color-less-intense',
  '--text-color-muted',
  '--text-color-most-intense',
  '--card-shadow',
  '--card-border-radius',
  '--divider-color',
  '--extra-border-color',
  '--select-hover-bg',
  '--c-backdrop',

  // Brand & semantic colors
  '--c-primary',
  '--c-accent',
  '--c-warn',
  '--c-contrast',
  '--button-primary-label',
  '--button-warn-label',
  '--color-success',
  '--color-danger',
  '--color-warning',
  '--chip-outline-color',

  // Interaction states & focus
  '--state-hover',
  '--state-focus',
  '--state-pressed',
  '--state-selected',
  '--state-disabled-alpha',
  '--focus-ring-width',
  '--focus-ring-offset',
  '--focus-ring-color',

  // Form inputs
  '--input-bg',
  '--input-bg-hover',
  '--input-border-color',
  '--input-border-color-focus',
  '--input-border-color-invalid',
  '--input-border-radius',

  // Scrollbars
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--scrollbar-track',

  // Shadow system
  '--whiteframe-shadow-1dp',
  '--whiteframe-shadow-2dp',
  '--whiteframe-shadow-3dp',
  '--whiteframe-shadow-4dp',
  '--whiteframe-shadow-6dp',
  '--whiteframe-shadow-8dp',
  '--whiteframe-shadow-12dp',
  '--whiteframe-shadow-24dp',

  // Spacing & radius scales
  '--s',
  '--s-quarter',
  '--s-half',
  '--s2',
  '--s3',
  '--s4',
  '--radius-xs',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-pill',

  // Transition system
  '--transition-duration-xs',
  '--transition-duration-s',
  '--transition-duration-m',
  '--transition-duration-l',
  '--transition-standard',
  '--ani-standard-timing',

  // Typography
  '--font-primary-stack',
  '--font-mono-stack',
  '--font-size-xs',
  '--font-size-sm',
  '--font-size-md',
  '--font-size-lg',
  '--font-size-xl',
  '--font-size-2xl',
  '--font-size-3xl',
  '--font-weight-medium',
  '--font-weight-semibold',
  '--font-weight-bold',
  '--line-height-tight',
  '--line-height-snug',
  '--line-height-normal',
  '--letter-spacing-tighter',
  '--letter-spacing-tight',
  '--letter-spacing-normal',
  '--letter-spacing-wide',

  // Task-related variables
  '--task-first-line-min-height',
  '--task-icon-default-opacity',
  '--task-inner-padding-top-bottom',
  '--task-is-done-dim-opacity',
  '--task-border-radius',
  '--task-c-bg',
  '--task-c-selected-bg',
  '--sub-task-c-bg',
  '--sub-task-c-bg-done',
  '--task-c-bg-done',
  '--task-c-current-bg',
  '--task-c-drag-drop-bg',
  '--sub-task-c-bg-in-selected',
  '--task-shadow',
  '--task-shadow-sub-task',
  '--task-current-shadow',
  '--task-selected-shadow',
  '--task-detail-value-color',
  '--task-detail-bg',
  '--task-detail-bg-hover',
  '--task-detail-shadow',
];
