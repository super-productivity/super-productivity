import { sanitizeSvgIconContent } from './sanitize-svg-icon.util';

describe('sanitizeSvgIconContent', () => {
  it('removes scriptable event handlers', () => {
    const result = sanitizeSvgIconContent(
      '<svg onload="alert(1)"><circle cx="5" cy="5" r="4"></circle></svg>',
    );

    expect(result).toContain('<svg');
    expect(result).not.toContain('onload');
  });

  it('removes dangerous script and foreignObject nodes', () => {
    const result = sanitizeSvgIconContent(
      '<svg><script>alert(1)</script><foreignObject><div>x</div></foreignObject><circle /></svg>',
    );

    expect(result).toContain('<svg');
    expect(result).toContain('<circle');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('foreignObject');
  });

  it('removes javascript URLs from links', () => {
    const result = sanitizeSvgIconContent(
      '<svg><a href="javascript:alert(1)"><circle /></a></svg>',
    );

    expect(result).toContain('<svg');
    expect(result).not.toContain('javascript:');
  });

  it('removes non-fragment href values', () => {
    const result = sanitizeSvgIconContent(
      '<svg><use href="https://example.com/icon.svg#x"></use><use href="#local"></use></svg>',
    );

    expect(result).toContain('<svg');
    expect(result).not.toContain('https://example.com');
    expect(result).toContain('href="#local"');
  });

  it('returns null for non-svg input', () => {
    expect(sanitizeSvgIconContent('<div>not svg</div>')).toBeNull();
  });
});
