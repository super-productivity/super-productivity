const DANGEROUS_SVG_TAGS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'style',
];

const URI_ATTRS = new Set(['href', 'xlink:href', 'src']);
const isSafeSvgReference = (attrValue: string): boolean => attrValue.startsWith('#');

export const sanitizeSvgIconContent = (svgContent: string): string | null => {
  if (!svgContent.trim()) {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    return null;
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return null;
  }

  for (const tagName of DANGEROUS_SVG_TAGS) {
    for (const el of Array.from(doc.querySelectorAll(tagName))) {
      el.remove();
    }
  }

  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value.trim().toLowerCase();
      if (attrName.startsWith('on') || attrName === 'style') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URI_ATTRS.has(attrName) && !isSafeSvgReference(attrValue)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  const sanitized = new XMLSerializer().serializeToString(root);
  if (!/<svg[\s>]/i.test(sanitized) || !/<\/svg>/i.test(sanitized)) {
    return null;
  }
  return sanitized;
};
