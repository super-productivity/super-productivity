import {
  applyBold,
  applyBulletList,
  applyCodeBlock,
  applyHeading,
  applyInlineCode,
  applyItalic,
  applyNumberedList,
  applyQuote,
  applyStrikethrough,
  applyTaskList,
  handleEnterKey,
  handleListKeydown,
  handleShiftTabKey,
  handleTabKey,
  insertImage,
  insertLink,
  insertTable,
} from './markdown-toolbar.util';

describe('markdown-toolbar.util', () => {
  // =========================================================================
  // Inline formatting tests
  // =========================================================================

  describe('applyBold', () => {
    it('should wrap selected text with **', () => {
      const result = applyBold('hello world', 0, 5);
      expect(result.text).toBe('**hello** world');
      expect(result.selectionStart).toBe(2);
      expect(result.selectionEnd).toBe(7);
    });

    it('should remove ** wrapper if already wrapped', () => {
      const result = applyBold('**hello** world', 2, 7);
      expect(result.text).toBe('hello world');
      expect(result.selectionStart).toBe(0);
      expect(result.selectionEnd).toBe(5);
    });

    it('should insert **** with cursor in middle when selection is empty', () => {
      const result = applyBold('hello world', 5, 5);
      expect(result.text).toBe('hello**** world');
      expect(result.selectionStart).toBe(7);
      expect(result.selectionEnd).toBe(7);
    });

    it('should remove wrapper if selected text starts and ends with **', () => {
      const result = applyBold('**hello**', 0, 9);
      expect(result.text).toBe('hello');
      expect(result.selectionStart).toBe(0);
      expect(result.selectionEnd).toBe(5);
    });
  });

  describe('applyItalic', () => {
    it('should wrap selected text with _', () => {
      const result = applyItalic('hello world', 0, 5);
      expect(result.text).toBe('_hello_ world');
      expect(result.selectionStart).toBe(1);
      expect(result.selectionEnd).toBe(6);
    });

    it('should insert __ with cursor in middle when selection is empty', () => {
      const result = applyItalic('hello', 5, 5);
      expect(result.text).toBe('hello__');
      expect(result.selectionStart).toBe(6);
      expect(result.selectionEnd).toBe(6);
    });
  });

  describe('applyStrikethrough', () => {
    it('should wrap selected text with ~~', () => {
      const result = applyStrikethrough('hello world', 0, 5);
      expect(result.text).toBe('~~hello~~ world');
      expect(result.selectionStart).toBe(2);
      expect(result.selectionEnd).toBe(7);
    });
  });

  describe('applyInlineCode', () => {
    it('should wrap selected text with `', () => {
      const result = applyInlineCode('hello world', 0, 5);
      expect(result.text).toBe('`hello` world');
      expect(result.selectionStart).toBe(1);
      expect(result.selectionEnd).toBe(6);
    });
  });

  // =========================================================================
  // Line-based formatting tests
  // =========================================================================

  describe('applyHeading', () => {
    it('should add # prefix for H1', () => {
      const result = applyHeading('hello world', 0, 11, 1);
      expect(result.text).toBe('# hello world');
    });

    it('should add ## prefix for H2', () => {
      const result = applyHeading('hello world', 0, 11, 2);
      expect(result.text).toBe('## hello world');
    });

    it('should add ### prefix for H3', () => {
      const result = applyHeading('hello world', 0, 11, 3);
      expect(result.text).toBe('### hello world');
    });

    it('should remove heading if same level already exists', () => {
      const result = applyHeading('# hello world', 0, 13, 1);
      expect(result.text).toBe('hello world');
    });

    it('should replace heading level', () => {
      const result = applyHeading('# hello world', 0, 13, 2);
      expect(result.text).toBe('## hello world');
    });

    it('should handle multiple lines', () => {
      const result = applyHeading('line one\nline two', 0, 17, 1);
      expect(result.text).toBe('# line one\n# line two');
    });
  });

  describe('applyQuote', () => {
    it('should add > prefix', () => {
      const result = applyQuote('hello world', 0, 11);
      expect(result.text).toBe('> hello world');
    });

    it('should remove > prefix if already quoted', () => {
      const result = applyQuote('> hello world', 0, 13);
      expect(result.text).toBe('hello world');
    });

    it('should handle multiple lines', () => {
      const result = applyQuote('line one\nline two', 0, 17);
      expect(result.text).toBe('> line one\n> line two');
    });
  });

  describe('applyBulletList', () => {
    it('should add - prefix', () => {
      const result = applyBulletList('hello world', 0, 11);
      expect(result.text).toBe('- hello world');
    });

    it('should remove - prefix if already a bullet', () => {
      const result = applyBulletList('- hello world', 0, 13);
      expect(result.text).toBe('hello world');
    });

    it('should convert numbered list to bullet list', () => {
      const result = applyBulletList('1. hello world', 0, 14);
      expect(result.text).toBe('- hello world');
    });

    it('should convert task list to bullet list', () => {
      const result = applyBulletList('- [ ] hello world', 0, 17);
      expect(result.text).toBe('- hello world');
    });
  });

  describe('applyNumberedList', () => {
    it('should add numbered prefix', () => {
      const result = applyNumberedList('hello world', 0, 11);
      expect(result.text).toBe('1. hello world');
    });

    it('should remove numbering if all lines are numbered', () => {
      const result = applyNumberedList('1. hello', 0, 8);
      expect(result.text).toBe('hello');
    });

    it('should number multiple lines sequentially', () => {
      const result = applyNumberedList('one\ntwo\nthree', 0, 13);
      expect(result.text).toBe('1. one\n2. two\n3. three');
    });

    it('should convert bullet list to numbered list', () => {
      const result = applyNumberedList('- hello', 0, 7);
      expect(result.text).toBe('1. hello');
    });
  });

  describe('applyTaskList', () => {
    it('should add - [ ] prefix', () => {
      const result = applyTaskList('hello world', 0, 11);
      expect(result.text).toBe('- [ ] hello world');
    });

    it('should convert task list back to bullet list', () => {
      const result = applyTaskList('- [ ] hello world', 0, 17);
      expect(result.text).toBe('- hello world');
    });

    it('should convert bullet list to task list', () => {
      const result = applyTaskList('- hello world', 0, 13);
      expect(result.text).toBe('- [ ] hello world');
    });

    it('should convert numbered list to task list', () => {
      const result = applyTaskList('1. hello world', 0, 14);
      expect(result.text).toBe('- [ ] hello world');
    });
  });

  // =========================================================================
  // Block insertion tests
  // =========================================================================

  describe('applyCodeBlock', () => {
    it('should insert empty code block template with cursor inside', () => {
      const result = applyCodeBlock('hello', 5, 5);
      expect(result.text).toBe('hello```\n\n```');
      expect(result.selectionStart).toBe(9); // After ``` and newline
      expect(result.selectionEnd).toBe(9);
    });

    it('should wrap selection in code block', () => {
      const result = applyCodeBlock('hello world', 0, 5);
      expect(result.text).toBe('```\nhello\n``` world');
      expect(result.selectionStart).toBe(4);
      expect(result.selectionEnd).toBe(9);
    });
  });

  describe('insertLink', () => {
    it('should insert link template when selection is empty', () => {
      const result = insertLink('hello', 5, 5);
      expect(result.text).toBe('hello[text](https://)');
      expect(result.selectionStart).toBe(6); // After [
      expect(result.selectionEnd).toBe(10); // "text" selected
    });

    it('should use selection as link text', () => {
      const result = insertLink('hello world', 0, 5);
      expect(result.text).toBe('[hello](https://) world');
      expect(result.selectionStart).toBe(9); // URL position
      expect(result.selectionEnd).toBe(17); // URL selected
    });
  });

  describe('insertImage', () => {
    it('should insert image template when selection is empty', () => {
      const result = insertImage('hello', 5, 5);
      expect(result.text).toBe('hello![alt](https://)');
      expect(result.selectionStart).toBe(7); // After ![
      expect(result.selectionEnd).toBe(10); // "alt" selected
    });

    it('should use selection as alt text', () => {
      const result = insertImage('hello world', 0, 5);
      expect(result.text).toBe('![hello](https://) world');
      expect(result.selectionStart).toBe(10); // URL position
      expect(result.selectionEnd).toBe(18); // URL selected
    });
  });

  describe('insertTable', () => {
    it('should insert table template', () => {
      const result = insertTable('hello', 5, 5);
      expect(result.text).toContain('| Col 1 | Col 2 |');
      expect(result.text).toContain('| ----- | ----- |');
    });

    it('should add newline before table if not at start of line', () => {
      const result = insertTable('hello', 5, 5);
      expect(result.text.startsWith('hello\n|')).toBe(true);
    });
  });

  // =========================================================================
  // Edge case tests
  // =========================================================================

  describe('edge cases - empty string input', () => {
    it('applyBold should handle empty string', () => {
      const result = applyBold('', 0, 0);
      expect(result.text).toBe('****');
      expect(result.selectionStart).toBe(2);
      expect(result.selectionEnd).toBe(2);
    });

    it('applyItalic should handle empty string', () => {
      const result = applyItalic('', 0, 0);
      expect(result.text).toBe('__');
      expect(result.selectionStart).toBe(1);
      expect(result.selectionEnd).toBe(1);
    });

    it('applyHeading should handle empty string', () => {
      const result = applyHeading('', 0, 0, 1);
      expect(result.text).toBe('# ');
    });

    it('applyBulletList should handle empty string', () => {
      const result = applyBulletList('', 0, 0);
      expect(result.text).toBe('- ');
    });

    it('insertLink should handle empty string', () => {
      const result = insertLink('', 0, 0);
      expect(result.text).toBe('[text](https://)');
    });
  });

  describe('edge cases - cursor at beginning/end', () => {
    it('applyBold at beginning should wrap first word', () => {
      const result = applyBold('hello world', 0, 0);
      expect(result.text).toBe('****hello world');
      expect(result.selectionStart).toBe(2);
      expect(result.selectionEnd).toBe(2);
    });

    it('applyBold at end should insert markers at end', () => {
      const result = applyBold('hello world', 11, 11);
      expect(result.text).toBe('hello world****');
      expect(result.selectionStart).toBe(13);
      expect(result.selectionEnd).toBe(13);
    });

    it('applyHeading at beginning should add prefix', () => {
      const result = applyHeading('hello', 0, 0, 1);
      expect(result.text).toBe('# hello');
    });

    it('insertLink at end should append link', () => {
      const result = insertLink('hello', 5, 5);
      expect(result.text).toBe('hello[text](https://)');
    });
  });

  describe('edge cases - multi-line selections for inline formatting', () => {
    it('applyBold on multi-line selection should wrap entire selection', () => {
      const result = applyBold('hello\nworld', 0, 11);
      expect(result.text).toBe('**hello\nworld**');
    });

    it('applyItalic on multi-line selection should wrap entire selection', () => {
      const result = applyItalic('hello\nworld', 0, 11);
      expect(result.text).toBe('_hello\nworld_');
    });

    it('applyInlineCode on multi-line selection should wrap entire selection', () => {
      const result = applyInlineCode('hello\nworld', 0, 11);
      expect(result.text).toBe('`hello\nworld`');
    });
  });

  describe('edge cases - nested formatting', () => {
    it('applyBold inside list item should work', () => {
      const result = applyBold('- hello world', 2, 7);
      expect(result.text).toBe('- **hello** world');
    });

    it('applyItalic inside quoted text should work', () => {
      const result = applyItalic('> hello world', 2, 7);
      expect(result.text).toBe('> _hello_ world');
    });

    it('applyBold inside heading should work', () => {
      const result = applyBold('# hello world', 2, 7);
      expect(result.text).toBe('# **hello** world');
    });

    it('applyBulletList on already formatted text should preserve formatting', () => {
      const result = applyBulletList('**bold text**', 0, 13);
      expect(result.text).toBe('- **bold text**');
    });
  });

  describe('handleEnterKey', () => {
    it('should return null when no list prefix', () => {
      const result = handleEnterKey('hello world', 5, 5);
      expect(result).toBeNull();
    });

    it('should return null when selection spans multiple characters', () => {
      const result = handleEnterKey('- [ ] hello', 0, 5);
      expect(result).toBeNull();
    });

    it('should return null when cursor is before prefix end', () => {
      const result = handleEnterKey('- [ ] hello', 2, 2);
      expect(result).toBeNull();
    });

    it('should continue checkbox with unchecked prefix', () => {
      const text = '- [ ] Buy milk';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [ ] Buy milk\n- [ ] ');
      expect(result!.selectionStart).toBe(21);
      expect(result!.selectionEnd).toBe(21);
    });

    it('should continue checked checkbox with unchecked prefix', () => {
      const text = '- [x] Done';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [x] Done\n- [ ] ');
      expect(result!.selectionStart).toBe(17);
    });

    it('should continue bullet list', () => {
      const text = '- Buy milk';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- Buy milk\n- ');
      expect(result!.selectionStart).toBe(13);
    });

    it('should continue numbered list with auto-increment', () => {
      const text = '3. Buy milk';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('3. Buy milk\n4. ');
      expect(result!.selectionStart).toBe(15);
    });

    it('should handle multi-digit number increment', () => {
      const text = '9. item';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('9. item\n10. ');
      expect(result!.selectionStart).toBe(12);
    });

    it('should degrade empty checkbox to bullet', () => {
      const text = '- [ ] ';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- ');
      expect(result!.selectionStart).toBe(2);
    });

    it('should degrade empty checked checkbox to bullet', () => {
      const text = '- [x] ';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- ');
      expect(result!.selectionStart).toBe(2);
    });

    it('should degrade empty bullet to blank line', () => {
      const text = '- ';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('');
      expect(result!.selectionStart).toBe(0);
    });

    it('should degrade empty numbered list to blank line', () => {
      const text = '1. ';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('');
      expect(result!.selectionStart).toBe(0);
    });

    it('should preserve indentation on continuation', () => {
      const text = '  - [ ] Buy milk';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('  - [ ] Buy milk\n  - [ ] ');
      expect(result!.selectionStart).toBe(25);
    });

    it('should preserve indentation on degradation', () => {
      const text = '  - [ ] ';
      const result = handleEnterKey(text, text.length, text.length);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('  - ');
      expect(result!.selectionStart).toBe(4);
    });

    it('should split line when cursor is in the middle', () => {
      const text = '- [ ] Buy milk';
      const result = handleEnterKey(text, 10, 10); // cursor after "Buy "
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [ ] Buy \n- [ ] milk');
      expect(result!.selectionStart).toBe(17);
    });

    it('should handle Enter in middle of multi-line text', () => {
      const text = 'line 1\n- [ ] Buy milk\nline 3';
      const cursor = 7 + 14; // end of "- [ ] Buy milk"
      const result = handleEnterKey(text, cursor, cursor);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('line 1\n- [ ] Buy milk\n- [ ] \nline 3');
    });

    it('should degrade empty bullet in middle of text', () => {
      const text = '- [ ] task\n- \nline 3';
      const cursor = 13; // end of "- " on line 2
      const result = handleEnterKey(text, cursor, cursor);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [ ] task\n\nline 3');
      expect(result!.selectionStart).toBe(11);
    });
  });

  describe('handleTabKey', () => {
    it('should return null when no list prefix', () => {
      const result = handleTabKey('hello world', 0, 0);
      expect(result).toBeNull();
    });

    it('should return null when selection spans multiple characters', () => {
      const result = handleTabKey('- hello', 0, 3);
      expect(result).toBeNull();
    });

    it('should indent when cursor at position 0 of list line', () => {
      const text = '- [ ] task';
      const result = handleTabKey(text, 0, 0);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('  - [ ] task');
      expect(result!.selectionStart).toBe(2);
    });

    it('should indent when cursor at prefix end with no content', () => {
      const text = '- [ ] ';
      const result = handleTabKey(text, 6, 6);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('  - [ ] ');
      expect(result!.selectionStart).toBe(8);
    });

    it('should return null when cursor is in content text', () => {
      const text = '- [ ] hello';
      const result = handleTabKey(text, 8, 8);
      expect(result).toBeNull();
    });

    it('should return null when cursor at prefix end but content exists', () => {
      const text = '- [ ] hello';
      const result = handleTabKey(text, 6, 6);
      expect(result).toBeNull();
    });

    it('should indent bullet list at position 0', () => {
      const text = '- item';
      const result = handleTabKey(text, 0, 0);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('  - item');
      expect(result!.selectionStart).toBe(2);
    });

    it('should indent numbered list at prefix end with no content', () => {
      const text = '1. ';
      const result = handleTabKey(text, 3, 3);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('  1. ');
      expect(result!.selectionStart).toBe(5);
    });

    it('should stack indentation', () => {
      const text = '  - [ ] ';
      const result = handleTabKey(text, 8, 8);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('    - [ ] ');
      expect(result!.selectionStart).toBe(10);
    });
  });

  describe('handleShiftTabKey', () => {
    it('should return null when no list prefix', () => {
      const result = handleShiftTabKey('hello world', 0, 0);
      expect(result).toBeNull();
    });

    it('should return null when selection spans multiple characters', () => {
      const result = handleShiftTabKey('  - hello', 0, 3);
      expect(result).toBeNull();
    });

    it('should return null when no leading whitespace', () => {
      const result = handleShiftTabKey('- [ ] task', 6, 6);
      expect(result).toBeNull();
    });

    it('should remove 2 spaces of indentation', () => {
      const text = '  - [ ] task';
      const result = handleShiftTabKey(text, 8, 8);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [ ] task');
      expect(result!.selectionStart).toBe(6);
    });

    it('should remove only 1 space when only 1 exists', () => {
      const text = ' - [ ] task';
      const result = handleShiftTabKey(text, 7, 7);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [ ] task');
      expect(result!.selectionStart).toBe(6);
    });

    it('should not move cursor before line start', () => {
      const text = '  - task';
      const result = handleShiftTabKey(text, 1, 1);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- task');
      expect(result!.selectionStart).toBe(0);
    });

    it('should un-indent in middle of multi-line text', () => {
      const text = 'line 1\n  - task\nline 3';
      const cursor = 7 + 4; // position within "  - task"
      const result = handleShiftTabKey(text, cursor, cursor);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('line 1\n- task\nline 3');
    });
  });

  describe('handleListKeydown', () => {
    it('should dispatch Enter to handleEnterKey', () => {
      const text = '- [ ] task';
      const result = handleListKeydown(
        text,
        text.length,
        text.length,
        'Enter',
        false,
        false,
      );
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [ ] task\n- [ ] ');
    });

    it('should dispatch Tab to handleTabKey', () => {
      const text = '- [ ] ';
      const result = handleListKeydown(text, 6, 6, 'Tab', false, false);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('  - [ ] ');
    });

    it('should dispatch Shift+Tab to handleShiftTabKey', () => {
      const text = '  - [ ] task';
      const result = handleListKeydown(text, 8, 8, 'Tab', true, false);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('- [ ] task');
    });

    it('should return null for Ctrl+Enter', () => {
      const text = '- [ ] task';
      const result = handleListKeydown(
        text,
        text.length,
        text.length,
        'Enter',
        false,
        true,
      );
      expect(result).toBeNull();
    });

    it('should return null for unrelated keys', () => {
      const result = handleListKeydown('- [ ] task', 6, 6, 'a', false, false);
      expect(result).toBeNull();
    });

    it('should return null for Shift+Enter', () => {
      const text = '- [ ] task';
      const result = handleListKeydown(
        text,
        text.length,
        text.length,
        'Enter',
        true,
        false,
      );
      expect(result).toBeNull();
    });

    it('should return null for Meta+Enter (macOS Cmd)', () => {
      const text = '- [ ] task';
      const result = handleListKeydown(
        text,
        text.length,
        text.length,
        'Enter',
        false,
        false,
        true,
      );
      expect(result).toBeNull();
    });
  });
});
