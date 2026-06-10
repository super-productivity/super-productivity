// Vitest setup: polyfill `globalThis.DOMParser` from `@xmldom/xmldom`
// for the Node test environment. Browsers and Capacitor WebViews
// provide their own `DOMParser`, so this dep stays in
// `devDependencies` and never ships to host bundles.
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';

if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
  (globalThis as { DOMParser: unknown }).DOMParser = XmldomDOMParser;
}
