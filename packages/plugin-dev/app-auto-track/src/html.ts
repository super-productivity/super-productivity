const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Snack messages are rendered as HTML, and task titles can come from public issue
 * trackers: an `<img>` in a title would load a remote image without any click.
 */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
