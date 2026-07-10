export const isFileEml = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.eml') || file.type === 'message/rfc822';
};
