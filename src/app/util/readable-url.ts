/**
 * Turn a URL into a human-readable "host: path" string for use as a task title.
 * Returns the input unchanged when it isn't a parseable URL.
 */
export const readableUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const pathPart = parsed.pathname.replace(/\/$/, '');
    if (pathPart && pathPart !== '/') {
      const decoded = decodeURIComponent(pathPart)
        .replace(/[/_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return decoded ? `${host}: ${decoded}` : host;
    }
    return host;
  } catch {
    return url;
  }
};
