import { isExternalUrlSchemeAllowed } from '../../../electron/shared-with-frontend/is-external-url-allowed';

/**
 * Schemeless href that is unambiguously a web host: a `www.` host, or a host
 * followed by a path/query/fragment (`example.com/path?q=1`).
 *
 * A bare `readme.md` deliberately does NOT match: `.md`, `.zip` and `.mov` are
 * registrable TLDs, so prefixing it would turn a relative file reference into a
 * one-click visit to a stranger's domain. A bare `example.com` is the same
 * string shape and is therefore left as text too — the two are indistinguishable
 * without a TLD list, and rendering plain text is the safe half of that trade.
 *
 * A `:` never starts the tail, so a scheme-shaped href (`com.acme.notes://x`,
 * `ms.msdt:1234`) and a userinfo-disguised host (`bank.com:8080@evil.com/x`)
 * both stay out of the match set.
 */
const BARE_HOST_RE =
  /^(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)*|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?=[/?#]))/i;

const _withScheme = (href: string): string => {
  if (href.startsWith('//')) {
    return `https:${href}`;
  }
  return BARE_HOST_RE.test(href) ? `http://${href}` : href;
};

/**
 * Resolve a raw link target — a markdown href or an auto-detected URL — into the
 * value to put into an anchor's `href`, or `null` when it must not be rendered
 * as a link.
 *
 * Single source of truth for both link renderers (markdown notes via
 * `markedOptionsFactory`, task titles via `renderLinks`) so the two cannot
 * drift: the same string is both validated and rendered, and an href that
 * already carries an allow-listed scheme is returned untouched — never
 * rewritten before {@link isExternalUrlSchemeAllowed} has judged it.
 *
 * Anything else (relative paths, fragments, `\\host` UNC, unknown schemes) is
 * left for the gate to reject, which is what makes the caller render it as
 * inert text. See GHSA-hr87-735w-hfq3 for why the gate exists at all.
 */
export const toRenderableHref = (raw: string): string | null => {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return null;
  }
  if (isExternalUrlSchemeAllowed(trimmed)) {
    return trimmed;
  }
  const withScheme = _withScheme(trimmed);
  return withScheme !== trimmed && isExternalUrlSchemeAllowed(withScheme)
    ? withScheme
    : null;
};
