import { type Email } from 'postal-mime';

export const isFileEml = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.eml') || file.type === 'message/rfc822';
};

export const parseEml = async (file: File): Promise<Email> => {
  const content = await file.text();
  const { default: PostalMime } = await import('postal-mime');
  return await PostalMime.parse(content);
};
