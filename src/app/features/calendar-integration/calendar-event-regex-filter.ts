import { CalendarIntegrationEvent } from './calendar-integration.model';

// Hard cap pattern length to mitigate ReDoS from adversarial user input.
// 256 chars accommodates realistic include/exclude patterns while bounding
// the space of catastrophic-backtracking constructions.
export const CALENDAR_REGEX_FILTER_MAX_LENGTH = 256;

type QuantifierInfo = {
  endIndex: number;
  isVariable: boolean;
  isRepeating: boolean;
};

type RegexGroupFrame = {
  alternatives: string[];
  currentAlternative: string;
  hasVariableQuantifier: boolean;
};

const NO_QUANTIFIER: QuantifierInfo = {
  endIndex: -1,
  isVariable: false,
  isRepeating: false,
};

// Module-level cache so the regex compiles once per pattern, not per event.
// `null` sentinel marks patterns whose syntax failed to compile - skip silently
// to preserve the historical "invalid regex ignored, feature non-fatal" UX.
// Oversized or unsafe patterns are handled upstream by the caller (fail-closed
// for include, fail-open for exclude) before reaching this cache.
const COMPILED_CACHE_LIMIT = 64;
const compiledCache = new Map<string, RegExp | null>();

const readNumber = (
  pattern: string,
  startIndex: number,
): { value: number; endIndex: number } | null => {
  let endIndex = startIndex;
  while (
    endIndex < pattern.length &&
    pattern.charCodeAt(endIndex) >= 48 &&
    pattern.charCodeAt(endIndex) <= 57
  ) {
    endIndex++;
  }
  if (endIndex === startIndex) return null;
  return {
    value: Number(pattern.slice(startIndex, endIndex)),
    endIndex,
  };
};

const readBraceQuantifier = (
  pattern: string,
  startIndex: number,
): QuantifierInfo | null => {
  const min = readNumber(pattern, startIndex + 1);
  if (!min) return null;

  if (pattern[min.endIndex] === '}') {
    return {
      endIndex: min.endIndex,
      isVariable: false,
      isRepeating: min.value > 1,
    };
  }

  if (pattern[min.endIndex] !== ',') return null;

  const max = readNumber(pattern, min.endIndex + 1);
  if (!max) {
    if (pattern[min.endIndex + 1] !== '}') return null;
    return {
      endIndex: min.endIndex + 1,
      isVariable: true,
      isRepeating: true,
    };
  }

  if (pattern[max.endIndex] !== '}') return null;

  return {
    endIndex: max.endIndex,
    isVariable: max.value !== min.value,
    isRepeating: max.value > 1,
  };
};

const readQuantifier = (pattern: string, startIndex: number): QuantifierInfo => {
  const char = pattern[startIndex];
  if (char === '+' || char === '*') {
    return {
      endIndex: startIndex,
      isVariable: true,
      isRepeating: true,
    };
  }
  if (char === '?') {
    return {
      endIndex: startIndex,
      isVariable: true,
      isRepeating: false,
    };
  }
  if (char === '{') {
    return readBraceQuantifier(pattern, startIndex) ?? NO_QUANTIFIER;
  }
  return NO_QUANTIFIER;
};

const getGroupContentStartIndex = (pattern: string, openIndex: number): number => {
  if (pattern[openIndex + 1] !== '?') return openIndex + 1;

  const groupModifier = pattern[openIndex + 2];
  if (groupModifier === ':' || groupModifier === '=' || groupModifier === '!') {
    return openIndex + 3;
  }
  if (
    groupModifier === '<' &&
    (pattern[openIndex + 3] === '=' || pattern[openIndex + 3] === '!')
  ) {
    return openIndex + 4;
  }
  if (groupModifier === '<') {
    const nameEndIndex = pattern.indexOf('>', openIndex + 3);
    return nameEndIndex === -1 ? openIndex + 2 : nameEndIndex + 1;
  }

  const localFlagEndIndex = pattern.indexOf(':', openIndex + 2);
  return localFlagEndIndex === -1 ? openIndex + 2 : localFlagEndIndex + 1;
};

const getAlternatives = (frame: RegexGroupFrame): string[] => [
  ...frame.alternatives,
  frame.currentAlternative,
];

const hasAmbiguousAlternatives = (frame: RegexGroupFrame): boolean => {
  const alternatives = getAlternatives(frame).filter((alternative) => alternative !== '');

  return alternatives.some((alternative, index) =>
    alternatives.some(
      (otherAlternative, otherIndex) =>
        index !== otherIndex &&
        otherAlternative.length > alternative.length &&
        otherAlternative.startsWith(alternative),
    ),
  );
};

const appendToCurrentAlternative = (stack: RegexGroupFrame[], value: string): void => {
  const currentFrame = stack[stack.length - 1];
  if (currentFrame) {
    currentFrame.currentAlternative += value;
  }
};

const markVariableQuantifierInCurrentGroup = (stack: RegexGroupFrame[]): void => {
  const currentFrame = stack[stack.length - 1];
  if (currentFrame) {
    currentFrame.hasVariableQuantifier = true;
  }
};

const isOversized = (pattern: string): boolean =>
  pattern.length > CALENDAR_REGEX_FILTER_MAX_LENGTH;

export const isSafeCalendarFilterRegex = (pattern: string): boolean => {
  const stack: RegexGroupFrame[] = [];

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];

    if (char === '\\') {
      const escapedChar = pattern[index + 1];
      if (
        (escapedChar != null && escapedChar >= '1' && escapedChar <= '9') ||
        escapedChar === 'k'
      ) {
        return false;
      }
      const quantifier = readQuantifier(pattern, index + 2);
      appendToCurrentAlternative(stack, pattern.slice(index, index + 2));
      if (quantifier.isVariable) {
        markVariableQuantifierInCurrentGroup(stack);
        index = quantifier.endIndex;
      } else {
        index++;
      }
      continue;
    }

    if (char === '[') {
      let classEndIndex = index + 1;
      while (classEndIndex < pattern.length) {
        if (pattern[classEndIndex] === '\\') {
          classEndIndex += 2;
          continue;
        }
        if (pattern[classEndIndex] === ']') break;
        classEndIndex++;
      }
      const quantifier = readQuantifier(pattern, classEndIndex + 1);
      appendToCurrentAlternative(stack, '[]');
      if (quantifier.isVariable) {
        markVariableQuantifierInCurrentGroup(stack);
        index = quantifier.endIndex;
      } else {
        index = classEndIndex;
      }
      continue;
    }

    if (char === '(') {
      stack.push({
        alternatives: [],
        currentAlternative: '',
        hasVariableQuantifier: false,
      });
      index = getGroupContentStartIndex(pattern, index) - 1;
      continue;
    }

    if (char === ')' && stack.length > 0) {
      const frame = stack.pop() as RegexGroupFrame;
      const quantifier = readQuantifier(pattern, index + 1);
      const hasGroupBacktrackingRisk =
        frame.hasVariableQuantifier || hasAmbiguousAlternatives(frame);
      if (quantifier.isRepeating && hasGroupBacktrackingRisk) {
        return false;
      }
      appendToCurrentAlternative(stack, '(group)');
      if (hasGroupBacktrackingRisk) {
        markVariableQuantifierInCurrentGroup(stack);
      }
      if (quantifier.isVariable) {
        markVariableQuantifierInCurrentGroup(stack);
        index = quantifier.endIndex;
      }
      continue;
    }

    if (char === '|' && stack.length > 0) {
      const currentFrame = stack[stack.length - 1];
      currentFrame.alternatives.push(currentFrame.currentAlternative);
      currentFrame.currentAlternative = '';
      continue;
    }

    const quantifier = readQuantifier(pattern, index + 1);
    appendToCurrentAlternative(stack, char);
    if (quantifier.isVariable) {
      markVariableQuantifierInCurrentGroup(stack);
      index = quantifier.endIndex;
    }
  }

  return true;
};

const isUsablePattern = (pattern: string): boolean =>
  !isOversized(pattern) && isSafeCalendarFilterRegex(pattern);

const getCompiled = (pattern: string): RegExp | null => {
  if (compiledCache.has(pattern)) {
    return compiledCache.get(pattern) ?? null;
  }
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern, 'i');
  } catch {
    compiled = null;
  }
  if (compiledCache.size >= COMPILED_CACHE_LIMIT) {
    const firstKey = compiledCache.keys().next().value;
    if (firstKey !== undefined) compiledCache.delete(firstKey);
  }
  compiledCache.set(pattern, compiled);
  return compiled;
};

export const passesCalendarEventRegexFilter = (
  calEv: CalendarIntegrationEvent,
  filterIncludeRegex: string | null | undefined,
  filterExcludeRegex: string | null | undefined,
): boolean => {
  if (filterIncludeRegex) {
    // Fail-closed: an unusable include filter should hide the event rather
    // than silently widening the user's intended scope (which could leak
    // unwanted events into auto-import).
    if (!isUsablePattern(filterIncludeRegex)) {
      return false;
    }
    const re = getCompiled(filterIncludeRegex);
    if (re && !re.test(calEv.title)) {
      return false;
    }
  }

  if (filterExcludeRegex && isUsablePattern(filterExcludeRegex)) {
    // Fail-open for exclude: an unusable exclude pattern degrades to "no
    // exclusion" rather than hiding every event.
    const re = getCompiled(filterExcludeRegex);
    if (re && re.test(calEv.title)) {
      return false;
    }
  }

  return true;
};
