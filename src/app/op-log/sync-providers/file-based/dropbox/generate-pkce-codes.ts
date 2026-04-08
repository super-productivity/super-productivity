import { generateCodeVerifier, generateCodeChallenge } from '../../../../util/pkce.util';

export const generatePKCECodes = async (
  _length: number,
): Promise<{ codeVerifier: string; codeChallenge: string }> => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
};
