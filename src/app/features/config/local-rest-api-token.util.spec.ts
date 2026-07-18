import { generateLocalRestApiToken } from './local-rest-api-token.util';

describe('generateLocalRestApiToken', () => {
  it('should return a 32 char alphanumeric token', () => {
    expect(generateLocalRestApiToken()).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('should not repeat itself', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateLocalRestApiToken()));
    expect(tokens.size).toBe(50);
  });
});
