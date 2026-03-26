const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR']);

/**
 * Sanitize HTML content from document blocks.
 * Only allows formatting tags produced by execCommand (bold/italic/underline/link).
 * Strips all other elements (keeping their text content) and all attributes
 * except href on anchor tags.
 */
export const sanitizeBlockHtml = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const toUnwrap: Element[] = [];
  let node: Element | null;
  while ((node = walker.nextNode() as Element | null)) {
    if (!ALLOWED_TAGS.has(node.tagName)) {
      toUnwrap.push(node);
    } else {
      for (const attr of Array.from(node.attributes)) {
        if (!(node.tagName === 'A' && attr.name === 'href')) {
          node.removeAttribute(attr.name);
        }
      }
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
          node.removeAttribute('href');
        }
      }
    }
  }
  for (const el of toUnwrap) {
    el.replaceWith(...Array.from(el.childNodes));
  }
  return template.innerHTML;
};
