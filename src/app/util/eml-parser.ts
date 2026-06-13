import PostalMime, { type Email } from 'postal-mime';

export const isFileEml = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.eml') || file.type === 'message/rfc822';
};

export const parseEml = async (file: File): Promise<Email> => {
  try {
    const content = await file.text();
    // `await` here (not just `return`) so a parse rejection is caught below
    return await PostalMime.parse(content);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse EML file "${file.name}": ${reason}`);
  }
};
