// Requests the plugin answers itself, instantly and without a model call.

export type LocalCommand =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'newView' }
  | { kind: 'switchView'; name: string };

const clean = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/^(please|bitte)\s+/, '')
    .trim();

export const parseLocalCommand = (input: string): LocalCommand | null => {
  const s = clean(input);
  if (/^(undo|undo that|go back|rückgängig|zurück)$/.test(s)) return { kind: 'undo' };
  if (/^(redo|redo that|wiederholen)$/.test(s)) return { kind: 'redo' };
  if (/^(new view|start over|neue ansicht)$/.test(s)) return { kind: 'newView' };
  const sw =
    /^(?:switch to|open|show|go to|wechsle zu|zeige)\s+(?:the\s+)?(.+?)(?:\s+view)?$/.exec(
      s,
    );
  if (sw) return { kind: 'switchView', name: sw[1] };
  return null;
};

/** The view whose title best matches a spoken name, or null. */
export const matchViewByName = <T extends { title: string }>(
  views: T[],
  name: string,
): T | null => {
  const wanted = name.trim().toLowerCase();
  return (
    views.find((v) => v.title.toLowerCase() === wanted) ??
    views.find((v) => v.title.toLowerCase().includes(wanted)) ??
    null
  );
};
