import { sanitizeSvgIconContent } from './sanitize-svg-icon.util';

/**
 * The sanitizer output is only ever consumed by an HTML parser:
 * `MatIconRegistry._svgElementFromString()` assigns it to `div.innerHTML` and
 * `PluginIconComponent` binds it to `[innerHTML]`. Asserting on the returned *string*
 * alone proves nothing about the tree those sinks build, so every payload below is
 * re-parsed the same way the sink parses it before being inspected.
 */
const renderAtSink = (sanitized: string): HTMLDivElement => {
  const div = document.createElement('div');
  div.innerHTML = sanitized;
  return div;
};

const sanitizeAndRender = (svg: string): HTMLDivElement =>
  renderAtSink(sanitizeSvgIconContent(svg) ?? '');

describe('sanitizeSvgIconContent', () => {
  describe('rejects input that is not a single SVG root', () => {
    it('returns null for non-svg markup', () => {
      expect(sanitizeSvgIconContent('<div>not svg</div>')).toBeNull();
    });

    it('returns null for empty and blank input', () => {
      expect(sanitizeSvgIconContent('')).toBeNull();
      expect(sanitizeSvgIconContent('   \n ')).toBeNull();
    });

    it('returns null when the svg is not the first element', () => {
      expect(
        sanitizeSvgIconContent('<img src="x"><svg><circle r="1"></circle></svg>'),
      ).toBeNull();
    });

    it('returns null when the svg is wrapped in another element', () => {
      // Rejected because `firstElementChild` is the `<math>`, not the `<svg>`. Naming this
      // after the namespace check would overstate it: that check is unreachable today.
      expect(
        sanitizeSvgIconContent('<math><svg><circle r="1"></circle></svg></math>'),
      ).toBe(null);
    });
  });

  describe('rejects an icon with nothing left to draw', () => {
    // An empty `<svg>` is not the same as no icon: it paints a blank box and suppresses the
    // caller's fallback, so it has to be reported as unusable.
    it('returns null when an embedded <image> is the only content', () => {
      expect(
        sanitizeSvgIconContent(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBOR"></image></svg>',
        ),
      ).toBeNull();
    });

    it('returns null for an Illustrator <switch> wrapper', () => {
      expect(
        sanitizeSvgIconContent(
          '<svg xmlns="http://www.w3.org/2000/svg"><switch><g><path d="M2 2h20v20H2z"></path></g></switch></svg>',
        ),
      ).toBeNull();
    });

    it('returns null when only bare text survives', () => {
      expect(sanitizeSvgIconContent('<svg>hello</svg>')).toBeNull();
    });

    it('keeps an icon that still has one drawable child', () => {
      expect(
        sanitizeSvgIconContent(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script><path d="M1 2"></path></svg>',
        ),
      ).toContain('<path d="M1 2">');
    });
  });

  describe('keeps real icons intact', () => {
    it('preserves shapes, presentation attributes and camelCase attribute names', () => {
      const sanitized = sanitizeSvgIconContent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
          '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>' +
          '<line x1="16" y1="2" x2="16" y2="6"></line>' +
          '<path d="M8 14h.01M12 14h.01"></path>' +
          '</svg>',
      );

      expect(sanitized).not.toBeNull();
      const svg = sanitizeAndRender(sanitized as string).querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      expect(svg?.getAttribute('stroke-width')).toBe('2');
      expect(svg?.querySelector('rect')?.getAttribute('rx')).toBe('2');
      expect(svg?.querySelector('line')?.getAttribute('x1')).toBe('16');
      expect(svg?.querySelector('path')?.getAttribute('d')).toBe('M8 14h.01M12 14h.01');
    });

    it('preserves a gradient referenced by a same-document fragment', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"></stop></linearGradient></defs>' +
          '<rect width="8" height="8" fill="url(#g)"></rect>' +
          '</svg>',
      );

      expect(rendered.querySelector('linearGradient')?.getAttribute('id')).toBe('g');
      expect(rendered.querySelector('stop')?.getAttribute('stop-color')).toBe('#f00');
      expect(rendered.querySelector('rect')?.getAttribute('fill')).toBe('url(#g)');
    });

    it('preserves text content as text', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="2">API</text></svg>',
      );

      expect(rendered.querySelector('text')?.textContent).toBe('API');
    });
  });

  describe('strips script-bearing attributes', () => {
    it('drops event handlers', () => {
      const rendered = sanitizeAndRender(
        '<svg onload="window.alert(1)"><circle cx="5" cy="5" r="4" onclick="window.alert(1)"></circle></svg>',
      );

      expect(rendered.querySelector('svg')?.getAttribute('onload')).toBeNull();
      expect(rendered.querySelector('circle')?.getAttribute('onclick')).toBeNull();
      expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('4');
    });

    it('drops style attributes', () => {
      const rendered = sanitizeAndRender(
        '<svg><circle r="4" style="background:url(https://evil.test/x)"></circle></svg>',
      );

      expect(rendered.querySelector('circle')?.getAttribute('style')).toBeNull();
    });
  });

  describe('entity-encoded markup stays text', () => {
    // The parser decodes `&lt;img ...&gt;` into a plain text node. Re-emitting that node
    // verbatim would hand the sink live markup, so the value has to be encoded again on
    // the way out.
    it('does not release escaped markup from a text node', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>&lt;img src=x onerror=window.alert(1)&gt;</text></svg>',
      );

      expect(rendered.querySelector('img')).toBeNull();
      expect(rendered.querySelector('text')?.textContent).toBe(
        '<img src=x onerror=window.alert(1)>',
      );
    });

    it('normalizes an attribute name that lowercases into the allowlist', () => {
      // `'K'.toLowerCase()` is `k`, so `stroKe` passes an allowlist keyed on the
      // lowercased name. Emitting the parsed spelling would put a name on the element that
      // is not the one that was checked.
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect stroKe="red" width="1" height="1"></rect></svg>',
      );
      const rect = rendered.querySelector('rect');

      expect(rect?.getAttribute('stroke')).toBe('red');
      expect(rect?.getAttribute('stroKe')).toBeNull();
    });

    it('keeps camelCase svg attributes readable through the sink', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><linearGradient id="g" gradientUnits="userSpaceOnUse"></linearGradient></svg>',
      );

      expect(rendered.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 4 4');
      expect(
        rendered.querySelector('linearGradient')?.getAttribute('gradientUnits'),
      ).toBe('userSpaceOnUse');
    });

    it('does not let an attribute value break out of its quotes', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle r=\'1" onload="window.alert(1)\'></circle></svg>',
      );

      expect(rendered.querySelector('circle')?.getAttribute('onload')).toBeNull();
      expect(rendered.querySelector('[onload]')).toBeNull();
    });
  });

  describe('mXSS: CDATA re-parsed as HTML at an SVG integration point', () => {
    // `<desc>`, `<title>` and `<foreignObject>` are HTML integration points: inside them
    // the HTML parser switches back to HTML content mode. An XML-based sanitizer re-emits
    // `<![CDATA[..]]>` faithfully, and the HTML parser then reads it as a bogus comment
    // that ends at the first `>`, releasing the rest as live markup.
    (['desc', 'title', 'foreignObject'] as const).forEach((tag) => {
      it(`does not smuggle live markup through <${tag}> CDATA`, () => {
        const rendered = sanitizeAndRender(
          `<svg xmlns="http://www.w3.org/2000/svg"><${tag}><![CDATA[><img src=x onerror="window.alert(1)">]]></${tag}><circle r="7"></circle></svg>`,
        );

        expect(rendered.querySelector('img')).toBeNull();
        expect(rendered.querySelector('[onerror]')).toBeNull();
        // Positive control: without it an always-empty sanitizer would pass the two above.
        expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('7');
      });
    });
  });

  describe('case-folded tag names', () => {
    // XML type selectors match case sensitively, so a denylist built on
    // `querySelectorAll('foreignObject')` misses `<FOREIGNOBJECT>`. The HTML parser at the
    // sink then applies its SVG tag-name adjustment table and resurrects the real element.
    it('does not let <FOREIGNOBJECT> survive', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><FOREIGNOBJECT><![CDATA[><img src=x onerror="window.alert(1)">]]></FOREIGNOBJECT><circle r="7"></circle></svg>',
      );

      expect(rendered.querySelector('foreignObject')).toBeNull();
      expect(rendered.querySelector('img')).toBeNull();
      expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('7');
    });

    it('does not let <STYLE> survive', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><STYLE>*{color:red}</STYLE><circle r="7"></circle></svg>',
      );

      expect(rendered.querySelector('style')).toBeNull();
      expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('7');
    });

    it('drops <SCRIPT> regardless of case', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>window.alert(1)</SCRIPT><circle r="1"></circle></svg>',
      );

      expect(rendered.querySelector('script')).toBeNull();
      expect(rendered.querySelector('circle')).not.toBeNull();
    });
  });

  describe('SMIL animation retargeting an href attribute', () => {
    // No parse trick needed: the animation element carries no href of its own, so an
    // attribute-value check never inspects it. `<set>`/`<animate>` write the `javascript:`
    // URL onto the parent `<a>` at runtime, after sanitization has finished.
    it('strips <set> that retargets href to a javascript: URL', () => {
      const sanitized = sanitizeSvgIconContent(
        '<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="javascript:window.alert(1)"></set><text>x</text></a><circle r="7"></circle></svg>',
      );

      // Asserting only `not.toContain('javascript:')` would be vacuous: `to` is not an
      // allowlisted attribute, so the string disappears whether or not `<set>` survives.
      // The load-bearing assertion is that the animation element and its `<a>` target are
      // both gone from the tree the sink builds.
      const rendered = renderAtSink(sanitized as string);
      expect(rendered.querySelector('set')).toBeNull();
      expect(rendered.querySelector('a')).toBeNull();
      expect(rendered.querySelector('[attributeName]')).toBeNull();
      expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('7');
    });

    it('strips <animate> that retargets xlink:href to a javascript: URL', () => {
      const sanitized = sanitizeSvgIconContent(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a><animate attributeName="xlink:href" values="javascript:window.alert(1)" begin="0s"></animate><text>x</text></a><circle r="7"></circle></svg>',
      );

      const rendered = renderAtSink(sanitized as string);
      expect(rendered.querySelector('animate')).toBeNull();
      expect(rendered.querySelector('a')).toBeNull();
      expect(rendered.querySelector('[attributeName]')).toBeNull();
      expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('7');
    });
  });

  describe('references may not leave the document', () => {
    // `<use>` and every `href` are out of the allowlist entirely: nested `<use>` expands
    // exponentially at render time and wedges the renderer, and removing them takes the
    // whole "is this reference same-document?" question with it.
    it('drops <use> and its href outright', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<use href="https://evil.test/icon.svg#x"></use>' +
          '<use href="#local"></use>' +
          '<circle r="7"></circle>' +
          '</svg>',
      );

      expect(rendered.querySelector('use')).toBeNull();
      expect(rendered.querySelector('[href]')).toBeNull();
      expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('7');
    });

    it('drops an href whose fragment hides behind non-ASCII whitespace', () => {
      // `String.prototype.trim()` strips U+00A0, the URL parser does not, so a `trim()`-based
      // fragment check would keep a value that resolves to a request off the document.
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><use href=" #x"></use><circle r="7"></circle></svg>',
      );

      expect(rendered.querySelector('[href]')).toBeNull();
      expect(rendered.querySelector('[*|href]')).toBeNull();
    });

    it('drops a css identifier escape that spells url(', () => {
      // `\75 rl(` is `url(` once the CSS parser resolves the escape, so a regex looking for
      // the literal spelling never sees it and Chrome resolves the fetch for real.
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9" fill="\\75 rl(https://evil.test/x.svg#g)"></rect></svg>',
      );

      expect(rendered.querySelector('rect')?.getAttribute('fill')).toBeNull();
      expect(rendered.querySelector('rect')?.getAttribute('width')).toBe('9');
    });

    it('resolves no external paint server for an escaped url', () => {
      const host = document.createElement('div');
      host.innerHTML =
        sanitizeSvgIconContent(
          '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9" fill="\\75 rl(https://evil.test/x.svg#g)"></rect></svg>',
        ) ?? '';
      document.body.appendChild(host);
      try {
        const rect = host.querySelector('rect');
        expect(rect).not.toBeNull();
        // The decisive assertion: before the escape was refused this read back as
        // `url("https://evil.test/x.svg#g")`, i.e. a live cross-origin fetch.
        expect(getComputedStyle(rect as Element).fill).not.toContain('evil.test');
      } finally {
        document.body.removeChild(host);
      }
    });

    it('drops a paint reference to a remote document', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="url(https://evil.test/x#g)"></rect></svg>',
      );

      expect(rendered.querySelector('rect')?.getAttribute('fill')).toBeNull();
      expect(rendered.querySelector('rect')?.getAttribute('width')).toBe('8');
    });

    it('keeps a fragment paint reference written with whitespace or quotes', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<rect id="a" width="8" height="8" fill="url( #g )"></rect>' +
          `<rect id="b" width="8" height="8" fill="url('#g')"></rect>` +
          '</svg>',
      );

      expect(rendered.querySelector('#a')?.getAttribute('fill')).toBe('url( #g )');
      expect(rendered.querySelector('#b')?.getAttribute('fill')).toBe(`url('#g')`);
    });

    it('drops the attribute when only one of several url() refs leaves the document', () => {
      const rendered = sanitizeAndRender(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="url(#g) url(https://evil.test/x)"></rect></svg>',
      );

      expect(rendered.querySelector('rect')?.getAttribute('fill')).toBeNull();
    });
  });

  describe('output is stable under re-parsing', () => {
    // The sinks parse whatever we return. If sanitizing our own output changed it, the tree
    // the sink builds would differ from the tree we audited -- exactly the class of bug
    // that made every payload above exploitable.
    const PAYLOADS = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2"></path></svg>',
      // Each hostile payload keeps one drawable child, so sanitizing yields a real string
      // to re-sanitize rather than the trivially stable `null`.
      '<svg><desc><![CDATA[><img src=x onerror="window.alert(1)">]]></desc><circle r="1"></circle></svg>',
      '<svg><FOREIGNOBJECT><![CDATA[><img src=x onerror="window.alert(1)">]]></FOREIGNOBJECT><circle r="1"></circle></svg>',
      '<svg><a><set attributeName="href" to="javascript:window.alert(1)"></set></a><circle r="1"></circle></svg>',
      '<svg><text>a &amp; b &lt;c&gt; "d" \'e\'</text></svg>',
      '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"></stop></linearGradient></defs><rect width="8" height="8" fill="url(#g)"></rect></svg>',
    ];

    PAYLOADS.forEach((payload, i) => {
      it(`is idempotent for payload ${i}`, () => {
        const once = sanitizeSvgIconContent(payload);
        expect(once).not.toBeNull();
        expect(sanitizeSvgIconContent(once as string)).toBe(once as string);
      });
    });
  });
});
