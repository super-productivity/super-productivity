/**
 * UI kit element defaults: bare HTML elements styled like their Angular
 * Material counterparts in the host app (values measured from the running app:
 * 40px buttons with 4px corners, filled 8px-radius inputs, 600-weight headings).
 * Only theme tokens from plugin-theme-vars.ts may be referenced.
 */
// Text-like form controls; checkboxes, radios etc. keep their native look.
const TEXT_FIELD = `:is(input:not([type='checkbox'], [type='radio'], [type='range'], [type='color'], [type='file']), textarea, select)`;

export const PLUGIN_UI_KIT_ELEMENTS_CSS = `
  *, *::before, *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-size: var(--font-size-md);
    line-height: var(--line-height-normal);
    -webkit-font-smoothing: antialiased;
  }

  :focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }

  ::selection {
    background: color-mix(in srgb, var(--c-primary) 30%, transparent);
  }

  ::placeholder {
    color: var(--text-color-muted);
    opacity: 1;
  }

  /* Typography */
  h1, h2, h3, h4, h5, h6 {
    margin: 0 0 var(--s) 0;
    color: var(--text-color-most-intense);
    font-weight: var(--font-weight-semibold);
    line-height: var(--line-height-snug);
  }
  h1 { font-size: var(--font-size-2xl); letter-spacing: var(--letter-spacing-tighter); margin-bottom: var(--s2); }
  h2 { font-size: var(--font-size-xl); letter-spacing: var(--letter-spacing-tight); }
  h3 { font-size: var(--font-size-lg); }
  h4 { font-size: var(--font-size-md); }
  h5 { font-size: var(--font-size-sm); }
  h6 { font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); }

  p { margin: 0 0 var(--s2) 0; }
  small { font-size: var(--font-size-sm); }

  a { color: var(--c-primary); text-decoration: none; }
  a:hover { text-decoration: underline; }

  ul, ol { padding-left: var(--s3); margin: 0 0 var(--s2) 0; }

  hr {
    border: none;
    border-top: 1px solid var(--divider-color);
    margin: var(--s2) 0;
  }

  blockquote {
    margin: 0 0 var(--s2) 0;
    padding-left: var(--s2);
    border-left: 3px solid var(--divider-color);
    color: var(--text-color-muted);
  }

  code, kbd, pre {
    font-family: var(--font-mono-stack);
    font-size: 0.9em;
  }
  code, kbd {
    background: var(--input-bg);
    padding: var(--s-quarter) var(--s-half);
    border-radius: var(--radius-xs);
  }
  pre {
    background: var(--input-bg);
    padding: var(--s2);
    border-radius: var(--card-border-radius);
    overflow-x: auto;
    margin: 0 0 var(--s2) 0;
  }
  pre > code { background: none; padding: 0; }

  img, svg, video { max-width: 100%; }

  table { border-collapse: collapse; width: 100%; }
  th, td {
    padding: var(--s) var(--s2);
    border-bottom: 1px solid var(--divider-color);
    text-align: left;
  }
  th {
    color: var(--text-color-muted);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  /* Buttons: default = Material stroked button */
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s);
    min-height: 40px;
    padding: 0 var(--s2);
    border: 1px solid var(--divider-color);
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-color);
    font-family: inherit;
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-medium);
    line-height: var(--line-height-normal);
    letter-spacing: var(--letter-spacing-normal);
    cursor: pointer;
    transition:
      background-color var(--transition-duration-s) ease-out,
      border-color var(--transition-duration-s) ease-out;
  }
  /* State layers are drawn as an image so they tint any background color */
  button:hover:not(:disabled) {
    background-image: linear-gradient(var(--state-hover), var(--state-hover));
  }
  button:active:not(:disabled) {
    background-image: linear-gradient(var(--state-pressed), var(--state-pressed));
  }
  /* :where keeps this below variant classes, so a pressed .btn-primary stays filled */
  button:where([aria-pressed='true']) {
    background-color: var(--state-selected);
  }
  button:disabled {
    opacity: var(--state-disabled-alpha);
    cursor: default;
  }

  /* Inputs: Material filled form field, as restyled by the host app */
  ${TEXT_FIELD} {
    width: 100%;
    min-height: 40px;
    padding: var(--s) var(--s2);
    background: var(--input-bg);
    color: var(--text-color);
    border: 1px solid var(--input-border-color);
    border-radius: var(--input-border-radius);
    font-family: inherit;
    font-size: var(--font-size-md);
    line-height: var(--line-height-normal);
    transition:
      background-color var(--transition-duration-s) ease-out,
      border-color var(--transition-duration-s) ease-out,
      box-shadow var(--transition-duration-s) ease-out;
  }
  ${TEXT_FIELD}:hover:not(:disabled) {
    background-color: var(--input-bg-hover);
  }
  ${TEXT_FIELD}:focus {
    outline: none;
    background-color: var(--input-bg-hover);
    border-color: var(--input-border-color-focus);
    box-shadow: 0 0 0 1px var(--input-border-color-focus);
  }
  ${TEXT_FIELD}:is(:user-invalid, [aria-invalid='true']) {
    border-color: var(--input-border-color-invalid);
  }
  ${TEXT_FIELD}:disabled {
    opacity: var(--state-disabled-alpha);
    cursor: default;
  }
  textarea { resize: vertical; }
  select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--s2) center;
    padding-right: var(--s4);
  }
  option { background: var(--card-bg); color: var(--text-color); }

  input[type='checkbox'], input[type='radio'] {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--c-primary);
    cursor: pointer;
  }
  input[type='range'], progress { accent-color: var(--c-primary); }
  progress { width: 100%; }

  label {
    display: block;
    margin-bottom: var(--s-half);
    color: var(--text-color-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  /* A label wrapping its checkbox/radio reads as one inline control */
  label:has(> input:is([type='checkbox'], [type='radio'])) {
    display: inline-flex;
    align-items: center;
    gap: var(--s);
    color: var(--text-color);
    font-size: var(--font-size-md);
  }

  fieldset { margin: 0 0 var(--s2) 0; padding: 0; border: none; }
  legend { padding: 0; margin-bottom: var(--s); font-weight: var(--font-weight-medium); }

  /* Native <dialog>: Material dialog surface */
  dialog {
    width: min(560px, calc(100vw - var(--s4)));
    max-height: calc(100vh - var(--s4));
    padding: var(--s3);
    border: none;
    border-radius: var(--radius-lg);
    background: var(--card-bg);
    color: var(--text-color);
    box-shadow: var(--whiteframe-shadow-24dp);
  }
  dialog::backdrop { background: var(--c-backdrop); }
`;
