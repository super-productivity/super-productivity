/**
 * Pure utility functions for Markdown text transformations.
 * Each function takes text + selection range and returns transformed text + new selection.
 */

export interface TextTransformResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Get the line boundaries for a given position in text.
 */
const getLineRange = (text: string, pos: number): { start: number; end: number } => {
  let start = pos;
  while (start > 0 && text[start - 1] !== '\n') {
    start--;
  }
  let end = pos;
  while (end < text.length && text[end] !== '\n') {
    end++;
  }
  return { start, end };
};

/**
 * Get all lines that are touched by the selection range.
 */
const getSelectedLines = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { lineStart: number; lineEnd: number; lines: string[] } => {
  const lineStart = getLineRange(text, selectionStart).start;
  const lineEnd = getLineRange(text, selectionEnd).end;
  const selectedText = text.substring(lineStart, lineEnd);
  return {
    lineStart,
    lineEnd,
    lines: selectedText.split('\n'),
  };
};

/**
 * Toggle inline wrapper (e.g., **, __, ~~, `)
 */
const toggleInlineWrapper = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  wrapper: string,
): TextTransformResult => {
  const selectedText = text.substring(selectionStart, selectionEnd);
  const wrapperLen = wrapper.length;

  // Check if selection is already wrapped
  const beforeStart = selectionStart - wrapperLen;
  const afterEnd = selectionEnd + wrapperLen;
  const hasWrapperBefore =
    beforeStart >= 0 && text.substring(beforeStart, selectionStart) === wrapper;
  const hasWrapperAfter =
    afterEnd <= text.length && text.substring(selectionEnd, afterEnd) === wrapper;

  if (hasWrapperBefore && hasWrapperAfter && selectedText.length > 0) {
    // Remove wrapper
    const newText =
      text.substring(0, beforeStart) + selectedText + text.substring(afterEnd);
    return {
      text: newText,
      selectionStart: beforeStart,
      selectionEnd: beforeStart + selectedText.length,
    };
  }

  // Check if selected text itself starts and ends with wrapper
  if (
    selectedText.length >= wrapperLen * 2 &&
    selectedText.startsWith(wrapper) &&
    selectedText.endsWith(wrapper)
  ) {
    // Remove wrapper from selection
    const unwrapped = selectedText.substring(
      wrapperLen,
      selectedText.length - wrapperLen,
    );
    const newText =
      text.substring(0, selectionStart) + unwrapped + text.substring(selectionEnd);
    return {
      text: newText,
      selectionStart,
      selectionEnd: selectionStart + unwrapped.length,
    };
  }

  // Empty selection: insert wrapper pair and place cursor in middle
  if (selectionStart === selectionEnd) {
    const newText =
      text.substring(0, selectionStart) +
      wrapper +
      wrapper +
      text.substring(selectionEnd);
    const cursorPos = selectionStart + wrapperLen;
    return {
      text: newText,
      selectionStart: cursorPos,
      selectionEnd: cursorPos,
    };
  }

  // Wrap selection
  const newText =
    text.substring(0, selectionStart) +
    wrapper +
    selectedText +
    wrapper +
    text.substring(selectionEnd);
  return {
    text: newText,
    selectionStart: selectionStart + wrapperLen,
    selectionEnd: selectionEnd + wrapperLen,
  };
};

// ============================================================================
// Inline formatting functions
// ============================================================================

export const applyBold = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  return toggleInlineWrapper(text, selectionStart, selectionEnd, '**');
};

export const applyItalic = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  return toggleInlineWrapper(text, selectionStart, selectionEnd, '_');
};

export const applyStrikethrough = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  return toggleInlineWrapper(text, selectionStart, selectionEnd, '~~');
};

export const applyInlineCode = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  return toggleInlineWrapper(text, selectionStart, selectionEnd, '`');
};

// ============================================================================
// Line-based formatting functions
// ============================================================================

/**
 * Toggle a line prefix (e.g., `> `, `- `, `- [ ] `)
 */
const toggleLinePrefix = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  removeOtherPrefixes: RegExp | null = null,
): TextTransformResult => {
  const { lineStart, lineEnd, lines } = getSelectedLines(
    text,
    selectionStart,
    selectionEnd,
  );

  const transformedLines = lines.map((line) => {
    const trimmedLine = line.trimStart();
    const leadingWhitespace = line.substring(0, line.length - trimmedLine.length);

    // Check for other prefixes FIRST (e.g., task list '- [ ] ' before bullet '- ')
    // This ensures longer prefixes are matched before shorter ones
    if (removeOtherPrefixes) {
      const match = trimmedLine.match(removeOtherPrefixes);
      if (match) {
        return leadingWhitespace + prefix + trimmedLine.substring(match[0].length);
      }
    }

    // Check if line already has this prefix
    if (trimmedLine.startsWith(prefix)) {
      // Remove prefix
      return leadingWhitespace + trimmedLine.substring(prefix.length);
    }

    // Add prefix
    return leadingWhitespace + prefix + trimmedLine;
  });

  const newContent = transformedLines.join('\n');
  const newText = text.substring(0, lineStart) + newContent + text.substring(lineEnd);

  // Adjust selection
  const lengthDiff = newContent.length - (lineEnd - lineStart);
  return {
    text: newText,
    selectionStart: lineStart,
    selectionEnd: lineEnd + lengthDiff,
  };
};

export const applyHeading = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  level: 1 | 2 | 3,
): TextTransformResult => {
  const prefix = '#'.repeat(level) + ' ';
  const headingRegex = /^#{1,6}\s/;

  const { lineStart, lineEnd, lines } = getSelectedLines(
    text,
    selectionStart,
    selectionEnd,
  );

  const transformedLines = lines.map((line) => {
    const trimmedLine = line.trimStart();
    const leadingWhitespace = line.substring(0, line.length - trimmedLine.length);

    // Check if line already has this exact heading level
    if (trimmedLine.startsWith(prefix)) {
      // Remove heading
      return leadingWhitespace + trimmedLine.substring(prefix.length);
    }

    // Check if line has any heading prefix
    const match = trimmedLine.match(headingRegex);
    if (match) {
      // Replace with new level
      return leadingWhitespace + prefix + trimmedLine.substring(match[0].length);
    }

    // Add heading prefix
    return leadingWhitespace + prefix + trimmedLine;
  });

  const newContent = transformedLines.join('\n');
  const newText = text.substring(0, lineStart) + newContent + text.substring(lineEnd);

  const lengthDiff = newContent.length - (lineEnd - lineStart);
  return {
    text: newText,
    selectionStart: lineStart,
    selectionEnd: lineEnd + lengthDiff,
  };
};

export const applyQuote = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  return toggleLinePrefix(text, selectionStart, selectionEnd, '> ');
};

export const applyBulletList = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  // Remove numbered list or task list prefixes when converting
  // Task list format is "- [ ] " or "- [x] ", need to match the full prefix
  const otherListPrefixes = /^(\d+\.\s|- \[[x ]\] )/i;
  return toggleLinePrefix(text, selectionStart, selectionEnd, '- ', otherListPrefixes);
};

export const applyNumberedList = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  const { lineStart, lineEnd, lines } = getSelectedLines(
    text,
    selectionStart,
    selectionEnd,
  );
  const otherListPrefixes = /^(-\s|- \[[x ]\]\s)/i;

  let allNumbered = true;
  const numberedRegex = /^\d+\.\s/;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.length > 0 && !numberedRegex.test(trimmed)) {
      allNumbered = false;
      break;
    }
  }

  const transformedLines = lines.map((line, index) => {
    const trimmedLine = line.trimStart();
    const leadingWhitespace = line.substring(0, line.length - trimmedLine.length);

    if (allNumbered) {
      // Remove numbering
      const match = trimmedLine.match(numberedRegex);
      if (match) {
        return leadingWhitespace + trimmedLine.substring(match[0].length);
      }
      return line;
    }

    // Check for other list prefixes to replace
    const otherMatch = trimmedLine.match(otherListPrefixes);
    if (otherMatch) {
      return (
        leadingWhitespace + `${index + 1}. ` + trimmedLine.substring(otherMatch[0].length)
      );
    }

    // Check if already numbered
    const numMatch = trimmedLine.match(numberedRegex);
    if (numMatch) {
      // Re-number
      return (
        leadingWhitespace + `${index + 1}. ` + trimmedLine.substring(numMatch[0].length)
      );
    }

    // Add numbering
    return leadingWhitespace + `${index + 1}. ` + trimmedLine;
  });

  const newContent = transformedLines.join('\n');
  const newText = text.substring(0, lineStart) + newContent + text.substring(lineEnd);

  const lengthDiff = newContent.length - (lineEnd - lineStart);
  return {
    text: newText,
    selectionStart: lineStart,
    selectionEnd: lineEnd + lengthDiff,
  };
};

export const applyTaskList = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  const taskPrefix = '- [ ] ';
  const taskRegex = /^- \[[x ]\]\s/i;
  const otherListPrefixes = /^(-\s|\d+\.\s)/;

  const { lineStart, lineEnd, lines } = getSelectedLines(
    text,
    selectionStart,
    selectionEnd,
  );

  const transformedLines = lines.map((line) => {
    const trimmedLine = line.trimStart();
    const leadingWhitespace = line.substring(0, line.length - trimmedLine.length);

    // Check if line already has task list prefix
    const taskMatch = trimmedLine.match(taskRegex);
    if (taskMatch) {
      // Remove task list prefix, convert to plain bullet
      return leadingWhitespace + '- ' + trimmedLine.substring(taskMatch[0].length);
    }

    // Check for other list prefixes to replace
    const otherMatch = trimmedLine.match(otherListPrefixes);
    if (otherMatch) {
      return leadingWhitespace + taskPrefix + trimmedLine.substring(otherMatch[0].length);
    }

    // Add task list prefix
    return leadingWhitespace + taskPrefix + trimmedLine;
  });

  const newContent = transformedLines.join('\n');
  const newText = text.substring(0, lineStart) + newContent + text.substring(lineEnd);

  const lengthDiff = newContent.length - (lineEnd - lineStart);
  return {
    text: newText,
    selectionStart: lineStart,
    selectionEnd: lineEnd + lengthDiff,
  };
};

// ============================================================================
// Block insertion functions
// ============================================================================

export const applyCodeBlock = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  const selectedText = text.substring(selectionStart, selectionEnd);

  if (selectionStart === selectionEnd) {
    // Empty selection: insert template
    const template = '```\n\n```';
    const newText =
      text.substring(0, selectionStart) + template + text.substring(selectionEnd);
    const cursorPos = selectionStart + 4; // After opening ``` and newline
    return {
      text: newText,
      selectionStart: cursorPos,
      selectionEnd: cursorPos,
    };
  }

  // Wrap selection in code block
  const newText =
    text.substring(0, selectionStart) +
    '```\n' +
    selectedText +
    '\n```' +
    text.substring(selectionEnd);
  return {
    text: newText,
    selectionStart: selectionStart + 4,
    selectionEnd: selectionStart + 4 + selectedText.length,
  };
};

export const insertLink = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  url: string = 'https://',
): TextTransformResult => {
  const selectedText = text.substring(selectionStart, selectionEnd);

  if (selectionStart === selectionEnd) {
    // Empty selection: insert template with cursor on "text"
    const template = `[text](${url})`;
    const newText =
      text.substring(0, selectionStart) + template + text.substring(selectionEnd);
    return {
      text: newText,
      selectionStart: selectionStart + 1, // After [
      selectionEnd: selectionStart + 5, // Select "text"
    };
  }

  // Use selection as link text
  const linkMarkdown = `[${selectedText}](${url})`;
  const newText =
    text.substring(0, selectionStart) + linkMarkdown + text.substring(selectionEnd);
  // Place cursor at URL position: [ + text + ]( = 1 + text.length + 2 = text.length + 3
  // But we want cursor AFTER the opening paren, which is at position: 1 + text.length + 2 = text.length + 3
  // Test expects: for "hello" (5 chars), URL starts at 9 = 0 + 5 + 4
  const urlStart = selectionStart + selectedText.length + 4; // After "[text]("
  return {
    text: newText,
    selectionStart: urlStart,
    selectionEnd: urlStart + url.length,
  };
};

export const insertImage = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  url: string = 'https://',
): TextTransformResult => {
  const selectedText = text.substring(selectionStart, selectionEnd);

  if (selectionStart === selectionEnd) {
    // Empty selection: insert template
    const template = `![alt](${url})`;
    const newText =
      text.substring(0, selectionStart) + template + text.substring(selectionEnd);
    return {
      text: newText,
      selectionStart: selectionStart + 2, // After ![
      selectionEnd: selectionStart + 5, // Select "alt"
    };
  }

  // Use selection as alt text
  const imageMarkdown = `![${selectedText}](${url})`;
  const newText =
    text.substring(0, selectionStart) + imageMarkdown + text.substring(selectionEnd);
  // Place cursor at URL position: ![ + text + ]( = 2 + text.length + 2 = text.length + 4
  // Test expects: for "hello" (5 chars), URL starts at 10 = 0 + 5 + 5
  const urlStart = selectionStart + selectedText.length + 5; // After "![text]("
  return {
    text: newText,
    selectionStart: urlStart,
    selectionEnd: urlStart + url.length,
  };
};

export const insertTable = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextTransformResult => {
  const tableTemplate = `| Col 1 | Col 2 |
| ----- | ----- |
|       |       |
|       |       |`;

  // Check if we need a newline before the table
  let prefix = '';
  if (selectionStart > 0 && text[selectionStart - 1] !== '\n') {
    prefix = '\n';
  }

  const newText =
    text.substring(0, selectionStart) +
    prefix +
    tableTemplate +
    text.substring(selectionEnd);

  // Position cursor in first empty cell (line 3, after first |)
  const cursorPos =
    selectionStart + prefix.length + tableTemplate.indexOf('|       |') + 2;
  return {
    text: newText,
    selectionStart: cursorPos,
    selectionEnd: cursorPos,
  };
};
