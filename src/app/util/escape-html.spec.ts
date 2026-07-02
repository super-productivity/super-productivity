import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;',
    );
  });

  it('escapes & first so entities are not double-broken', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Call plumber')).toBe('Call plumber');
  });
});
