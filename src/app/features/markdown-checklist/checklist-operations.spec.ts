import {
  isChecklistItemLine,
  isCheckedItemLine,
  moveChecklistItem,
  removeCheckedChecklistItems,
  setAllChecklistItemsChecked,
} from './checklist-operations';

describe('checklist-operations', () => {
  describe('isChecklistItemLine', () => {
    it('should match unchecked, checked and indented items', () => {
      expect(isChecklistItemLine('- [ ] foo')).toBe(true);
      expect(isChecklistItemLine('- [x] foo')).toBe(true);
      expect(isChecklistItemLine('- [X] foo')).toBe(true);
      expect(isChecklistItemLine('  - [ ] indented')).toBe(true);
      expect(isChecklistItemLine('- [] no space')).toBe(true);
    });

    it('should not match prose or plain bullets', () => {
      expect(isChecklistItemLine('just text')).toBe(false);
      expect(isChecklistItemLine('- plain bullet')).toBe(false);
      expect(isChecklistItemLine('')).toBe(false);
    });
  });

  describe('isCheckedItemLine', () => {
    it('should only match checked items', () => {
      expect(isCheckedItemLine('- [x] done')).toBe(true);
      expect(isCheckedItemLine('- [X] done')).toBe(true);
      expect(isCheckedItemLine('- [ ] todo')).toBe(false);
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

  describe('moveChecklistItem', () => {
    it('should move an item down', () => {
      const notes = '- [ ] a\n- [ ] b\n- [ ] c';
      expect(moveChecklistItem(notes, 0, 2)).toBe('- [ ] b\n- [ ] c\n- [ ] a');
    });

    it('should move an item up', () => {
      const notes = '- [ ] a\n- [x] b\n- [ ] c';
      expect(moveChecklistItem(notes, 2, 0)).toBe('- [ ] c\n- [ ] a\n- [x] b');
    });

    it('should preserve interleaved prose slots', () => {
      // Items occupy lines 1 and 3; prose stays on lines 0 and 2.
      const notes = 'Intro\n- [ ] a\nmid\n- [x] b';
      expect(moveChecklistItem(notes, 0, 1)).toBe('Intro\n- [x] b\nmid\n- [ ] a');
    });

    it('should return input unchanged for no-op or out-of-range moves', () => {
      const notes = '- [ ] a\n- [ ] b';
      expect(moveChecklistItem(notes, 1, 1)).toBe(notes);
      expect(moveChecklistItem(notes, 0, 5)).toBe(notes);
      expect(moveChecklistItem(notes, -1, 0)).toBe(notes);
    });
  });
});
