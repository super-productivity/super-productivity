import { type Email } from 'postal-mime';

export const isFileEml = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.eml') || file.type === 'message/rfc822';
};

export const parseEml = async (file: File): Promise<Email> => {
  const { default: PostalMime } = await import('postal-mime');
  // Hand the File (a Blob) straight to postal-mime so it applies the message's
  // own charset and transfer-encoding. file.text() would force UTF-8 and mangle
  // non-UTF-8 emails.
  return PostalMime.parse(file);
};
