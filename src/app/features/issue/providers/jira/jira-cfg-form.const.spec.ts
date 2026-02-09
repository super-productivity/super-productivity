import { JIRA_CONFIG_FORM_SECTION } from './jira-cfg-form.const';

describe('Jira config form URL pattern', () => {
  let urlPattern: RegExp;

  beforeAll(() => {
    const hostField = JIRA_CONFIG_FORM_SECTION.items!.find((item) => item.key === 'host');
    const pattern = hostField?.templateOptions?.pattern as RegExp;
    expect(pattern).toBeDefined();
    urlPattern = pattern;
  });

  describe('should accept valid Jira host URLs', () => {
    const validUrls = [
      // Bare hostnames (#4731)
      'jira',
      'http://jira',
      'https://jira',
      'http://jira:1234',
      'http://jira:8080/rest',
      'http://server-name:8080',
      'bamboo',

      // Localhost
      'localhost',
      'http://localhost',
      'https://localhost',
      'http://localhost:8080',
      'http://localhost:8080/some/path',

      // FQDN
      'jira.example.com',
      'http://jira.example.com',
      'https://jira.example.com',
      'https://jira.example.com:443',
      'https://jira.example.com/rest/api',
      'https://jira.example.com:8080/rest/api',

      // Subdomains
      'https://my.company.atlassian.net',
      'https://deep.sub.domain.example.com',

      // IP-like patterns
      'http://192.168.1.1',
      'http://192.168.1.1:8080',
    ];

    validUrls.forEach((url) => {
      it(`should accept: "${url}"`, () => {
        expect(urlPattern.test(url)).toBe(true);
      });
    });
  });

  describe('should reject invalid Jira host URLs', () => {
    const invalidUrls = ['', 'http://', 'http:// spaces', 'http://jira server'];

    invalidUrls.forEach((url) => {
      it(`should reject: "${url}"`, () => {
        expect(urlPattern.test(url)).toBe(false);
      });
    });
  });
});
