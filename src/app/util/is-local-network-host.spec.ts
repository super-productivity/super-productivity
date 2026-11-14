import { isConfigLocalNetworkOnly, isLocalNetworkHost } from './is-local-network-host';

describe('isLocalNetworkHost', () => {
  it('detects local hosts', () => {
    for (const h of [
      '192.168.111.9',
      'http://10.0.0.2:8080/x',
      'localhost:3000',
      '172.20.1.1',
      'gitlab.local',
    ]) {
      expect(isLocalNetworkHost(h)).toBe(true);
    }
  });
  it('rejects public hosts', () => {
    for (const h of ['gitlab.com', 'https://172.32.0.1', '8.8.8.8', '', null]) {
      expect(isLocalNetworkHost(h)).toBe(false);
    }
  });
  it('checks config url fields', () => {
    expect(
      isConfigLocalNetworkOnly({ gitlabBaseUrl: 'http://192.168.1.5', project: 'a' }),
    ).toBe(true);
    expect(isConfigLocalNetworkOnly({ gitlabBaseUrl: '' })).toBe(false);
    expect(isConfigLocalNetworkOnly({ host: 'https://x.atlassian.net' })).toBe(false);
  });
});
