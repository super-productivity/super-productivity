import { sha256 as hashWasmSha256 } from 'hash-wasm';

const DEFAULT_PKCE_RANDOM_BYTES = 32;

type PkceSubtleCrypto = {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
};

export interface PkceCrypto {
  getRandomValues<T extends Uint8Array>(array: T): T;
  subtle?: PkceSubtleCrypto;
}

export type PkceSha256 = (data: Uint8Array) => Promise<ArrayBuffer>;

export interface GenerateCodeVerifierOptions {
  crypto?: PkceCrypto;
  randomBytesLength?: number;
}

export interface GenerateCodeChallengeOptions {
  crypto?: PkceCrypto;
  sha256Fallback?: PkceSha256;
}

export interface GeneratePkceCodesOptions
  extends GenerateCodeVerifierOptions, GenerateCodeChallengeOptions {}

type BtoaGlobal = {
  btoa?: (data: string) => string;
};

type CryptoGlobal = {
  crypto?: PkceCrypto;
};

type TextEncoderConstructor = new () => {
  encode(input?: string): Uint8Array;
};

type TextEncoderGlobal = {
  TextEncoder?: TextEncoderConstructor;
};

const getOptionalDefaultCrypto = (): PkceCrypto | undefined =>
  (globalThis as CryptoGlobal).crypto;

const getDefaultCrypto = (): PkceCrypto => {
  const cryptoLike = getOptionalDefaultCrypto();
  if (!cryptoLike) {
    throw new Error('Crypto API is unavailable');
  }
  return cryptoLike;
};

const getBtoa = (): ((data: string) => string) => {
  const btoaLike = (globalThis as BtoaGlobal).btoa;
  if (!btoaLike) {
    throw new Error('btoa is unavailable');
  }
  return btoaLike;
};

const getTextEncoder = (): TextEncoderConstructor => {
  const TextEncoderLike = (globalThis as TextEncoderGlobal).TextEncoder;
  if (!TextEncoderLike) {
    throw new Error('TextEncoder is unavailable');
  }
  return TextEncoderLike;
};

const base64UrlEncode = (buffer: Uint8Array): string => {
  const base64 = getBtoa()(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const hashWasmSha256ArrayBuffer: PkceSha256 = async (data) => {
  const hexHash = await hashWasmSha256(data);
  const bytes = new Uint8Array(hexHash.length / 2);
  for (let i = 0; i < hexHash.length; i += 2) {
    bytes[i / 2] = parseInt(hexHash.slice(i, i + 2), 16);
  }
  return bytes.buffer;
};

export const generateCodeVerifier = (
  options: GenerateCodeVerifierOptions = {},
): string => {
  const cryptoLike = options.crypto ?? getDefaultCrypto();
  const array = new Uint8Array(options.randomBytesLength ?? DEFAULT_PKCE_RANDOM_BYTES);
  cryptoLike.getRandomValues(array);
  return base64UrlEncode(array);
};

export const generateCodeChallenge = async (
  verifier: string,
  options: GenerateCodeChallengeOptions = {},
): Promise<string> => {
  const TextEncoderLike = getTextEncoder();
  const data = new TextEncoderLike().encode(verifier);
  const cryptoLike = options.crypto ?? getOptionalDefaultCrypto();
  const subtle = cryptoLike?.subtle;
  const digest =
    subtle != null
      ? await subtle.digest('SHA-256', data)
      : await (options.sha256Fallback ?? hashWasmSha256ArrayBuffer)(data);
  return base64UrlEncode(new Uint8Array(digest));
};

export const generatePKCECodes = async (
  _length: number,
  options: GeneratePkceCodesOptions = {},
): Promise<{ codeVerifier: string; codeChallenge: string }> => {
  const codeVerifier = generateCodeVerifier(options);
  const codeChallenge = await generateCodeChallenge(codeVerifier, options);
  return { codeVerifier, codeChallenge };
};
