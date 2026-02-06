import {
  markedOptionsFactory,
  parseImageDimensionsFromTitle,
  preprocessMarkdown,
} from './marked-options-factory';
import { marked } from 'marked';

/**
 * Parse markdown using our factory config, same as the app does at runtime.
 * Resets marked defaults first to avoid cross-test pollution.
 */
const parseWithFactory = (markdown: string): string => {
  marked.setOptions(marked.getDefaults());
  const options = markedOptionsFactory();
  const renderer = { ...(options.renderer as any) };
  marked.use({ renderer });
  return marked.parse(markdown) as string;
};

describe('markedOptionsFactory', () => {
  let options: ReturnType<typeof markedOptionsFactory>;

  beforeEach(() => {
    options = markedOptionsFactory();
  });

  it('should return a MarkedOptions object', () => {
    expect(options).toBeDefined();
    expect(options.renderer).toBeDefined();
    expect(options.gfm).toBe(true);
  });

  describe('checkbox renderer', () => {
    it('should return empty string for unchecked items', () => {
      const result = (options.renderer as any).checkbox({ checked: false });
      expect(result).toBe('');
    });

    it('should return empty string for checked items', () => {
      const result = (options.renderer as any).checkbox({ checked: true });
      expect(result).toBe('');
    });
  });

  // Integration tests: parse real markdown through the full marked pipeline (#6379)
  describe('full pipeline checklist rendering (issue #6379)', () => {
    it('should not produce native <input> checkbox for unchecked items', () => {
      const html = parseWithFactory('- [ ] Item 1');
      expect(html).not.toContain('<input');
      expect(html).toContain('checkbox-wrapper');
      expect(html).toContain('check_box_outline_blank');
    });

    it('should not produce native <input> checkbox for checked items', () => {
      const html = parseWithFactory('- [x] Item 1');
      expect(html).not.toContain('<input');
      expect(html).toContain('checkbox-wrapper');
      expect(html).toContain('check_box');
    });

    it('should not produce native <input> checkbox for multiple items', () => {
      const html = parseWithFactory('- [ ] Item 1\n- [x] Item 2\n- [ ] Item 3');
      expect(html).not.toContain('<input');
      expect(html).toContain('check_box_outline_blank');
      expect(html).toContain('check_box');
    });

    it('should not produce native <input> checkbox for gapped list items', () => {
      const html = parseWithFactory('- [ ] Item 1\n\n- [ ] Item 2\n');
      expect(html).not.toContain('<input');
      expect(html).toContain('checkbox-wrapper');
    });

    it('should render exactly one checkbox span per item', () => {
      const html = parseWithFactory('- [ ] A\n- [x] B');
      const uncheckedCount = (html.match(/check_box_outline_blank/g) || []).length;
      const checkedCount = (html.match(/>check_box</g) || []).length;
      expect(uncheckedCount).toBe(1);
      expect(checkedCount).toBe(1);
    });
  });

  describe('listitem renderer', () => {
    it('should render regular list item without checkbox', () => {
      const result = options.renderer!.listitem({
        text: 'Regular item',
        task: false,
        checked: undefined,
      } as any);
      expect(result).toBe('<li>Regular item</li>');
      expect(result).not.toContain('checkbox-wrapper');
    });

    it('should render unchecked task list item with checkbox', () => {
      const result = options.renderer!.listitem({
        text: 'Task item',
        task: true,
        checked: false,
      } as any);
      expect(result).toContain('checkbox-wrapper');
      expect(result).toContain('undone');
      expect(result).toContain('check_box_outline_blank');
      expect(result).toContain('Task item');
      expect(result).toContain('</span> Task item');
    });

    it('should render checked task list item with checkbox', () => {
      const result = options.renderer!.listitem({
        text: 'Completed task',
        task: true,
        checked: true,
      } as any);
      expect(result).toContain('checkbox-wrapper');
      expect(result).toContain('done');
      expect(result).not.toContain('undone');
      expect(result).toContain('check_box');
      expect(result).not.toContain('check_box_outline_blank');
      expect(result).toContain('Completed task');
      expect(result).toContain('</span> Completed task');
    });

    it('should handle undefined checked value as unchecked', () => {
      const result = options.renderer!.listitem({
        text: 'Task with undefined checked',
        task: true,
        checked: undefined,
      } as any);
      expect(result).toContain('checkbox-wrapper');
      expect(result).toContain('undone');
      expect(result).toContain('check_box_outline_blank');
    });

    it('should have space between checkbox and text for proper visual separation', () => {
      const result = options.renderer!.listitem({
        text: 'Spaced item',
        task: true,
        checked: false,
      } as any);
      expect(result).toMatch(/<\/span> Spaced item<\/li>/);
    });

    // Tests for gapped and nested lists (issue #6244)
    // In marked v17, loose lists (with blank lines) have block-level tokens like paragraph
    describe('gapped and nested lists (issue #6244)', () => {
      // Mock parser that handles both parse() and parseInline()
      const createMockParser = (): {
        parse: (tokens: any[]) => string;
        parseInline: (tokens: any[]) => string;
      } => ({
        parse: (tokens: any[]) =>
          tokens
            .map((t: any) => {
              // Handle paragraph tokens (block-level)
              if (t.type === 'paragraph' && t.tokens) {
                return `<p>${t.tokens.map((inner: any) => inner.raw || inner.text || '').join('')}</p>`;
              }
              // Handle list tokens (nested lists)
              if (t.type === 'list') {
                return '<ul><li>nested item</li></ul>';
              }
              return t.raw || t.text || '';
            })
            .join(''),
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      });

      it('should render gapped checklist items without error and without p tags', () => {
        const mockParser = createMockParser();
        const listitemRenderer = options.renderer!.listitem.bind({ parser: mockParser });

        // Loose list items have paragraph tokens instead of raw text
        // For task items, the paragraph should be unwrapped to keep checkbox on same line
        const result = listitemRenderer({
          text: '',
          task: true,
          checked: false,
          tokens: [
            {
              type: 'paragraph',
              tokens: [{ type: 'text', raw: 'First item', text: 'First item' }],
            },
          ],
        } as any);

        expect(result).toContain('checkbox-wrapper');
        expect(result).toContain('First item');
        expect(result).not.toContain('undefined');
        // Task items should NOT have <p> tags to keep checkbox and text on same line
        expect(result).not.toContain('<p>');
      });

      it('should render gapped regular list items without error', () => {
        const mockParser = createMockParser();
        const listitemRenderer = options.renderer!.listitem.bind({ parser: mockParser });

        const result = listitemRenderer({
          text: '',
          task: false,
          checked: undefined,
          tokens: [
            {
              type: 'paragraph',
              tokens: [{ type: 'text', raw: 'Loose item', text: 'Loose item' }],
            },
          ],
        } as any);

        expect(result).toBe('<li><p>Loose item</p></li>');
      });

      it('should render nested list items without error', () => {
        const mockParser = createMockParser();
        const listitemRenderer = options.renderer!.listitem.bind({ parser: mockParser });

        const result = listitemRenderer({
          text: '',
          task: false,
          checked: undefined,
          tokens: [
            { type: 'text', raw: 'Parent item', text: 'Parent item' },
            { type: 'list', items: [{ text: 'nested item' }] },
          ],
        } as any);

        expect(result).toContain('Parent item');
        expect(result).toContain('<ul>');
        expect(result).toContain('nested item');
      });

      it('should render gapped checklist with inline formatting', () => {
        // Mock parse() that produces <p> wrapped content with inline formatting
        const mockParser = {
          parse: (tokens: any[]): string =>
            tokens
              .map((t: any) => {
                if (t.type === 'paragraph' && t.tokens) {
                  return `<p>${t.tokens
                    .map((inner: any) => {
                      if (inner.type === 'strong')
                        return `<strong>${inner.text}</strong>`;
                      return inner.raw || inner.text || '';
                    })
                    .join('')}</p>`;
                }
                return t.raw || t.text || '';
              })
              .join(''),
          parseInline: (tokens: any[]): string =>
            tokens.map((t: any) => t.raw || t.text || '').join(''),
        };
        const listitemRenderer = options.renderer!.listitem.bind({ parser: mockParser });

        const result = listitemRenderer({
          text: '',
          task: true,
          checked: true,
          tokens: [
            {
              type: 'paragraph',
              tokens: [
                { type: 'text', raw: 'Task with ', text: 'Task with ' },
                { type: 'strong', raw: '**bold**', text: 'bold' },
              ],
            },
          ],
        } as any);

        expect(result).toContain('checkbox-wrapper');
        expect(result).toContain('done');
        expect(result).toContain('<strong>bold</strong>');
        // Task items should NOT have <p> tags (stripped by post-processing)
        expect(result).not.toContain('<p>');
      });

      it('should still render tight lists correctly', () => {
        const mockParser = createMockParser();
        const listitemRenderer = options.renderer!.listitem.bind({ parser: mockParser });

        // Tight list items have inline tokens directly (no paragraph wrapper)
        const result = listitemRenderer({
          text: 'Tight item',
          task: false,
          checked: undefined,
          tokens: [{ type: 'text', raw: 'Tight item', text: 'Tight item' }],
        } as any);

        expect(result).toBe('<li>Tight item</li>');
      });
    });
  });

  describe('link renderer', () => {
    it('should render link with target="_blank"', () => {
      // In marked v17, the link renderer receives tokens that need to be parsed
      // We need to bind a mock parser context
      const mockParser = {
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      };
      const linkRenderer = options.renderer!.link.bind({ parser: mockParser });

      const result = linkRenderer({
        href: 'http://example.com',
        title: 'Example',
        tokens: [{ type: 'text', raw: 'Click here', text: 'Click here' }],
      } as any);
      expect(result).toContain('target="_blank"');
      expect(result).toContain('href="http://example.com"');
      expect(result).toContain('title="Example"');
      expect(result).toContain('Click here');
    });

    it('should handle empty title', () => {
      const mockParser = {
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      };
      const linkRenderer = options.renderer!.link.bind({ parser: mockParser });

      const result = linkRenderer({
        href: 'http://example.com',
        title: null,
        tokens: [{ type: 'text', raw: 'Link', text: 'Link' }],
      } as any);
      expect(result).toContain('title=""');
    });
  });

  describe('image renderer', () => {
    it('should render basic image with alt text', () => {
      const result = options.renderer!.image({
        href: 'http://example.com/image.png',
        title: null,
        text: 'Alt text',
      } as any);
      expect(result).toContain('src="http://example.com/image.png"');
      expect(result).toContain('alt="Alt text"');
      expect(result).toContain('loading="lazy"');
    });

    it('should render image with width and height from title', () => {
      const result = options.renderer!.image({
        href: 'http://example.com/image.png',
        title: '200|150',
        text: 'Sized image',
      } as any);
      expect(result).toContain('width="200"');
      expect(result).toContain('height="150"');
      expect(result).not.toContain('title=');
    });

    it('should render image with width only', () => {
      const result = options.renderer!.image({
        href: 'http://example.com/image.png',
        title: '300|',
        text: 'Width only',
      } as any);
      expect(result).toContain('width="300"');
      expect(result).not.toContain('height=');
    });

    it('should render image with height only', () => {
      const result = options.renderer!.image({
        href: 'http://example.com/image.png',
        title: '|250',
        text: 'Height only',
      } as any);
      expect(result).toContain('height="250"');
      expect(result).not.toContain('width=');
    });

    it('should render regular title when not in dimension format', () => {
      const result = options.renderer!.image({
        href: 'http://example.com/image.png',
        title: 'A descriptive title',
        text: 'Image',
      } as any);
      expect(result).toContain('title="A descriptive title"');
      expect(result).not.toContain('width=');
      expect(result).not.toContain('height=');
    });

    it('should handle null title', () => {
      const result = options.renderer!.image({
        href: 'http://example.com/image.png',
        title: null,
        text: 'No title',
      } as any);
      expect(result).not.toContain('title=');
      expect(result).toContain('alt="No title"');
    });
  });

  describe('paragraph renderer', () => {
    it('should render simple paragraph', () => {
      const mockParser = {
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      };
      const paragraphRenderer = options.renderer!.paragraph.bind({ parser: mockParser });

      const result = paragraphRenderer({
        tokens: [{ type: 'text', raw: 'Simple paragraph', text: 'Simple paragraph' }],
      } as any);
      expect(result).toBe('<p>Simple paragraph</p>');
    });

    it('should convert h1. syntax to heading', () => {
      const mockParser = {
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      };
      const paragraphRenderer = options.renderer!.paragraph.bind({ parser: mockParser });

      const result = paragraphRenderer({
        tokens: [{ type: 'text', raw: 'h1. My Heading', text: 'h1. My Heading' }],
      } as any);
      expect(result).toBe('<h1> My Heading</h1>');
    });

    it('should convert h2. syntax to heading', () => {
      const mockParser = {
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      };
      const paragraphRenderer = options.renderer!.paragraph.bind({ parser: mockParser });

      const result = paragraphRenderer({
        tokens: [{ type: 'text', raw: 'h2. Subheading', text: 'h2. Subheading' }],
      } as any);
      expect(result).toBe('<h2> Subheading</h2>');
    });
  });

  // Note: URL auto-linking is handled automatically by marked v17 with gfm: true.
  // We intentionally do NOT override renderer.text for this - the lexer converts
  // URLs to link tokens before they reach the text renderer.
});

describe('parseImageDimensionsFromTitle', () => {
  it('should parse width and height from title', () => {
    const result = parseImageDimensionsFromTitle('200|150');
    expect(result).toEqual({ width: '200', height: '150' });
  });

  it('should parse width only', () => {
    const result = parseImageDimensionsFromTitle('300|');
    expect(result).toEqual({ width: '300', height: undefined });
  });

  it('should parse height only', () => {
    const result = parseImageDimensionsFromTitle('|250');
    expect(result).toEqual({ width: undefined, height: '250' });
  });

  it('should return empty object for null title', () => {
    const result = parseImageDimensionsFromTitle(null);
    expect(result).toEqual({});
  });

  it('should return empty object for non-dimension format', () => {
    const result = parseImageDimensionsFromTitle('A regular title');
    expect(result).toEqual({});
  });

  it('should return empty object for empty string', () => {
    const result = parseImageDimensionsFromTitle('');
    expect(result).toEqual({});
  });

  it('should handle pipe only', () => {
    const result = parseImageDimensionsFromTitle('|');
    expect(result).toEqual({ width: undefined, height: undefined });
  });
});

describe('preprocessMarkdown', () => {
  it('should convert image sizing syntax to title format', () => {
    const input = '![alt text](http://example.com/image.png =200x150)';
    const result = preprocessMarkdown(input);
    expect(result).toBe('![alt text](http://example.com/image.png "200|150")');
  });

  it('should handle width only', () => {
    const input = '![alt](url.png =300x)';
    const result = preprocessMarkdown(input);
    expect(result).toBe('![alt](url.png "300|")');
  });

  it('should handle height only', () => {
    const input = '![alt](url.png =x250)';
    const result = preprocessMarkdown(input);
    expect(result).toBe('![alt](url.png "|250")');
  });

  it('should handle multiple images in text', () => {
    const input = 'Some text ![img1](a.png =100x100) more ![img2](b.png =200x200) end';
    const result = preprocessMarkdown(input);
    expect(result).toBe(
      'Some text ![img1](a.png "100|100") more ![img2](b.png "200|200") end',
    );
  });

  it('should not modify images without sizing syntax', () => {
    const input = '![alt](http://example.com/image.png)';
    const result = preprocessMarkdown(input);
    expect(result).toBe('![alt](http://example.com/image.png)');
  });

  it('should not modify images with regular title', () => {
    const input = '![alt](http://example.com/image.png "A title")';
    const result = preprocessMarkdown(input);
    expect(result).toBe('![alt](http://example.com/image.png "A title")');
  });

  it('should preserve other markdown content', () => {
    const input = '# Header\n\n![img](url.png =50x50)\n\nParagraph';
    const result = preprocessMarkdown(input);
    expect(result).toBe('# Header\n\n![img](url.png "50|50")\n\nParagraph');
  });
});
