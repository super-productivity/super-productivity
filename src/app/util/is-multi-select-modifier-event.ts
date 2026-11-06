/**
 * True when a pointer event carries a multi-select modifier: Shift (range) or
 * Ctrl/Cmd (toggle). Click handlers that would otherwise start editing or
 * toggle a control bail out on these so the click can bubble to the task row.
 */
export const isMultiSelectModifierEvent = (ev: MouseEvent): boolean =>
  ev.shiftKey || ev.ctrlKey || ev.metaKey;
