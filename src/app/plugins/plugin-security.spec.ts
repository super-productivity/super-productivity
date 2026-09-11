import { TestBed } from '@angular/core/testing';
import { PluginSecurityService } from './plugin-security';

describe('PluginSecurityService', () => {
  let service: PluginSecurityService;

  beforeEach(() => {
    service = TestBed.inject(PluginSecurityService);
  });

  describe('sanitizeHtml', () => {
    it('removes executable elements, attributes, styles, and URLs', () => {
      const sanitized = service.sanitizeHtml(`
        <script>alert('script')</script>
        <iframe srcdoc="<script>alert('iframe')</script>"></iframe>
        <svg onload="alert('svg')"><circle></circle></svg>
        <img src="javascript:alert('url')" onerror="alert('event')" style="background:url(https://evil.test/x.png)">
        <img src="data:image/svg+xml,<svg onload=alert('data')></svg>">
        <a href="&#x6a;avascript:alert('link')" onmouseover="alert('hover')">Link</a>
        <button formaction="javascript:alert('submit')" onclick="alert('click')">
          Submit
        </button>
      `);

      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('<iframe');
      expect(sanitized).not.toContain('<svg');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).not.toContain('onmouseover');
      expect(sanitized).not.toContain('onclick');
      expect(sanitized).not.toContain('formaction');
      expect(sanitized).not.toContain('image/svg+xml');
      expect(sanitized).not.toContain('style=');
    });

    it('preserves supported semantic markup and form controls', () => {
      const sanitized = service.sanitizeHtml(`
        <section id="settings" data-state="ready" aria-label="Plugin settings">
          <h2>Settings</h2>
          <label for="name">Name</label>
          <input id="name" type="text" value="Example" required>
          <select id="choice"><option value="a" selected>A</option></select>
          <textarea id="notes" rows="3" placeholder="Notes">Hello</textarea>
        </section>
      `);
      const container = document.createElement('div');
      container.innerHTML = sanitized;

      const section = container.querySelector('section');
      const input = container.querySelector('input');
      const option = container.querySelector('option');
      const textarea = container.querySelector('textarea');

      expect(section?.id).toBe('settings');
      expect(section?.getAttribute('data-state')).toBe('ready');
      expect(section?.getAttribute('aria-label')).toBe('Plugin settings');
      expect(input?.value).toBe('Example');
      expect(input?.required).toBeTrue();
      expect(option?.selected).toBeTrue();
      expect(textarea?.rows).toBe(3);
      expect(textarea?.textContent).toBe('Hello');
    });

    it('keeps safe links and raster image sources', () => {
      const sanitized = service.sanitizeHtml(`
        <a href="https://example.com/path" target="_blank">Example</a>
        <a href="#settings">Settings</a>
        <img src="data:image/png;base64,iVBORw0KGgo=" alt="Preview">
      `);

      expect(sanitized).toContain('href="https://example.com/path"');
      expect(sanitized).toContain('href="#settings"');
      expect(sanitized).toContain('rel="noopener noreferrer"');
      expect(sanitized).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    });

    it('rejects URLs that would resolve relative to the host application', () => {
      const sanitized = service.sanitizeHtml(`
        <a id="absolute-path" href="/etc/passwd">Absolute path</a>
        <a id="protocol-relative" href="//example.com/path">Protocol relative</a>
        <img id="relative-image" src="assets/example.png">
      `);
      const container = document.createElement('div');
      container.innerHTML = sanitized;

      expect(container.querySelector('#absolute-path')?.getAttribute('href')).toBeNull();
      expect(
        container.querySelector('#protocol-relative')?.getAttribute('href'),
      ).toBeNull();
      expect(container.querySelector('#relative-image')?.getAttribute('src')).toBeNull();
    });

    it('emits the same URL string it validated', () => {
      // `trim()` strips U+00A0 but the URL parser does not, so emitting the raw
      // value would turn a validated https link into a relative path.
      const sanitized = service.sanitizeHtml(
        `<a id="padded" href="\u00A0https://example.com/ok">Padded</a>` +
          `<img id="padded-image" src="\u00A0data:image/png;base64,iVBORw0KGgo=" alt="p">`,
      );
      const container = document.createElement('div');
      container.innerHTML = sanitized;

      const link = container.querySelector('#padded') as HTMLAnchorElement;
      const image = container.querySelector('#padded-image') as HTMLImageElement;

      expect(link.getAttribute('href')).toBe('https://example.com/ok');
      expect(link.protocol).toBe('https:');
      expect(image.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('drops elements whose content must not become visible text', () => {
      // The leading <p> matters: a <style>/<script>/<title> before any body
      // content is routed into <head> by the parser, and only <body> is walked,
      // so such a payload would never reach the drop check at all.
      const sanitized = service.sanitizeHtml(
        `<p>keep</p><style>p{color:red}</style><script>alert('x')</script><title>t</title>`,
      );

      expect(sanitized).toBe('<p>keep</p>');
    });

    it('keeps layout styles but drops declarations that can fetch', () => {
      const sanitized = service.sanitizeHtml(
        `<div id="layout" style="display:flex;gap:12px;width:100%;height:3px">a</div>`,
      );
      const container = document.createElement('div');
      container.innerHTML = sanitized;
      const style = (container.querySelector('#layout') as HTMLElement).style;

      expect(style.display).toBe('flex');
      expect(style.gap).toBe('12px');
      expect(style.width).toBe('100%');
      expect(style.height).toBe('3px');
    });

    it('drops url() from styles however it is spelled', () => {
      // CSS resolves identifier escapes while tokenizing, so each of these is a
      // real url() to the browser and only the normalized value reveals it.
      const sanitized = service.sanitizeHtml(
        `<div id="a" style="background:url(https://evil.test/a.png)">a</div>` +
          `<div id="b" style="background:\\75 rl(https://evil.test/b.png)">b</div>` +
          `<div id="c" style="background:\\75\\72\\6c(https://evil.test/c.png)">c</div>` +
          `<div id="d" style="background:image-set('https://evil.test/d.png' 1x)">d</div>` +
          `<div id="e" style="cursor:url(https://evil.test/e.cur),pointer">e</div>` +
          `<div id="f" style="--x:\\75 rl(https://evil.test/f.png);background:var(--x)">f</div>`,
      );

      const container = document.createElement('div');
      container.innerHTML = sanitized;

      expect(sanitized).not.toContain('url(');
      expect(sanitized).not.toContain('evil.test');
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        expect(container.querySelector(`#${id}`)?.getAttribute('style')).toBeNull();
      }
      // The var() indirection must not survive either: the custom property that
      // held the escaped url() is gone, so nothing can substitute it back in.
      const indirect = container.querySelector('#f') as HTMLElement;
      expect(indirect.style.getPropertyValue('--x')).toBe('');
    });

    it('preserves the markup bundled plugin dialogs are built from', () => {
      const sanitized = service.sanitizeHtml(
        `<div style="display:flex;gap:12px">` +
          `<div id="bd-color-bar" style="height:3px;border-radius:2px"></div>` +
          `<textarea id="bd-input" rows="10" style="width:100%">saved</textarea>` +
          `<input type="range" id="vr-volume" min="0" max="100" value="50" style="flex:1">` +
          `</div>`,
      );
      const container = document.createElement('div');
      container.innerHTML = sanitized;

      const colorBar = container.querySelector('#bd-color-bar') as HTMLElement;
      const textarea = container.querySelector('#bd-input') as HTMLTextAreaElement;
      const slider = container.querySelector('#vr-volume') as HTMLInputElement;

      expect(colorBar.style.height).toBe('3px');
      expect(textarea.style.width).toBe('100%');
      expect(textarea.value).toBe('saved');
      expect(slider.style.flexGrow).toBe('1');
      expect(slider.value).toBe('50');
    });
  });
});
