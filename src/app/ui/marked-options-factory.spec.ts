import { markedOptionsFactory } from './marked-options-factory';

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
    it('should render unchecked checkbox with material icon', () => {
      const result = options.renderer!.checkbox({ checked: false } as any);
      expect(result).toContain('check_box_outline_blank');
      expect(result).toContain('class="checkbox material-icons"');
    });

    it('should render checked checkbox with material icon', () => {
      const result = options.renderer!.checkbox({ checked: true } as any);
      expect(result).toContain('check_box');
      expect(result).not.toContain('check_box_outline_blank');
      expect(result).toContain('class="checkbox material-icons"');
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
  });

  describe('link renderer', () => {
    it('should render link with target="_blank"', () => {
      const result = options.renderer!.link({
        href: 'http://example.com',
        title: 'Example',
        text: 'Click here',
      } as any);
      expect(result).toContain('target="_blank"');
      expect(result).toContain('href="http://example.com"');
      expect(result).toContain('title="Example"');
      expect(result).toContain('Click here');
    });

    it('should handle empty title', () => {
      const result = options.renderer!.link({
        href: 'http://example.com',
        title: null,
        text: 'Link',
      } as any);
      expect(result).toContain('title=""');
    });
  });

  describe('text renderer with URL auto-linking', () => {
    it('should auto-link URLs in text', () => {
      const result = options.renderer!.text({
        text: 'Check out http://example.com for more info',
        type: 'text',
        raw: 'Check out http://example.com for more info',
      } as any);
      // The text renderer modifies the token and passes it to the original renderer
      // which may HTML-escape the content, so we check for the href pattern
      expect(result).toContain('http://example.com');
      expect(result).toContain('href=');
    });

    it('should handle text without URLs', () => {
      const result = options.renderer!.text({
        text: 'Regular text without links',
        type: 'text',
        raw: 'Regular text without links',
      } as any);
      expect(result).not.toContain('href=');
    });
  });
});
