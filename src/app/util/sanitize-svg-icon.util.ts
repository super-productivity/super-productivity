/**
 * Sanitizer for plugin supplied SVG icon markup.
 *
 * Every consumer hands the result to `bypassSecurityTrustHtml()`, and both sinks feed it
 * to an *HTML* parser: `MatIconRegistry` assigns it to `div.innerHTML` and
 * `PluginIconComponent` binds it to `[innerHTML]`. Angular's own HTML sanitizer cannot be
 * used here because its element allowlist contains no SVG tags at all, so it strips the
 * `<svg>` root and `mat-icon` then throws.
 *
 * Two properties keep this safe, and the second is the one carrying the weight:
 *
 * 1. The input is parsed as `text/html` rather than `image/svg+xml`. Auditing an XML tree
 *    would audit a document that never ships: `<![CDATA[..]]>` becomes a bogus comment that
 *    ends at the first `>` inside an HTML integration point, and XML type selectors are case
 *    sensitive while the HTML parser case-folds tag names back into `<foreignObject>`. Both
 *    turn a clean XML audit into live markup at the sink. `DOMParser` documents also have no
 *    browsing context, so this parse runs no scripts and loads no sub-resources. It is not
 *    quite the sinks' parse mode though: scripting is disabled here and enabled there, which
 *    the parser does observe (`<noscript>` nests differently), so this alone is not a
 *    guarantee that both sides build the same tree.
 *
 * 2. The output string is rebuilt from scratch rather than re-serialized, which is what
 *    makes the remaining differential harmless. Only allowlisted SVG elements and attributes
 *    are emitted, names are normalized to their allowlisted spelling, and every text and
 *    attribute value is entity-encoded. Nothing the parser did not already recognise as a
 *    safe SVG node can reach the string, so re-parsing the output yields the same tree again
 *    and there is no mXSS instability left for a stabilization loop to catch.
 *
 * The allowlist is deliberately limited to what draws an icon. Notably absent:
 * `script`, `style`, `foreignObject`, `title`, `desc`, `a`, the SMIL `animate`/`set` family
 * and `filter`. Also absent are `use`/`symbol` and every `href` attribute: nested `<use>`
 * expands exponentially at render time, and a 1KB icon built that way wedges the renderer
 * for tens of seconds. Dropping them takes the whole reference-attribute class with it, so
 * there is no same-document-fragment check left to get subtly wrong. Gradients still work,
 * because those are reached through `fill="url(#id)"` rather than through `href`.
 * Two more consequences worth knowing before widening it:
 *
 * - Dropping `<style>` and the `style` attribute means an icon exported from Illustrator's
 *   default "style elements" mode, or saved in Inkscape's default format, loses its paint
 *   and renders with SVG's default fill. Plugin icons should use presentation attributes.
 * - Dropping `<title>` costs the accessible name. Re-adding it is safe (see
 *   `serializeElement`), it just puts an HTML integration point back in the output for
 *   something that draws nothing, so the host component's `aria-label` is preferred.
 */

import { escapeHtml } from './escape-html';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
]);

const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  // identity / grouping. `class` is deliberately absent: `<style>` is stripped, so a class
  // can no longer style the icon and would only risk colliding with app CSS.
  'id',
  'xmlns',
  'version',
  // geometry
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'dx',
  'dy',
  'width',
  'height',
  'points',
  'transform',
  'viewbox',
  'preserveaspectratio',
  'pathlength',
  // painting
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-miterlimit',
  'opacity',
  'color',
  'display',
  'visibility',
  'paint-order',
  'shape-rendering',
  'vector-effect',
  // gradients and paint servers
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'fx',
  'fy',
  // clipping and masking
  'clip-path',
  'clip-rule',
  'mask',
  'clippathunits',
  'maskunits',
  'maskcontentunits',
  'patternunits',
  'patterncontentunits',
  'patterntransform',
  'markerwidth',
  'markerheight',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerunits',
  'orient',
  'refx',
  'refy',
  // text
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
]);

/**
 * Paint and clipping attributes may point at a paint server via `url(...)`. Anything but a
 * same-document fragment would let an icon pull in a remote resource, so it is dropped.
 */
const URL_REF = /url\(\s*(['"]?)([^'")]*)/gi;

const hasOnlyFragmentUrlRefs = (value: string): boolean => {
  for (const match of value.matchAll(URL_REF)) {
    if (!match[2].trimStart().startsWith('#')) {
      return false;
    }
  }
  return true;
};

const safeAttrValue = (attr: Attr): string | null => {
  const name = attr.name.toLowerCase();
  if (!ALLOWED_ATTRS.has(name)) {
    return null;
  }
  const value = attr.value;
  // Presentation attributes are CSS, and CSS resolves identifier escapes before deciding
  // what a token is: `\75 rl(https://evil.test/x)` is `url(...)` to the parser but not to
  // any regex looking for the literal spelling. Chrome resolves it all the way to a live
  // cross-origin fetch. Nothing an icon legitimately needs contains a backslash, so the
  // whole escape class is refused rather than decoded.
  if (value.includes('\\')) {
    return null;
  }
  return hasOnlyFragmentUrlRefs(value) ? value : null;
};

const serializeAttrs = (el: Element): string => {
  let out = '';
  for (const attr of Array.from(el.attributes)) {
    const value = safeAttrValue(attr);
    if (value !== null) {
      // Emit the lowercased name, not the parsed one. They are not always the same string:
      // `toLowerCase()` maps U+212A KELVIN SIGN onto `k`, so `stro<U+212A>e` passes the
      // allowlist while the original spelling reaches the sink as a dead attribute. Writing
      // the normalized form makes the emitted name an allowlist member by construction, so
      // it provably cannot carry a quote or an angle bracket. The HTML parser restores the
      // canonical camelCase for SVG attributes (`viewbox` reads back as `viewBox`).
      out += ` ${attr.name.toLowerCase()}="${escapeHtml(value)}"`;
    }
  }
  return out;
};

/**
 * A disallowed element takes its whole subtree with it: an icon has no reason to nest
 * drawable content inside something we refuse to render.
 *
 * The namespace test is a cheap invariant, not the defence that closes any known bypass, and
 * it is worth being precise about that. What closes the CDATA class is parsing as HTML and
 * rebuilding the output: the `<![CDATA[` becomes a comment node that this loop drops, and
 * whatever text survives is escaped. Measured against Chrome's parser, a non-SVG element can
 * only become a descendant of an `<svg>` through an HTML integration point (`foreignObject`,
 * `desc`, `title`), and HTML breakout tags such as `<div>` eject the rest of the markup out
 * of the `<svg>` altogether. So with the current allowlist this test is unreachable, and it
 * only starts doing work if an integration point is ever allowlisted AND the smuggled
 * element shares a name with an allowlisted one (an XHTML `<text>`, say). Kept because that
 * is cheaper than re-deriving the reachability argument every time the allowlist changes.
 */
const serializeElement = (el: Element): string => {
  if (el.namespaceURI !== SVG_NS || !ALLOWED_TAGS.has(el.localName)) {
    return '';
  }

  let out = `<${el.localName}${serializeAttrs(el)}>`;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += escapeHtml(node.nodeValue ?? '');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      out += serializeElement(node as Element);
    }
    // comments, CDATA sections and processing instructions are dropped
  }

  return `${out}</${el.localName}>`;
};

const SVG_CLOSE_TAG = '</svg>';

/**
 * Returns SVG markup that is safe to pass to `bypassSecurityTrustHtml()`, or `null` when
 * the input is not a single SVG root or nothing drawable survived sanitization.
 */
export const sanitizeSvgIconContent = (svgContent: string): string | null => {
  if (!svgContent?.trim()) {
    return null;
  }

  const doc = new DOMParser().parseFromString(svgContent, 'text/html');
  const root = doc.body?.firstElementChild;
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
    return null;
  }

  const serialized = serializeElement(root);
  // Rejecting outright and rendering an empty `<svg>` are not the same thing to a caller:
  // an empty icon still reads as "I have an icon", so it paints a blank box and suppresses
  // the fallback. Anything an editor wraps in something we drop (Illustrator's `<switch>`,
  // an embedded `<image>`) lands here, so report it as unusable. Attribute values and text
  // are escaped, so a `<` left in the body can only be a child element we emitted.
  const body = serialized.slice(serialized.indexOf('>') + 1, -SVG_CLOSE_TAG.length);
  return body.includes('<') ? serialized : null;
};
