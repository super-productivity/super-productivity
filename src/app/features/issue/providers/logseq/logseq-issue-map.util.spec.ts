import {
  extractFirstLine,
  extractBlockText,
  removeLogseqFormatting,
} from './logseq-issue-map.util';

describe('logseq-issue-map.util', () => {
  describe('removeLogseqFormatting', () => {
    it('should remove page link brackets [[...]]', () => {
      const input = 'Check [[Testpage]] for details';
      const expected = 'Check Testpage for details';
      expect(removeLogseqFormatting(input)).toBe(expected);
    });

    it('should remove tag hashes #...', () => {
      const input = 'This is #important task';
      const expected = 'This is important task';
      expect(removeLogseqFormatting(input)).toBe(expected);
    });

    it('should remove multiple page links', () => {
      const input = 'See [[Page1]] and [[Page2]]';
      const expected = 'See Page1 and Page2';
      expect(removeLogseqFormatting(input)).toBe(expected);
    });

    it('should remove multiple tags', () => {
      const input = 'Task is #urgent and #important';
      const expected = 'Task is urgent and important';
      expect(removeLogseqFormatting(input)).toBe(expected);
    });

    it('should remove both page links and tags', () => {
      const input = 'Check [[Project]] for #urgent tasks';
      const expected = 'Check Project for urgent tasks';
      expect(removeLogseqFormatting(input)).toBe(expected);
    });

    it('should handle text without formatting', () => {
      const input = 'Plain text without any formatting';
      expect(removeLogseqFormatting(input)).toBe(input);
    });
  });

  describe('extractFirstLine', () => {
    it('should remove marker and Logseq formatting from first line', () => {
      const input = 'TODO Check [[Testpage]] for #urgent details\nSecond line';
      const expected = 'Check Testpage for urgent details';
      expect(extractFirstLine(input)).toBe(expected);
    });

    it('should handle page links in title', () => {
      const input = 'DOING Review [[Project A]] tasks';
      const expected = 'Review Project A tasks';
      expect(extractFirstLine(input)).toBe(expected);
    });

    it('should handle tags in title', () => {
      const input = 'TODO Fix #bug in authentication';
      const expected = 'Fix bug in authentication';
      expect(extractFirstLine(input)).toBe(expected);
    });
  });

  describe('extractBlockText', () => {
    it('should remove marker, properties and Logseq formatting', () => {
      const input = 'TODO Check [[Testpage]] for details\nid:: 123';
      const expected = 'Check Testpage for details';
      expect(extractBlockText(input)).toBe(expected);
    });

    it('should handle tags in block text', () => {
      const input = 'DOING Fix #urgent issue';
      const expected = 'Fix urgent issue';
      expect(extractBlockText(input)).toBe(expected);
    });
  });
});
