import {
  extractFirstLine,
  extractBlockText,
  removeLogseqFormatting,
  extractSpDrawerData,
  getContentWithoutSpDrawer,
  updateSpDrawerInContent,
  calculateContentHash,
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

  describe('extractSpDrawerData', () => {
    it('should extract lastSync and contentHash from :SP: drawer', () => {
      const content = `TODO My Task
SCHEDULED: <2026-01-20 Mon>
:SP:
superprod-last-sync:: 1705766400000
superprod-content-hash:: -1234567890
:END:`;

      const result = extractSpDrawerData(content);

      expect(result.lastSync).toBe(1705766400000);
      expect(result.contentHash).toBe(-1234567890);
    });

    it('should return nulls when no :SP: drawer present', () => {
      const content = 'TODO Simple task without drawer';

      const result = extractSpDrawerData(content);

      expect(result.lastSync).toBeNull();
      expect(result.contentHash).toBeNull();
    });

    it('should handle partial drawer data', () => {
      const content = `TODO Task
:SP:
superprod-last-sync:: 1705766400000
:END:`;

      const result = extractSpDrawerData(content);

      expect(result.lastSync).toBe(1705766400000);
      expect(result.contentHash).toBeNull();
    });
  });

  describe('getContentWithoutSpDrawer', () => {
    it('should remove :SP: drawer from content', () => {
      const content = `TODO My Task
SCHEDULED: <2026-01-20 Mon>
:SP:
superprod-last-sync:: 1705766400000
superprod-content-hash:: -1234567890
:END:
Some notes`;

      const result = getContentWithoutSpDrawer(content);

      expect(result).not.toContain(':SP:');
      expect(result).not.toContain('superprod-last-sync');
      expect(result).toContain('TODO My Task');
      expect(result).toContain('Some notes');
    });

    it('should return content unchanged when no drawer present', () => {
      const content = 'TODO Simple task';

      const result = getContentWithoutSpDrawer(content);

      expect(result).toBe('TODO Simple task');
    });
  });

  describe('updateSpDrawerInContent', () => {
    it('should add :SP: drawer after SCHEDULED line', () => {
      const content = `TODO My Task
SCHEDULED: <2026-01-20 Mon>`;

      const result = updateSpDrawerInContent(content, 1705766400000, -123456);

      expect(result).toContain(':SP:');
      expect(result).toContain('superprod-last-sync:: 1705766400000');
      expect(result).toContain('superprod-content-hash:: -123456');
      expect(result).toContain(':END:');
      // Drawer should be after SCHEDULED
      const schedIndex = result.indexOf('SCHEDULED:');
      const drawerIndex = result.indexOf(':SP:');
      expect(drawerIndex).toBeGreaterThan(schedIndex);
    });

    it('should add :SP: drawer after first line when no SCHEDULED', () => {
      const content = 'TODO Simple task';

      const result = updateSpDrawerInContent(content, 1705766400000, -123456);

      expect(result).toContain(':SP:');
      expect(result).toContain('superprod-last-sync:: 1705766400000');
    });

    it('should replace existing :SP: drawer', () => {
      const content = `TODO My Task
:SP:
superprod-last-sync:: 1000000000000
superprod-content-hash:: -999999
:END:`;

      const result = updateSpDrawerInContent(content, 1705766400000, -123456);

      expect(result).toContain('superprod-last-sync:: 1705766400000');
      expect(result).toContain('superprod-content-hash:: -123456');
      expect(result).not.toContain('1000000000000');
      expect(result).not.toContain('-999999');
    });
  });

  describe('calculateContentHash', () => {
    it('should calculate consistent hash for same content', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-20 Mon>';

      const hash1 = calculateContentHash(content);
      const hash2 = calculateContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should ignore :SP: drawer when calculating hash', () => {
      const contentWithoutDrawer = 'TODO My Task\nSCHEDULED: <2026-01-20 Mon>';
      const contentWithDrawer = `TODO My Task
SCHEDULED: <2026-01-20 Mon>
:SP:
superprod-last-sync:: 1705766400000
superprod-content-hash:: -123456
:END:`;

      const hashWithout = calculateContentHash(contentWithoutDrawer);
      const hashWith = calculateContentHash(contentWithDrawer);

      expect(hashWithout).toBe(hashWith);
    });

    it('should produce different hashes for different content', () => {
      const content1 = 'TODO Task A';
      const content2 = 'TODO Task B';

      const hash1 = calculateContentHash(content1);
      const hash2 = calculateContentHash(content2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
