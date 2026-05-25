import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const originalEnv = { ...process.env };

const resetEnv = (): void => {
  process.env = { ...originalEnv };
};

// Import after env is set
const importConfig = async () => {
  return await import('../src/config');
};

describe('parseCorsOrigin', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  describe('exact string origins', () => {
    it('should return string as-is when no wildcard present', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://app.super-productivity.com');
      expect(result).toBe('https://app.super-productivity.com');
    });

    it('should trim whitespace from exact origins', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('  https://example.com  ');
      expect(result).toBe('https://example.com');
    });
  });

  describe('wildcard subdomain origins', () => {
    it('should convert https://*.example.com to RegExp', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.example.com');
      expect(result).toBeInstanceOf(RegExp);
      expect((result as RegExp).test('https://foo.example.com')).toBe(true);
      expect((result as RegExp).test('https://bar.example.com')).toBe(true);
    });

    it('should match subdomain with port', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('http://*.localhost:4200');
      expect(result).toBeInstanceOf(RegExp);
      expect((result as RegExp).test('http://dev.localhost:4200')).toBe(true);
    });

    it('should match preview deployment pattern', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.super-productivity-preview.pages.dev');
      expect(result).toBeInstanceOf(RegExp);
      expect(
        (result as RegExp).test('https://f5382282.super-productivity-preview.pages.dev'),
      ).toBe(true);
    });

    it('should not match base domain without subdomain', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.example.com');
      expect((result as RegExp).test('https://example.com')).toBe(false);
    });

    it('should not match different domain', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.example.com');
      expect((result as RegExp).test('https://foo.otherdomain.com')).toBe(false);
    });

    it('should not match with path injection', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.example.com');
      expect((result as RegExp).test('https://foo.example.com/path')).toBe(false);
    });

    it('should normalize domain to lowercase for case-insensitive matching', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.EXAMPLE.COM');

      // Browsers send Origin header in lowercase per RFC 6454
      expect((result as RegExp).test('https://sub.example.com')).toBe(true);
      expect((result as RegExp).test('https://sub.EXAMPLE.COM')).toBe(true);
    });

    it('should normalize subdomain pattern domain to lowercase', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.Preview.Example.COM');

      expect((result as RegExp).test('https://abc.preview.example.com')).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('should reject multiple wildcards', async () => {
      const { parseCorsOrigin } = await importConfig();
      expect(() => parseCorsOrigin('https://*.*.example.com')).toThrow(
        'multiple wildcards not allowed',
      );
    });

    it('should reject wildcard in domain position', async () => {
      const { parseCorsOrigin } = await importConfig();
      expect(() => parseCorsOrigin('https://example.*')).toThrow(
        'wildcard only allowed as subdomain',
      );
    });

    it('should reject wildcard without domain', async () => {
      const { parseCorsOrigin } = await importConfig();
      expect(() => parseCorsOrigin('https://*')).toThrow(
        'wildcard only allowed as subdomain',
      );
    });

    it('should reject wildcard in protocol', async () => {
      const { parseCorsOrigin } = await importConfig();
      expect(() => parseCorsOrigin('*://example.com')).toThrow(
        'wildcard only allowed as subdomain',
      );
    });

    it('should reject wildcard in path', async () => {
      const { parseCorsOrigin } = await importConfig();
      expect(() => parseCorsOrigin('https://example.com/*')).toThrow(
        'wildcard only allowed as subdomain',
      );
    });

    it('should reject empty origin', async () => {
      const { parseCorsOrigin } = await importConfig();
      expect(() => parseCorsOrigin('')).toThrow('cannot be empty');
    });

    it('should reject whitespace-only origin', async () => {
      const { parseCorsOrigin } = await importConfig();
      expect(() => parseCorsOrigin('   ')).toThrow('cannot be empty');
    });
  });

  describe('parseCorsOrigin security', () => {
    it('should reject domain confusion in wildcard patterns', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.super-productivity-preview.pages.dev');

      expect(
        (result as RegExp).test('https://evil.com.super-productivity-preview.pages.dev'),
      ).toBe(false);
      expect(
        (result as RegExp).test('https://a.b.super-productivity-preview.pages.dev'),
      ).toBe(false);
    });

    it('should only allow alphanumeric and hyphens in wildcard subdomains', async () => {
      const { parseCorsOrigin } = await importConfig();
      const result = parseCorsOrigin('https://*.example.com');

      // Should match valid subdomains
      expect((result as RegExp).test('https://abc123.example.com')).toBe(true);
      expect((result as RegExp).test('https://abc-123.example.com')).toBe(true);

      // Should reject subdomains with dots
      expect((result as RegExp).test('https://sub.domain.example.com')).toBe(false);
      expect((result as RegExp).test('https://evil.com.example.com')).toBe(false);
    });
  });
});

describe('loadConfigFromEnv - CORS_ORIGINS parsing', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('should parse comma-separated origins with wildcards', async () => {
    process.env.CORS_ORIGINS =
      'https://app.example.com,https://*.preview.example.com,http://localhost:4200';

    const { loadConfigFromEnv } = await importConfig();
    const config = loadConfigFromEnv();

    expect(config.cors.allowedOrigins).toHaveLength(3);
    expect(config.cors.allowedOrigins![0]).toBe('https://app.example.com');
    expect(config.cors.allowedOrigins![1]).toBeInstanceOf(RegExp);
    expect(config.cors.allowedOrigins![2]).toBe('http://localhost:4200');
  });

  it('should throw error on invalid wildcard pattern in CORS_ORIGINS', async () => {
    process.env.CORS_ORIGINS = 'https://*';

    const { loadConfigFromEnv } = await importConfig();
    expect(() => loadConfigFromEnv()).toThrow('wildcard only allowed as subdomain');
  });

  it('should handle wildcard syntax in CORS_ORIGINS', async () => {
    process.env.CORS_ORIGINS = 'https://*.super-productivity-preview.pages.dev';

    const { loadConfigFromEnv } = await importConfig();
    const config = loadConfigFromEnv();

    expect(config.cors.allowedOrigins).toHaveLength(1);
    const pattern = config.cors.allowedOrigins![0] as RegExp;
    expect(pattern.test('https://abc123.super-productivity-preview.pages.dev')).toBe(
      true,
    );
  });

  it('should parse wildcard patterns even when universal wildcard is present', async () => {
    process.env.CORS_ORIGINS = 'https://app.com,*,https://*.preview.com';

    const { loadConfigFromEnv } = await importConfig();
    const config = loadConfigFromEnv();

    expect(config.cors.allowedOrigins).toHaveLength(3);
    expect(config.cors.allowedOrigins![0]).toBe('https://app.com');
    expect(config.cors.allowedOrigins![1]).toBe('*');
    expect(config.cors.allowedOrigins![2]).toBeInstanceOf(RegExp);

    // Verify the RegExp works
    const pattern = config.cors.allowedOrigins![2] as RegExp;
    expect(pattern.test('https://abc123.preview.com')).toBe(true);
  });
});

describe('DEFAULT_CORS_ORIGINS', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('should match valid preview deployment URLs', async () => {
    const { loadConfigFromEnv } = await importConfig();
    const config = loadConfigFromEnv();
    const pattern = config.cors.allowedOrigins![1] as RegExp;

    expect(pattern.test('https://f5382282.super-productivity-preview.pages.dev')).toBe(
      true,
    );
    expect(pattern.test('https://abc-123.super-productivity-preview.pages.dev')).toBe(
      true,
    );
  });

  it('should reject domain confusion attacks', async () => {
    const { loadConfigFromEnv } = await importConfig();
    const config = loadConfigFromEnv();
    const pattern = config.cors.allowedOrigins![1] as RegExp;

    expect(pattern.test('https://evil.com.super-productivity-preview.pages.dev')).toBe(
      false,
    );
    expect(pattern.test('https://a.b.super-productivity-preview.pages.dev')).toBe(false);
  });

  it('should reject URLs with paths', async () => {
    const { loadConfigFromEnv } = await importConfig();
    const config = loadConfigFromEnv();
    const pattern = config.cors.allowedOrigins![1] as RegExp;

    expect(pattern.test('https://abc.super-productivity-preview.pages.dev/path')).toBe(
      false,
    );
  });
});
