/**
 * Lightweight CSS reset for plugin iframes.
 * Auto-styles basic HTML elements to match the host app theme.
 * Injected before plugin styles so plugin CSS wins by source order.
 */
export const PLUGIN_UI_KIT_CSS = `
<style id="sp-ui-kit">
  *, *::before, *::after {
    box-sizing: border-box;
  }

  body {
    font-size: 14px;
    line-height: 1.4;
    margin: 0;
  }

  h1 { font-size: 1.8em; font-weight: 700; margin: 0 0 var(--s2) 0; }
  h2 { font-size: 1.4em; font-weight: 700; margin: 0 0 var(--s2) 0; }
  h3 { font-size: 1.2em; font-weight: 700; margin: 0 0 var(--s) 0; }
  h4 { font-size: 1.05em; font-weight: 700; margin: 0 0 var(--s) 0; }
  h5 { font-size: 0.95em; font-weight: 400; margin: 0 0 var(--s) 0; }
  h6 { font-size: 0.85em; font-weight: 400; margin: 0 0 var(--s) 0; }

  p {
    margin: 0 0 var(--s2) 0;
    line-height: 1.5;
  }

  button {
    background: var(--card-bg);
    color: var(--text-color);
    border: 1px solid var(--divider-color);
    border-radius: var(--card-border-radius);
    padding: var(--s-half) var(--s2);
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    transition: var(--transition-standard);
  }

  button:hover {
    background: var(--select-hover-bg);
    border-color: var(--c-primary);
  }

  button:active {
    filter: brightness(0.92);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.btn-primary {
    background: var(--c-primary);
    border-color: var(--c-primary);
    color: #fff;
  }

  button.btn-primary:hover {
    filter: brightness(1.12);
  }

  button.btn-outline {
    background: transparent;
    border-color: var(--c-primary);
    color: var(--c-primary);
  }

  button.btn-outline:hover {
    background: var(--c-primary);
    color: #fff;
  }

  input, textarea, select {
    background: var(--bg);
    color: var(--text-color);
    border: 1px solid var(--divider-color);
    border-radius: var(--card-border-radius);
    padding: var(--s) var(--s2);
    font-family: inherit;
    font-size: inherit;
    transition: var(--transition-standard);
  }

  input:focus, textarea:focus, select:focus {
    outline: none;
    border-color: var(--c-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--c-primary) 25%, transparent);
  }

  input:disabled, textarea:disabled, select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  label {
    cursor: pointer;
  }

  a {
    color: var(--c-primary);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  ul, ol {
    padding-left: var(--s3);
    margin: 0 0 var(--s2) 0;
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th, td {
    padding: var(--s) var(--s2);
    border-bottom: 1px solid var(--divider-color);
    text-align: left;
  }

  hr {
    border: none;
    border-top: 1px solid var(--divider-color);
    margin: var(--s2) 0;
  }

  code {
    background: var(--bg-darker);
    padding: var(--s-quarter) var(--s-half);
    border-radius: 2px;
    font-size: 0.9em;
  }

  pre {
    background: var(--bg-darker);
    padding: var(--s2);
    border-radius: var(--card-border-radius);
    overflow-x: auto;
  }

  pre > code {
    background: none;
    padding: 0;
  }

  .card {
    background: var(--card-bg);
    border-radius: var(--card-border-radius);
    box-shadow: var(--whiteframe-shadow-2dp);
    padding: var(--s2);
    text-align: left;
    border: 2px solid var(--extra-border-color);
  }

  .card-clickable:hover {
    transition: transform 0.2s;
    transform: translateY(-2px);
    box-shadow: var(--whiteframe-shadow-4dp);
    border-color: var(--c-primary);
    cursor: pointer;
  }

  ::selection {
    background: color-mix(in srgb, var(--c-primary) 30%, transparent);
  }

  ::placeholder {
    color: var(--text-color-muted);
  }

  /* Utility classes */
  .text-muted { color: var(--text-color-muted); }
  .text-primary { color: var(--c-primary); }

  /* Page transition */
  .page-fade { animation: fadeIn 0.3s ease; }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
`;
