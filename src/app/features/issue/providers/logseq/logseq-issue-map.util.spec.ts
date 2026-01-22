import {
  extractFirstLine,
  extractBlockText,
  removeLogseqFormatting,
  extractSpDrawerData,
  getContentWithoutSpDrawer,
  updateSpDrawerInContent,
  calculateContentHash,
  extractScheduledDate,
  extractScheduledDateTime,
  formatLogseqDate,
  updateScheduledInContent,
  extractRestOfContent,
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
superprod-last-sync: 1705766400000
superprod-content-hash: -1234567890
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
superprod-last-sync: 1705766400000
:END:`;

      const result = extractSpDrawerData(content);

      expect(result.lastSync).toBe(1705766400000);
      expect(result.contentHash).toBeNull();
    });
  });

  describe('getContentWithoutSpDrawer', () => {
    it('should remove :SP: drawer and marker from content', () => {
      const content = `TODO My Task
SCHEDULED: <2026-01-20 Mon>
:SP:
superprod-last-sync: 1705766400000
superprod-content-hash: -1234567890
:END:
Some notes`;

      const result = getContentWithoutSpDrawer(content);

      expect(result).not.toContain(':SP:');
      expect(result).not.toContain('superprod-last-sync');
      expect(result).not.toContain('TODO'); // Marker is also removed
      expect(result).toContain('My Task');
      expect(result).toContain('Some notes');
    });

    it('should remove marker when no drawer present', () => {
      const content = 'TODO Simple task';

      const result = getContentWithoutSpDrawer(content);

      // Function removes both drawers AND marker (for hash calculation)
      expect(result).toBe('Simple task');
    });

    it('should remove all drawer types (LOGBOOK, PROPERTIES)', () => {
      const content = `DOING Task with multiple drawers
:LOGBOOK:
CLOCK: [2026-01-20 Mon 10:00]--[2026-01-20 Mon 11:00] => 01:00
:END:
:SP:
superprod-last-sync: 1705766400000
:END:
Actual content here`;

      const result = getContentWithoutSpDrawer(content);

      expect(result).not.toContain(':LOGBOOK:');
      expect(result).not.toContain(':SP:');
      expect(result).not.toContain('CLOCK:');
      expect(result).toContain('Task with multiple drawers');
      expect(result).toContain('Actual content here');
    });
  });

  describe('updateSpDrawerInContent', () => {
    it('should add :SP: drawer after SCHEDULED line', () => {
      const content = `TODO My Task
SCHEDULED: <2026-01-20 Mon>`;

      const result = updateSpDrawerInContent(content, 1705766400000, -123456);

      expect(result).toContain(':SP:');
      expect(result).toContain('superprod-last-sync: 1705766400000');
      expect(result).toContain('superprod-content-hash: -123456');
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
      expect(result).toContain('superprod-last-sync: 1705766400000');
    });

    it('should replace existing :SP: drawer', () => {
      const content = `TODO My Task
:SP:
superprod-last-sync: 1000000000000
superprod-content-hash: -999999
:END:`;

      const result = updateSpDrawerInContent(content, 1705766400000, -123456);

      expect(result).toContain('superprod-last-sync: 1705766400000');
      expect(result).toContain('superprod-content-hash: -123456');
      expect(result).not.toContain('1000000000000');
      expect(result).not.toContain('-999999');
    });

    it('should work with blocks that have id:: property', () => {
      const content = `TODO My Task
id:: some-uuid`;

      const result = updateSpDrawerInContent(content, 1705766400000, -123456);

      expect(result).toContain(':SP:');
      expect(result).toContain('superprod-last-sync: 1705766400000');
      expect(result).toContain('superprod-content-hash: -123456');
      expect(result).toContain(':END:');
      expect(result).toContain('id:: some-uuid');

      // Drawer should be after title
      const titleIndex = result.indexOf('TODO My Task');
      const drawerIndex = result.indexOf(':SP:');
      expect(drawerIndex).toBeGreaterThan(titleIndex);
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
superprod-last-sync: 1705766400000
superprod-content-hash: -123456
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

  // ============================================================
  // Scheduling Functions
  // ============================================================

  describe('extractScheduledDate', () => {
    it('should extract date from SCHEDULED line', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-20 Mon>';

      const result = extractScheduledDate(content);

      expect(result).toBe('2026-01-20');
    });

    it('should extract date when time is also present', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-20 Mon 14:30>';

      const result = extractScheduledDate(content);

      expect(result).toBe('2026-01-20');
    });

    it('should return null when no SCHEDULED present', () => {
      const content = 'TODO Simple task without schedule';

      const result = extractScheduledDate(content);

      expect(result).toBeNull();
    });
  });

  describe('extractScheduledDateTime', () => {
    it('should extract timestamp when time is present', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-20 Mon 14:30>';

      const result = extractScheduledDateTime(content);

      expect(result).not.toBeNull();
      const date = new Date(result!);
      expect(date.getHours()).toBe(14);
      expect(date.getMinutes()).toBe(30);
    });

    it('should return null when only date is present (no time)', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-20 Mon>';

      const result = extractScheduledDateTime(content);

      expect(result).toBeNull();
    });

    it('should return null when no SCHEDULED present', () => {
      const content = 'TODO Simple task';

      const result = extractScheduledDateTime(content);

      expect(result).toBeNull();
    });
  });

  describe('formatLogseqDate', () => {
    it('should format date string without time', () => {
      const result = formatLogseqDate('2026-01-20');

      expect(result).toMatch(/^<2026-01-20 \w{3}>$/);
      expect(result).not.toMatch(/\d{2}:\d{2}/);
    });

    it('should format timestamp with time', () => {
      const timestamp = new Date('2026-01-20T15:30:00').getTime();

      const result = formatLogseqDate(timestamp);

      expect(result).toMatch(/^<2026-01-20 \w{3} 15:30>$/);
    });
  });

  describe('updateScheduledInContent', () => {
    it('should add SCHEDULED line when none exists', () => {
      const content = 'TODO My Task';

      const result = updateScheduledInContent(content, '2026-01-20');

      expect(result).toContain('SCHEDULED:');
      expect(result).toContain('2026-01-20');
    });

    it('should replace existing SCHEDULED line', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-15 Wed>';

      const result = updateScheduledInContent(content, '2026-01-20');

      expect(result).toContain('2026-01-20');
      expect(result).not.toContain('2026-01-15');
    });

    it('should add time when timestamp is provided', () => {
      const content = 'TODO My Task';
      const timestamp = new Date('2026-01-20T14:30:00').getTime();

      const result = updateScheduledInContent(content, timestamp);

      expect(result).toContain('SCHEDULED:');
      expect(result).toMatch(/14:30/);
    });

    it('should remove SCHEDULED when null is provided', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-15 Wed>';

      const result = updateScheduledInContent(content, null);

      expect(result).not.toContain('SCHEDULED:');
      expect(result).toContain('TODO My Task');
    });
  });

  describe('extractRestOfContent', () => {
    it('should extract content after first line', () => {
      const content = 'TODO My Task\nSome additional notes\nMore details';

      const result = extractRestOfContent(content);

      expect(result).toContain('Some additional notes');
      expect(result).toContain('More details');
    });

    it('should skip SCHEDULED line', () => {
      const content = 'TODO My Task\nSCHEDULED: <2026-01-20 Mon>\nActual notes';

      const result = extractRestOfContent(content);

      expect(result).not.toContain('SCHEDULED');
      expect(result).toContain('Actual notes');
    });

    it('should skip property blocks like :LOGBOOK:', () => {
      const content = `TODO My Task
:LOGBOOK:
CLOCK: [2026-01-20 Mon 10:00]
:END:
Actual content`;

      const result = extractRestOfContent(content);

      expect(result).not.toContain(':LOGBOOK:');
      expect(result).not.toContain('CLOCK:');
      expect(result).toContain('Actual content');
    });

    it('should return empty string for single-line content', () => {
      const content = 'TODO Simple task';

      const result = extractRestOfContent(content);

      expect(result).toBe('');
    });
  });
});
