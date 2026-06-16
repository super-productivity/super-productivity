import createDOMPurify, { type WindowLike } from 'dompurify';
import { isSafeMarkdownImageUrl, isSafeMarkdownLinkUrl } from './url-safety';

export type MarkdownSanitizerWindow = WindowLike & { document: Document };

const ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];

const ALLOWED_ATTR = ['align', 'alt', 'height', 'href', 'src', 'title', 'width'];

export const sanitizeMarkdownHtml = (
  html: string,
  windowRef: MarkdownSanitizerWindow = globalThis as unknown as MarkdownSanitizerWindow,
): string => {
  const domPurify = createDOMPurify(windowRef);
  const sanitized = domPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?!\s*(?:javascript|data|vbscript):)/i,
  });
  const template = windowRef.document.createElement('template');
  template.innerHTML = sanitized;

  template.content.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || !isSafeMarkdownLinkUrl(href)) {
      link.removeAttribute('href');
    }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
  });

  template.content.querySelectorAll('img').forEach((image) => {
    const src = image.getAttribute('src');
    if (!src || !isSafeMarkdownImageUrl(src)) {
      image.removeAttribute('src');
    }
    image.setAttribute('loading', 'lazy');
    image.setAttribute('referrerpolicy', 'no-referrer');
  });

  return template.innerHTML;
};
