export interface ParsedMarkdownTask {
  title: string;
  isCompleted: boolean;
  notes?: string;
  subTasks?: ParsedMarkdownSubTask[];
}

export interface ParsedMarkdownSubTask {
  title: string;
  isCompleted: boolean;
  notes?: string;
}

export interface MarkdownTaskStructure {
  mainTasks: ParsedMarkdownTask[];
  totalSubTasks: number;
}

export interface SectionWithTasks {
  sectionTitle: string | null; // null for "No Section"
  tasks: ParsedMarkdownTask[];
}

export interface MarkdownWithSections {
  sections: SectionWithTasks[];
  hasHeaders: boolean;
}


interface ParsedLine {
  indentLevel: number;
  content: string;
  isCompleted: boolean;
  isTaskLine: boolean;
  originalLine: string;
}

const parseLineStructure = (line: string): ParsedLine | null => {
  // Calculate indentation level (count leading spaces/tabs)
  const indentMatch = line.match(/^(\s*)/);
  let indentLevel = 0;
  if (indentMatch && indentMatch[1]) {
    const whitespace = indentMatch[1];
    // Count tabs as 1 level each, spaces as 1 level per 2 spaces
    const tabCount = (whitespace.match(/\t/g) || []).length;
    const spaceCount = (whitespace.match(/ /g) || []).length;
    indentLevel = tabCount + Math.floor(spaceCount / 2);
  }

  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) {
    return null;
  }

  // Check for checkbox list items: - [ ] or - [x]
  const checkboxMatch = trimmedLine.match(/^-\s*\[([ x])\]\s*(.+)$/);
  if (checkboxMatch) {
    return {
      indentLevel,
      content: checkboxMatch[2].trim(),
      isCompleted: checkboxMatch[1] === 'x',
      isTaskLine: true,
      originalLine: line,
    };
  }

  // Check for bullet list items: - or *
  const bulletMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
  if (bulletMatch) {
    return {
      indentLevel,
      content: bulletMatch[1].trim(),
      isCompleted: false,
      isTaskLine: true,
      originalLine: line,
    };
  }

  return null;
};

const buildNotesFromNestedItems = (nestedItems: ParsedLine[]): string => {
  return nestedItems
    .map((item) => {
      // Calculate leading whitespace from original line
      const leadingWhitespace = item.originalLine.match(/^(\s*)/)?.[1] || '';

      // Convert to checkbox format
      const checkboxFormat = item.isCompleted ? '[x]' : '[ ]';

      // Build the standardized line
      return `${leadingWhitespace}- ${checkboxFormat} ${item.content}`;
    })
    .join('\n');
};

export const convertToMarkdownNotes = (text: string): string | null => {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const convertedLines: string[] = [];

  for (const line of lines) {
    const parsed = parseLineStructure(line);
    if (parsed) {
      // Calculate leading whitespace from original line
      const leadingWhitespace = parsed.originalLine.match(/^(\s*)/)?.[1] || '';

      // Convert to checkbox format
      const checkboxFormat = parsed.isCompleted ? '[x]' : '[ ]';

      // Build the standardized line
      convertedLines.push(`${leadingWhitespace}- ${checkboxFormat} ${parsed.content}`);
    } else {
      // If we encounter a line that doesn't match our patterns, return null
      return null;
    }
  }

  return convertedLines.length > 0 ? convertedLines.join('\n') : null;
};

export const parseMarkdownTasksWithStructure = (
  text: string,
): MarkdownTaskStructure | null => {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const parsedLines: ParsedLine[] = [];

  // Parse all lines first
  for (const line of lines) {
    const parsed = parseLineStructure(line);
    if (parsed) {
      parsedLines.push(parsed);
    } else {
      // If we encounter a line that doesn't match our patterns, it's not a valid task list
      return null;
    }
  }

  if (parsedLines.length === 0) {
    return null;
  }

  // Find the minimum indentation level to normalize
  const minIndentLevel = Math.min(...parsedLines.map((line) => line.indentLevel));

  // Normalize indentation levels by subtracting the minimum
  parsedLines.forEach((line) => {
    line.indentLevel -= minIndentLevel;
  });

  const tasks: ParsedMarkdownTask[] = [];
  let totalSubTasks = 0;
  let i = 0;

  while (i < parsedLines.length) {
    const currentLine = parsedLines[i];

    // Only process top-level items (indentLevel 0) as main tasks
    if (currentLine.indentLevel === 0) {
      const task: ParsedMarkdownTask = {
        title: currentLine.content,
        isCompleted: currentLine.isCompleted,
        subTasks: [],
      };

      // Look ahead for nested items and determine the first sub-task level
      let j = i + 1;
      let firstSubTaskLevel: number | null = null;

      // Find the first level of sub-tasks for this main task
      while (j < parsedLines.length && parsedLines[j].indentLevel > 0) {
        if (firstSubTaskLevel === null) {
          firstSubTaskLevel = parsedLines[j].indentLevel;
        }

        const subLine = parsedLines[j];

        if (subLine.indentLevel === firstSubTaskLevel) {
          // This is a direct sub-task
          const subTask: ParsedMarkdownSubTask = {
            title: subLine.content,
            isCompleted: subLine.isCompleted,
          };

          // Look ahead for deeper nested items (indentLevel > firstSubTaskLevel) to add as notes
          const deepNestedItems: ParsedLine[] = [];
          let k = j + 1;

          while (
            k < parsedLines.length &&
            parsedLines[k].indentLevel > firstSubTaskLevel
          ) {
            deepNestedItems.push(parsedLines[k]);
            k++;
          }

          // If there are deeper nested items, add them as notes
          if (deepNestedItems.length > 0) {
            subTask.notes = buildNotesFromNestedItems(deepNestedItems);
          }

          task.subTasks!.push(subTask);
          totalSubTasks++;
          j = k; // Skip the processed nested items
        } else if (subLine.indentLevel > firstSubTaskLevel) {
          // This is a deeper nested item, should be handled by the sub-task above
          j++;
        } else {
          // This is a new main task, break out
          break;
        }
      }

      // If no sub-tasks were found but there were nested items, add them as notes to the main task
      if (task.subTasks!.length === 0) {
        const nestedItems: ParsedLine[] = [];
        let k = i + 1;

        while (k < parsedLines.length && parsedLines[k].indentLevel > 0) {
          nestedItems.push(parsedLines[k]);
          k++;
        }

        if (nestedItems.length > 0) {
          task.notes = buildNotesFromNestedItems(nestedItems);
        }
        j = k;
      }

      // Remove empty subTasks array if no sub-tasks
      if (task.subTasks!.length === 0) {
        delete task.subTasks;
      }

      tasks.push(task);
      i = j; // Skip the nested items we just processed
    } else {
      // This shouldn't happen if we process correctly, but skip just in case
      i++;
    }
  }

  // Return structure only if we found at least one main task
  return tasks.length > 0 ? { mainTasks: tasks, totalSubTasks } : null;
};

export const parseMarkdownTasks = (text: string): ParsedMarkdownTask[] | null => {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const parsedLines: ParsedLine[] = [];

  // Parse all lines first
  for (const line of lines) {
    const parsed = parseLineStructure(line);
    if (parsed) {
      parsedLines.push(parsed);
    } else {
      // If we encounter a line that doesn't match our patterns, it's not a valid task list
      return null;
    }
  }

  if (parsedLines.length === 0) {
    return null;
  }

  // Find the minimum indentation level to normalize
  const minIndentLevel = Math.min(...parsedLines.map((line) => line.indentLevel));

  // Normalize indentation levels by subtracting the minimum
  parsedLines.forEach((line) => {
    line.indentLevel -= minIndentLevel;
  });

  const tasks: ParsedMarkdownTask[] = [];
  let i = 0;

  while (i < parsedLines.length) {
    const currentLine = parsedLines[i];

    // Only process top-level items (indentLevel 0) as main tasks
    if (currentLine.indentLevel === 0) {
      const task: ParsedMarkdownTask = {
        title: currentLine.content,
        isCompleted: currentLine.isCompleted,
      };

      // Look ahead for nested items (indentLevel > 0)
      const nestedItems: ParsedLine[] = [];
      let j = i + 1;

      while (j < parsedLines.length && parsedLines[j].indentLevel > 0) {
        nestedItems.push(parsedLines[j]);
        j++;
      }

      // If there are nested items, add them as notes
      if (nestedItems.length > 0) {
        task.notes = buildNotesFromNestedItems(nestedItems);
      }

      tasks.push(task);
      i = j; // Skip the nested items we just processed
    } else {
      // This shouldn't happen if we process correctly, but skip just in case
      i++;
    }
  }

  // Return tasks only if we found at least one
  return tasks.length > 0 ? tasks : null;
};
