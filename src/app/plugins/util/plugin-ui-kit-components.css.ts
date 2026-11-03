/**
 * UI kit classes: the patterns plugins kept rebuilding on their own (page
 * layout, action rows, callouts, list rows, chips, …), mirroring the host
 * app's equivalents so plugins look alike. Documented for plugin authors in
 * docs/plugin-development.md § UI Kit; class names are a public plugin API.
 */
export const PLUGIN_UI_KIT_COMPONENTS_CSS = `
  /* Button variants (combine with <button>) */
  .btn-primary {
    background-color: var(--c-primary);
    border-color: transparent;
    color: var(--c-contrast);
  }
  /* Filled buttons take their state layer from the label color, like Material */
  .btn-primary:hover:not(:disabled) {
    background-image: linear-gradient(
      color-mix(in srgb, currentColor 8%, transparent),
      color-mix(in srgb, currentColor 8%, transparent)
    );
  }
  .btn-primary:active:not(:disabled) {
    background-image: linear-gradient(
      color-mix(in srgb, currentColor 14%, transparent),
      color-mix(in srgb, currentColor 14%, transparent)
    );
  }
  .btn-outline {
    border-color: var(--button-primary-label);
    color: var(--button-primary-label);
  }
  .btn-text {
    border-color: transparent;
    padding: 0 var(--s);
  }
  .btn-icon {
    width: 40px;
    min-width: 40px;
    padding: 0;
    border-color: transparent;
    border-radius: 50%;
    color: var(--text-color-muted);
  }
  .btn-icon:hover:not(:disabled) { color: var(--text-color); }
  .btn-icon > svg { width: 20px; height: 20px; }
  .btn-danger { color: var(--button-warn-label); }
  .btn-outline.btn-danger { border-color: var(--button-warn-label); }
  .btn-primary.btn-danger {
    background-color: var(--c-warn);
    color: var(--c-warn-contrast);
  }

  /* Surfaces (before layout so .card.stack / .card.row keep their layout) */
  .card {
    display: block;
    padding: var(--s2);
    background: var(--card-bg);
    color: var(--text-color);
    border: 1px solid var(--extra-border-color);
    border-radius: var(--card-border-radius);
    text-align: left;
  }
  .card > :last-child { margin-bottom: 0; }
  button.card {
    width: 100%;
    min-height: 0;
    font-weight: inherit;
  }
  .card-clickable { cursor: pointer; }
  .card-clickable:hover {
    border-color: color-mix(in srgb, var(--c-primary) 50%, transparent);
    background-image: linear-gradient(var(--state-hover), var(--state-hover));
  }

  /* Layout */
  .page {
    max-width: 800px;
    margin: 0 auto;
    padding: var(--s2);
  }
  .page-header {
    display: flex;
    align-items: center;
    gap: var(--s);
    margin-bottom: var(--s2);
  }
  .page-header > :is(h1, h2, h3) { flex: 1; min-width: 0; margin: 0; }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  /* The gap owns the spacing; children's own margins would double it */
  .stack > * { margin-top: 0; margin-bottom: 0; }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
    gap: var(--s2);
  }
  .grow { flex: 1; min-width: 0; }

  /* List rows, like the app's settings rows */
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s);
    margin: 0 0 var(--s2) 0;
    padding: 0;
    list-style: none;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: 48px;
    padding: var(--s) var(--s2);
    background: var(--input-bg);
    color: var(--text-color);
    border: 1px solid var(--input-border-color);
    border-radius: var(--card-border-radius);
    text-align: left;
  }
  button.list-item { width: 100%; justify-content: flex-start; font-weight: inherit; }
  a.list-item { text-decoration: none; }
  :is(a, button).list-item:hover {
    background-image: linear-gradient(var(--state-hover), var(--state-hover));
  }

  /* Forms */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-half);
    margin-bottom: var(--s2);
  }
  .field > label { margin: 0; }
  .field-hint, .field-error { margin: 0; font-size: var(--font-size-sm); }
  .field-hint { color: var(--text-color-muted); }
  .field-error { color: var(--color-danger); }

  /* Callouts: same tones as the app's .callout */
  .callout {
    --callout-c: var(--c-primary);
    margin-bottom: var(--s2);
    padding: var(--s2);
    border: 1px solid color-mix(in srgb, var(--callout-c) 30%, transparent);
    border-radius: var(--card-border-radius);
    background: color-mix(in srgb, var(--callout-c) 10%, transparent);
  }
  .callout > :last-child { margin-bottom: 0; }
  /* Only an icon makes it a row; flex would split plain inline text apart */
  .callout:has(> svg) { display: flex; align-items: flex-start; gap: var(--s); }
  .callout > svg { flex-shrink: 0; width: 20px; height: 20px; color: var(--callout-c); }
  .callout--success { --callout-c: var(--color-success); }
  .callout--warning { --callout-c: var(--color-warning); }
  .callout--danger { --callout-c: var(--color-danger); }

  /* Chips */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-half);
    min-height: 24px;
    padding: 0 var(--s);
    border: 1px solid var(--chip-outline-color);
    border-radius: var(--radius-xs);
    color: var(--text-color);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-tight);
    white-space: nowrap;
  }

  /* Feedback states */
  .empty-state {
    padding: var(--s4) var(--s2);
    color: var(--text-color-muted);
    text-align: center;
  }
  .spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 3px solid color-mix(in srgb, var(--c-primary) 20%, transparent);
    border-top-color: var(--c-primary);
    border-radius: 50%;
    animation: sp-spin 0.8s linear infinite;
  }
  /* Inside a button the spinner sits inline with the label */
  button .spinner { width: 1em; height: 1em; border-width: 2px; }
  @keyframes sp-spin { to { transform: rotate(360deg); } }

  /* Text utilities */
  .text-muted { color: var(--text-color-muted); }
  .text-primary { color: var(--c-primary); }
  .text-danger { color: var(--color-danger); }
  .text-sm { font-size: var(--font-size-sm); }

  /* Page transition */
  /* Keyframe name predates the kit upgrade; plugins may reference it */
  .page-fade { animation: fadeIn var(--transition-duration-m) ease; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .page-fade { animation: none; }
    .spinner { animation-duration: 2s; }
  }
`;
