import {
  isChecklistItemLine,
  isCheckedItemLine,
  removeCheckedChecklistItems,
  setAllChecklistItemsChecked,
  toggleChecklistItemAtIndex,
} from './checklist-operations';

describe('checklist-operations', () => {
  describe('isChecklistItemLine', () => {
    it('should match unchecked, checked and indented items', () => {
      expect(isChecklistItemLine('- [ ] foo')).toBe(true);
      expect(isChecklistItemLine('- [x] foo')).toBe(true);
      expect(isChecklistItemLine('- [X] foo')).toBe(true);
      expect(isChecklistItemLine('  - [ ] indented')).toBe(true);
    });

    it('should not match anything marked would not render as a checkbox', () => {
      expect(isChecklistItemLine('just text')).toBe(false);
      expect(isChecklistItemLine('- plain bullet')).toBe(false);
      expect(isChecklistItemLine('')).toBe(false);
      // marked renders a checkbox only for "- [marker] <content>" — none of these:
      expect(isChecklistItemLine('- [] no marker')).toBe(false);
      expect(isChecklistItemLine('- [ ]')).toBe(false); // empty, no content
      expect(isChecklistItemLine('- [ ] ')).toBe(false); // empty, trailing space only
      expect(isChecklistItemLine('- [x]nospace')).toBe(false); // no space after the box
    });
  });

  describe('isCheckedItemLine', () => {
    it('should only match checked items with content', () => {
      expect(isCheckedItemLine('- [x] done')).toBe(true);
      expect(isCheckedItemLine('- [X] done')).toBe(true);
      expect(isCheckedItemLine('- [ ] todo')).toBe(false);
      expect(isCheckedItemLine('- [x] ')).toBe(false); // empty, not a rendered checkbox
    });
  });

  describe('setAllChecklistItemsChecked', () => {
    it('should check every item', () => {
      const notes = '- [ ] a\n- [x] b\n- [ ] c';
      expect(setAllChecklistItemsChecked(notes, true)).toBe('- [x] a\n- [x] b\n- [x] c');
    });

    it('should uncheck every item', () => {
      const notes = '- [x] a\n- [ ] b\n- [X] c';
      expect(setAllChecklistItemsChecked(notes, false)).toBe('- [ ] a\n- [ ] b\n- [ ] c');
    });

    it('should leave non-item lines untouched', () => {
      const notes = 'Intro\n- [ ] a\nmid prose\n- [ ] b';
      expect(setAllChecklistItemsChecked(notes, true)).toBe(
        'Intro\n- [x] a\nmid prose\n- [x] b',
      );
    });
  });

  describe('removeCheckedChecklistItems', () => {
    it('should drop only checked items', () => {
      const notes = '- [ ] a\n- [x] b\n- [ ] c\n- [X] d';
      expect(removeCheckedChecklistItems(notes)).toBe('- [ ] a\n- [ ] c');
    });

    it('should keep prose lines', () => {
      const notes = 'Title\n- [x] done\n- [ ] todo';
      expect(removeCheckedChecklistItems(notes)).toBe('Title\n- [ ] todo');
    });
  });

  describe('toggleChecklistItemAtIndex', () => {
    it('should check an unchecked item', () => {
      expect(toggleChecklistItemAtIndex('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b');
    });

    it('should uncheck a checked item', () => {
      expect(toggleChecklistItemAtIndex('- [x] a\n- [ ] b', 0)).toBe('- [ ] a\n- [ ] b');
    });

    it('should uncheck an uppercase [X] item', () => {
      // the old in-component toggle only matched lowercase [x] and left [X] stuck
      expect(toggleChecklistItemAtIndex('- [X] a', 0)).toBe('- [ ] a');
    });

    it('should only flip the checkbox marker, not "[ ]" inside the item text', () => {
      expect(toggleChecklistItemAtIndex('- [x] fix the [ ] placeholder', 0)).toBe(
        '- [ ] fix the [ ] placeholder',
      );
    });

    it('should map the Nth item past interleaved prose and blank lines', () => {
      const notes = 'Intro\n- [ ] a\n\nmid\n- [ ] b';
      expect(toggleChecklistItemAtIndex(notes, 1)).toBe('Intro\n- [ ] a\n\nmid\n- [x] b');
    });

    it('should skip an empty "- [ ] " line that marked does not render as a checkbox', () => {
      // The empty placeholder line is not a rendered checkbox, so checkbox
      // index 0 must map to the real item below it, not the placeholder.
      expect(toggleChecklistItemAtIndex('- [ ] \n- [x] real', 0)).toBe(
        '- [ ] \n- [ ] real',
      );
    });

    it('should return the input unchanged for out-of-range or invalid indices', () => {
      const notes = '- [ ] a\n- [ ] b';
      expect(toggleChecklistItemAtIndex(notes, 5)).toBe(notes);
      expect(toggleChecklistItemAtIndex(notes, -1)).toBe(notes);
      expect(toggleChecklistItemAtIndex(notes, NaN)).toBe(notes);
    });
  });
});
