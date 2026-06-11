import { readEml, type ReadedEmlJson } from 'eml-parse-js';
// NOTE: Prove that file is eml filetype.

export const isFileEml = (file: File): boolean => {
  return file.name.endsWith('eml') || file.type === 'message/rfc822';
};

export const parseEml = async (file: File): Promise<ReadedEmlJson> => {
  const content = await file.text();
  const data = readEml(content) as ReadedEmlJson;

  if (typeof data === 'string') throw Error(data);

  if (data instanceof Error) throw data;

  return data;
};
