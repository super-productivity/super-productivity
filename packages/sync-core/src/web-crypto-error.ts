export class WebCryptoNotAvailableError extends Error {
  override name = 'WebCryptoNotAvailableError';

  constructor(message = 'Web Crypto API (crypto.subtle) is not available') {
    super(message);
  }
}
