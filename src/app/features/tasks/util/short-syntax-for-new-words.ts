import { shortSyntax } from '../short-syntax';

// Private-use characters: no short syntax matches them.
const MASK_FIRST = 0xe000;
const MASK_LAST = 0xf8ff;
const MASK_CHAR_REG_EX = /[\uE000-\uF8FF]/g;
const HAS_MASK_CHAR_REG_EX = /[\uE000-\uF8FF]/;

type ShortSyntaxArgs = Parameters<typeof shortSyntax>;
type ShortSyntaxRestArgs = ShortSyntaxArgs extends [unknown, ...infer Rest]
  ? Rest
  : never;

/**
 * Short syntax for a title edit that applies only to the words typed since
 * `keptTitle`: every word `keptTitle` already has is hidden from the parser and
 * stays in the title as plain text. Without `keptTitle`, plain `shortSyntax`.
 * A title that already holds private-use characters is not parsed at all.
 * The result's `parsedRanges` refer to the masked title.
 */
export const shortSyntaxForNewWords = async (
  keptTitle: string | undefined,
  task: ShortSyntaxArgs[0],
  ...args: ShortSyntaxRestArgs
): ReturnType<typeof shortSyntax> => {
  if (keptTitle === undefined || !task.title) {
    return shortSyntax(task, ...args);
  }
  if (HAS_MASK_CHAR_REG_EX.test(task.title)) {
    return undefined;
  }
  const keptWords = new Set(keptTitle.split(/\s+/));
  const maskedWords: string[] = [];
  const maskedTitle = task.title.replace(/\S+/g, (word) => {
    if (!keptWords.has(word) || MASK_FIRST + maskedWords.length > MASK_LAST) {
      return word;
    }
    maskedWords.push(word);
    return String.fromCharCode(MASK_FIRST + maskedWords.length - 1);
  });
  const r = await shortSyntax({ ...task, title: maskedTitle }, ...args);
  return r?.taskChanges.title === undefined
    ? r
    : {
        ...r,
        taskChanges: {
          ...r.taskChanges,
          title: r.taskChanges.title.replace(
            MASK_CHAR_REG_EX,
            (ch) => maskedWords[ch.charCodeAt(0) - MASK_FIRST],
          ),
        },
      };
};
