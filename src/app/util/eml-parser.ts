import { readEml, type ReadedEmlJson } from 'eml-parse-js';

export const isFileEml = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.eml') || file.type === 'message/rfc822';
};

export const parseEml = async (file: File): Promise<ReadedEmlJson> => {
  const content = await file.text();
  const data = readEml(content) as ReadedEmlJson;

  if (typeof data === 'string') throw Error(data);

  if (data instanceof Error) throw data;

  return data;
};
