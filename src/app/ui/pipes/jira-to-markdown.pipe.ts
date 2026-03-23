import { Pipe, PipeTransform } from '@angular/core';

/**
 * Converts JIRA wiki markup to Markdown.
 * Inlined from jira2md to avoid bundling its CommonJS `marked` dependency.
 */
const jiraToMarkdown = (str: string): string =>
  str
    // Un-ordered lists (JIRA: * for bullets)
    .replace(/^[ \t]*(\*+)\s+/gm, (_, stars: string) => {
      return '  '.repeat(stars.length - 1) + '* ';
    })
    // Ordered lists (JIRA: # for numbered)
    .replace(/^[ \t]*(#+)\s+/gm, (_, nums: string) => {
      return '  '.repeat(nums.length - 1) + '1. ';
    })
    // Headers 1-6
    .replace(/^h([1-6])\.(.*)$/gm, (_, level: string, content: string) => {
      return '#'.repeat(parseInt(level)) + content;
    })
    // Bold (intentionally lazy to handle multiple bold spans per line)
    .replace(/\*(\S.*?)\*/g, '**$1**')
    // Italic (intentionally lazy to handle multiple italic spans per line)
    .replace(/\_(\S.*?)\_/g, '*$1*')
    // Monospaced text
    .replace(/\{\{([^}]+)\}\}/g, '`$1`')
    // Inserts
    .replace(/\+([^+]*)\+/g, '<ins>$1</ins>')
    // Superscript
    .replace(/\^([^^]*)\^/g, '<sup>$1</sup>')
    // Subscript
    .replace(/~([^~]*)~/g, '<sub>$1</sub>')
    // Strikethrough
    .replace(/(\s+)-(\S+.*?\S)-(\s+)/g, '$1~~$2~~$3')
    // Code Block
    .replace(
      /\{code(:([a-z]+))?([:|]?(title|borderStyle|borderColor|borderWidth|bgColor|titleBGColor)=.+?)*\}([^]*?)\n?\{code\}/gm,
      '```$2$5\n```',
    )
    // Pre-formatted text
    .replace(/{noformat}/g, '```')
    // Un-named Links
    .replace(/\[([^|]+?)\]/g, '<$1>')
    // Images
    .replace(/!(.+)!/g, '![]($1)')
    // Named Links
    .replace(/\[(.+?)\|(.+?)\]/g, '[$1]($2)')
    // Single Paragraph Blockquote
    .replace(/^bq\.\s+/gm, '> ')
    // Remove color: unsupported in md
    .replace(/\{color:[^}]+\}([^]*)\{color\}/gm, '$1')
    // panel into table
    .replace(
      /\{panel:title=([^}]*)\}\n?([^]*?)\n?\{panel\}/gm,
      '\n| $1 |\n| --- |\n| $2 |',
    )
    // table header
    .replace(/^[ \t]*((?:\|\|.*?)+\|\|)[ \t]*$/gm, (_, headers: string) => {
      const singleBarred = headers.replace(/\|\|/g, '|');
      return '\n' + singleBarred + '\n' + singleBarred.replace(/\|[^|]+/g, '| --- ');
    })
    // remove leading-space of table headers and rows
    .replace(/^[ \t]*\|/gm, '|');

@Pipe({ name: 'jiraToMarkdown' })
export class JiraToMarkdownPipe implements PipeTransform {
  transform(value: string): string {
    if (!value) {
      return value;
    }
    return jiraToMarkdown(value);
  }
}
