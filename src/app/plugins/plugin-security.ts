import { Injectable } from '@angular/core';
import { PluginManifest } from './plugin-api.model';

/**
 * Elements that may appear in the output.
 *
 * SECURITY INVARIANT: no raw-text element may ever be added here. The HTML
 * serializer emits the text of `style`, `script`, `xmp`, `iframe`, `noembed`,
 * `noframes`, `plaintext` and `noscript` UNESCAPED, so an allowlisted raw-text
 * element would let `output.innerHTML` produce markup that re-parses into new
 * elements at the sink (the mutation-XSS class). Because none of them can be
 * created, every text node in the output is entity-escaped and the sanitized
 * string re-parses to the same tree. Re-adding `title` for accessibility, or
 * `xmp`/`noembed` because they "cannot run scripts", would silently reopen it.
 */
const SAFE_HTML_ELEMENTS: ReadonlySet<string> = new Set([
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'datalist',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'meter',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'pre',
  'progress',
  'q',
  's',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'wbr',
]);

/**
 * Dropped together with their content. Unwrapping these would be safe (their
 * text ends up entity-escaped like any other), but it would render a stylesheet
 * or a script body as visible garbage inside the dialog.
 */
const DROP_WITH_CONTENT_ELEMENTS: ReadonlySet<string> = new Set([
  'base',
  'embed',
  'iframe',
  'link',
  'math',
  'meta',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
  'title',
]);

const GLOBAL_SAFE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'class',
  'dir',
  'id',
  'lang',
  'role',
  'style',
  'title',
]);

const SAFE_ATTRIBUTES_BY_ELEMENT: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'rel', 'target']),
  button: new Set(['disabled', 'name', 'type', 'value']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  del: new Set(['datetime']),
  details: new Set(['open']),
  fieldset: new Set(['disabled', 'name']),
  img: new Set(['alt', 'height', 'src', 'width']),
  ins: new Set(['datetime']),
  input: new Set([
    'accept',
    'autocomplete',
    'checked',
    'disabled',
    'max',
    'maxlength',
    'min',
    'minlength',
    'multiple',
    'name',
    'pattern',
    'placeholder',
    'readonly',
    'required',
    'step',
    'type',
    'value',
  ]),
  label: new Set(['for']),
  li: new Set(['value']),
  meter: new Set(['high', 'low', 'max', 'min', 'optimum', 'value']),
  ol: new Set(['reversed', 'start', 'type']),
  optgroup: new Set(['disabled', 'label']),
  option: new Set(['disabled', 'label', 'selected', 'value']),
  output: new Set(['for', 'name']),
  progress: new Set(['max', 'value']),
  select: new Set(['disabled', 'multiple', 'name', 'required', 'size']),
  td: new Set(['colspan', 'headers', 'rowspan']),
  textarea: new Set([
    'autocomplete',
    'cols',
    'disabled',
    'maxlength',
    'minlength',
    'name',
    'placeholder',
    'readonly',
    'required',
    'rows',
    'wrap',
  ]),
  th: new Set(['colspan', 'headers', 'rowspan', 'scope']),
  time: new Set(['datetime']),
};

const SAFE_LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
]);
const SAFE_IMAGE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
const SAFE_RASTER_DATA_URL = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i;

/**
 * Output is built here rather than in the live document: `document.createElement`
 * + `setAttribute('src', …)` starts the image load immediately, so sanitizing
 * would fetch every image before the dialog is even rendered. An inert document
 * has no browsing context, so building the tree has no side effects at all.
 */
const BUILD_DOCUMENT = document.implementation.createHTMLDocument('plugin-sanitizer');

/** Security checks and HTML sanitization for installed plugins. */
@Injectable({
  providedIn: 'root',
})
export class PluginSecurityService {
  private readonly MAX_PLUGIN_SIZE = 1024 * 1024; // 1MB - be generous

  /**
   * Analyze plugin code and return warnings for user awareness.
   * Does NOT block execution - trusts users to make informed decisions.
   */
  analyzePluginCode(
    code: string,
    manifest?: PluginManifest,
  ): { warnings: string[]; info: string[] } {
    const warnings: string[] = [];
    const info: string[] = [];

    // Size check (informational)
    if (code.length > this.MAX_PLUGIN_SIZE) {
      warnings.push(
        `Plugin is large (${Math.round(code.length / 1024)}KB). This may impact performance.`,
      );
    }

    // Look for common patterns and inform user
    if (/eval\s*\(/.test(code)) {
      info.push('Uses eval() - plugin can execute dynamic code');
    }

    if (/require\s*\(\s*['"`](fs|child_process)/.test(code)) {
      if (manifest?.permissions?.includes('nodeExecution')) {
        info.push('Uses file system or process APIs (has permission)');
      } else {
        warnings.push('Attempts to use Node.js APIs without permission - will fail');
      }
    }

    if (/fetch|XMLHttpRequest/.test(code)) {
      info.push('Makes network requests');
    }

    if (/localStorage|sessionStorage/.test(code)) {
      info.push('Uses browser storage');
    }

    return { warnings, info };
  }

  /**
   * Check if plugin requires elevated permissions.
   * Simplified to focus only on truly dangerous permissions.
   */
  hasElevatedPermissions(manifest: PluginManifest): boolean {
    return manifest.permissions?.includes('nodeExecution') || false;
  }

  /**
   * Get human-readable permission descriptions
   */
  getPermissionDescriptions(manifest: PluginManifest): string[] {
    const descriptions: string[] = [];

    if (manifest.permissions?.includes('nodeExecution')) {
      descriptions.push('🔴 Can execute system commands and access files');
    }

    if (manifest.permissions?.includes('http')) {
      const hosts = manifest.allowedHosts?.length
        ? manifest.allowedHosts.join(', ')
        : '(none declared — network disabled)';
      descriptions.push('🟡 Can make network requests to: ' + hosts);
    }

    if (manifest.iFrame) {
      descriptions.push('🟡 Displays custom user interface');
    }

    if (manifest.hooks && manifest.hooks.length > 0) {
      descriptions.push('🟢 Responds to app events: ' + manifest.hooks.join(', '));
    }

    return descriptions;
  }

  /**
   * Rebuild plugin-provided markup from an explicit allowlist before it is
   * passed to Angular as trusted HTML. Unknown elements are unwrapped so their
   * text remains visible; elements whose content can execute are dropped.
   *
   * This is NOT plugin containment: `plugin.js` runs through `new Function` in
   * this renderer realm and plugin iframes are same-origin on purpose, so a
   * hostile plugin never needed this sink. What it protects against is a
   * well-meaning plugin interpolating untrusted data (a task title, a synced
   * note, an API response) into its dialog markup.
   *
   * Hand-rolled on purpose, so please do not "simplify" it: Angular's own
   * sanitizer deletes every form control (`input`, `select`, `textarea`,
   * `button`), which bundled plugins build their dialogs from and read back by
   * id, and DOMPurify would be a new runtime dependency. See #7869.
   */
  sanitizeHtml(html: string): string {
    const sourceDocument = new DOMParser().parseFromString(html, 'text/html');
    const output = BUILD_DOCUMENT.createElement('div');

    for (const child of Array.from(sourceDocument.body.childNodes)) {
      const sanitizedChild = this._sanitizeNode(child);
      if (sanitizedChild) {
        output.appendChild(sanitizedChild);
      }
    }

    return output.innerHTML;
  }

  private _sanitizeNode(source: Node): Node | null {
    if (source.nodeType === Node.TEXT_NODE) {
      return BUILD_DOCUMENT.createTextNode(source.textContent ?? '');
    }

    if (source.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const sourceElement = source as Element;
    const tagName = sourceElement.tagName.toLowerCase();

    if (DROP_WITH_CONTENT_ELEMENTS.has(tagName)) {
      return null;
    }

    const output: Node = SAFE_HTML_ELEMENTS.has(tagName)
      ? BUILD_DOCUMENT.createElement(tagName)
      : BUILD_DOCUMENT.createDocumentFragment();

    if (output.nodeType === Node.ELEMENT_NODE) {
      this._copySafeAttributes(sourceElement, output as HTMLElement, tagName);
    }

    for (const child of Array.from(sourceElement.childNodes)) {
      const sanitizedChild = this._sanitizeNode(child);
      if (sanitizedChild) {
        output.appendChild(sanitizedChild);
      }
    }

    return output;
  }

  private _copySafeAttributes(
    source: Element,
    output: HTMLElement,
    tagName: string,
  ): void {
    for (const attribute of Array.from(source.attributes)) {
      const name = attribute.name.toLowerCase();

      if (!this._isSafeAttribute(tagName, name)) {
        continue;
      }

      if (name === 'style') {
        const style = this._sanitizeStyle(attribute.value);
        if (style) {
          output.setAttribute(name, style);
        }
        continue;
      }

      if (name === 'href' || name === 'src') {
        // Emit exactly the string that was validated. `trim()` strips more than
        // the URL parser does (U+00A0, U+FEFF, …), so emitting the raw value
        // would let a validated `https://…` resolve as a relative path instead.
        const url = attribute.value.trim();
        if (this._isSafeUrl(name, url)) {
          output.setAttribute(name, url);
        }
        continue;
      }

      if (
        name === 'target' &&
        attribute.value !== '_blank' &&
        attribute.value !== '_self'
      ) {
        continue;
      }

      output.setAttribute(name, attribute.value);
    }

    if (tagName === 'a' && output.getAttribute('target') === '_blank') {
      output.setAttribute('rel', 'noopener noreferrer');
    }
  }

  private _isSafeAttribute(tagName: string, attributeName: string): boolean {
    return (
      GLOBAL_SAFE_ATTRIBUTES.has(attributeName) ||
      attributeName.startsWith('aria-') ||
      attributeName.startsWith('data-') ||
      SAFE_ATTRIBUTES_BY_ELEMENT[tagName]?.has(attributeName) === true
    );
  }

  /**
   * Keep declarations a plugin needs for layout, drop the ones that can fetch.
   *
   * The check runs on the value the CSS parser gives BACK, never on the raw
   * attribute: CSS resolves identifier escapes while tokenizing, so `\75 rl(…)`
   * is a url() to the browser and plain text to any regex. Re-serializing
   * normalizes every spelling to a literal `url(`, which makes this check
   * escape-proof. Custom properties are dropped outright because their value is
   * an unparsed token stream (no normalization happens), so an escaped url()
   * could hide in one and only materialize when a var() reference substitutes it.
   */
  private _sanitizeStyle(value: string): string | null {
    const probe = BUILD_DOCUMENT.createElement('div');
    probe.style.cssText = value;

    // Refuse the whole attribute rather than a single declaration: dropping one
    // longhand out of a shorthand leaves the siblings behind as `initial`, and
    // no dialog layout needs url() in the first place.
    if (probe.style.cssText.includes('url(')) {
      return null;
    }

    for (const property of Array.from(probe.style)) {
      if (property.startsWith('--')) {
        probe.style.removeProperty(property);
      }
    }

    return probe.style.cssText || null;
  }

  private _isSafeUrl(attributeName: 'href' | 'src', trimmedValue: string): boolean {
    if (attributeName === 'href' && trimmedValue.startsWith('#')) {
      return true;
    }

    if (attributeName === 'src' && SAFE_RASTER_DATA_URL.test(trimmedValue)) {
      return true;
    }

    try {
      // Require an explicit scheme. A relative URL validated against an HTTPS
      // placeholder could later resolve as file:// in the packaged app.
      const protocol = new URL(trimmedValue).protocol;
      return (attributeName === 'href' ? SAFE_LINK_PROTOCOLS : SAFE_IMAGE_PROTOCOLS).has(
        protocol,
      );
    } catch {
      return false;
    }
  }
}
