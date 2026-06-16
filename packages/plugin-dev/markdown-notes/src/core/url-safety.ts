const LOCAL_MARKDOWN_BASE = 'https://local.invalid/';
const LOCAL_MARKDOWN_ORIGIN = new URL(LOCAL_MARKDOWN_BASE).origin;
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const IMAGE_PROTOCOLS = new Set(['file:']);

const isSafeMarkdownUrl = (value: string, allowedProtocols: Set<string>): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed, LOCAL_MARKDOWN_BASE);
    return url.origin === LOCAL_MARKDOWN_ORIGIN || allowedProtocols.has(url.protocol);
  } catch {
    return false;
  }
};

export const isSafeMarkdownLinkUrl = (value: string): boolean =>
  isSafeMarkdownUrl(value, LINK_PROTOCOLS);

export const isSafeMarkdownImageUrl = (value: string): boolean =>
  isSafeMarkdownUrl(value, IMAGE_PROTOCOLS);
