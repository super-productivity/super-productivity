import { JiraToMarkdownPipe } from './jira-to-markdown.pipe';

describe('JiraToMarkdownPipe', () => {
  const pipe = new JiraToMarkdownPipe();

  const timeMs = (input: string): number => {
    const start = performance.now();
    pipe.transform(input);
    return performance.now() - start;
  };

  describe('code blocks', () => {
    it('keeps the language', () => {
      expect(pipe.transform('{code:java}\nfoo()\n{code}')).toBe('```java\nfoo()\n```');
    });

    it('drops block parameters', () => {
      expect(pipe.transform('{code:title=Foo.java|borderStyle=solid}\nbar\n{code}')).toBe(
        '```\nbar\n```',
      );
    });

    it('keeps the language when parameters follow it', () => {
      expect(pipe.transform('{code:java|title=Foo.java}\nbar\n{code}')).toBe(
        '```java\nbar\n```',
      );
    });

    it('drops parameters beyond title/border/color ones', () => {
      expect(pipe.transform('{code:java|linenumbers=true}\nbar\n{code}')).toBe(
        '```java\nbar\n```',
      );
    });

    it('converts a block without language', () => {
      expect(pipe.transform('{code}\nx\n{code}')).toBe('```\nx\n```');
    });
  });

  describe('table headers', () => {
    it('converts a header row and adds a separator row', () => {
      expect(pipe.transform('||a||b||')).toBe('\n|a|b|\n| --- | --- |');
    });

    it('ignores leading whitespace', () => {
      expect(pipe.transform('  ||a||')).toBe('\n|a|\n| --- |');
    });
  });

  // Jira text is written by any user of the Jira instance; a crafted or
  // malformed description must not freeze the app (CodeQL js/redos #82, #83).
  describe('malformed input', () => {
    it('handles an unclosed code block with many parameters quickly', () => {
      expect(timeMs('{codetitle=' + 'atitle='.repeat(28))).toBeLessThan(200);
    });

    it('handles a long run of table bars quickly', () => {
      expect(timeMs('||'.repeat(22) + 'x')).toBeLessThan(200);
    });
  });
});
