import * as path from 'path';
import { Logger } from './logger';

/** CORS origin can be a string or RegExp for pattern matching (e.g., localhost with any port) */
export type CorsOrigin = string | RegExp;

/**
 * Parse CORS origin string into CorsOrigin type (string or RegExp).
 * Supports wildcard subdomain syntax: https://*.example.com
 * Converts wildcards to safe RegExp patterns.
 *
 * SECURITY: The generated pattern only allows alphanumeric characters and
 * hyphens in the subdomain portion to prevent domain confusion attacks.
 * For example, https://*.example.com will NOT match https://evil.com.example.com
 *
 * @param origin - CORS origin string (exact match or wildcard pattern)
 * @returns CorsOrigin (string for exact match, RegExp for wildcard)
 * @throws Error if wildcard pattern is invalid or unsafe
 */
export const parseCorsOrigin = (origin: string): CorsOrigin => {
  const trimmed = origin.trim();

  // Validate non-empty
  if (!trimmed) {
    throw new Error('CORS origin cannot be empty');
  }

  // No wildcard - return as-is for exact match
  if (!trimmed.includes('*')) {
    return trimmed;
  }

  // Validate wildcard count
  const wildcardCount = (trimmed.match(/\*/g) || []).length;
  if (wildcardCount > 1) {
    throw new Error(`Invalid CORS origin "${trimmed}": multiple wildcards not allowed`);
  }

  // Only allow subdomain wildcards: https://*.example.com
  const subdomainWildcardPattern = /^(https?):\/\/\*\.([a-z0-9.-]+)(:\d+)?$/i;
  const match = trimmed.match(subdomainWildcardPattern);

  if (!match) {
    throw new Error(
      `Invalid CORS origin "${trimmed}": wildcard only allowed as subdomain (e.g., https://*.example.com)`,
    );
  }

  const [, protocol, domain, port] = match;

  // Convert to safe RegExp: https://*.example.com -> /^https:\/\/[a-zA-Z0-9-]+\.example\.com$/i
  // Only allow alphanumeric and hyphens in subdomain (prevents domain confusion)
  // Normalize domain to lowercase (browsers send Origin header in lowercase per RFC 6454)
  const escapedDomain = domain.toLowerCase().replace(/\./g, '\\.');
  const portPart = port ? port.replace(/\./g, '\\.') : '';
  const pattern = `^${protocol}:\\/\\/[a-zA-Z0-9-]+\\.${escapedDomain}${portPart}$`;

  // Use case-insensitive flag to handle uppercase/lowercase variations
  return new RegExp(pattern, 'i');
};

export interface PrivacyConfig {
  contactName: string;
  addressStreet: string;
  addressCity: string;
  addressCountry: string;
  contactEmail: string;
  /** Free-text address block of the hosting provider, if a third party hosts the data. */
  hostingProvider?: string;
  /** Free-text block naming the supervisory authority competent for the controller. */
  supervisoryAuthority?: string;
}

/**
 * Whether this instance may ask users to accept anything.
 *
 * Derived, never stored: consent is meaningful exactly when a privacy policy is published,
 * and that is decided solely by whether the operator identified themselves. Keeping this a
 * pure function of the environment means there is no initialisation order to get wrong and
 * no process-wide flag that a forgotten setter could leave pointing the wrong way.
 */
export const isConsentRequired = (config: ServerConfig): boolean => !!config.privacy;

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /**
   * Publicly reachable base URL used for links in emails.
   * Should point to the reverse-proxied address users can access.
   */
  publicUrl: string;
  cors: {
    enabled: boolean;
    allowedOrigins?: CorsOrigin[];
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
  };
  /**
   * Privacy policy contact information.
   * Required for German legal compliance (Impressum).
   */
  privacy?: PrivacyConfig;
  /**
   * Where this instance stores user data, as an operator-asserted region label.
   *
   * Independent of `privacy` on purpose: it is a claim about infrastructure, not about the
   * controller, and an operator may want the landing-page badge without publishing a full
   * policy. Only `EU`/`EEA` renders a badge today — every other value is accepted and
   * simply shows none, because an EU flag next to "US" would be exactly the kind of false
   * statement this whole change exists to remove.
   */
  dataRegion?: string;
  /**
   * Test mode configuration. When enabled, provides endpoints for E2E testing.
   * NEVER enable in production!
   */
  testMode?: {
    enabled: boolean;
    /** Automatically verify users on registration (skip email verification) */
    autoVerifyUsers: boolean;
  };
}

/**
 * Default CORS origins — the stable production app, and nothing else.
 *
 * Every self-hosted instance inherits this default, and CORS is registered with
 * `credentials: true`. A Cloudflare Pages preview wildcard used to sit here too, which
 * meant servers we do not run granted credentialed cross-origin access to our preview
 * infrastructure by default. Preview origins belong in our own deployment's CORS_ORIGINS.
 *
 * Use the CORS_ORIGINS env var to set your own origins; wildcard subdomain patterns are
 * still supported there (see `parseCorsOrigin`), they just are not shipped as a default.
 */
const DEFAULT_CORS_ORIGINS: CorsOrigin[] = ['https://app.super-productivity.com'];

const DEFAULT_CONFIG: ServerConfig = {
  port: 1900,
  host: '0.0.0.0',
  dataDir: './data',
  publicUrl: 'http://localhost:1900',
  cors: {
    enabled: true,
    allowedOrigins: DEFAULT_CORS_ORIGINS,
  },
};

/**
 * Load configuration from environment variables.
 * Environment variables take precedence over defaults.
 */
export const loadConfigFromEnv = (
  overrides: Partial<ServerConfig> = {},
): ServerConfig => {
  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    cors: {
      ...DEFAULT_CONFIG.cors,
      ...(overrides.cors || {}),
    },
  };

  // Override with environment variables
  if (process.env.PORT) {
    const parsedPort = parseInt(process.env.PORT, 10);
    if (Number.isInteger(parsedPort) && parsedPort > 0) {
      config.port = parsedPort;
    } else {
      throw new Error(`Invalid PORT: ${process.env.PORT}. Must be a positive integer.`);
    }
  }

  if (process.env.HOST !== undefined) {
    const trimmedHost = process.env.HOST.trim();
    if (!trimmedHost) {
      throw new Error('Invalid HOST: must not be empty.');
    }
    if (/\s/.test(trimmedHost)) {
      throw new Error(`Invalid HOST: ${process.env.HOST}. Must not contain whitespace.`);
    }
    if (/^https?:\/\//i.test(trimmedHost) || trimmedHost.includes('/')) {
      throw new Error(
        `Invalid HOST: ${process.env.HOST}. Use a hostname or IP address without protocol or path.`,
      );
    }
    config.host = trimmedHost;
  }

  if (process.env.DATA_DIR) {
    const resolvedPath = path.resolve(process.env.DATA_DIR);
    if (!resolvedPath) {
      throw new Error(`Invalid DATA_DIR: ${process.env.DATA_DIR}`);
    }
    config.dataDir = resolvedPath;
  } else {
    // Resolve default data dir relative to cwd
    config.dataDir = path.resolve(config.dataDir);
  }

  // Public URL (for email links)
  if (process.env.PUBLIC_URL) {
    const trimmed = process.env.PUBLIC_URL.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('PUBLIC_URL must start with http:// or https://');
    }
    config.publicUrl = trimmed.replace(/\/+$/, '');
  } else {
    config.publicUrl = `http://localhost:${config.port}`;
  }

  // Enforce HTTPS for PUBLIC_URL in production
  if (process.env.NODE_ENV === 'production' && !config.publicUrl.startsWith('https://')) {
    throw new Error('PUBLIC_URL must use HTTPS in production');
  }

  // CORS configuration
  // CORS_ORIGINS overrides defaults (comma-separated list of origins)
  // Use CORS_ORIGINS=* for wildcard (NOT recommended for production)
  if (process.env.CORS_ENABLED !== undefined) {
    config.cors.enabled = process.env.CORS_ENABLED === 'true';
  }
  if (process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map((o) => o.trim());

    // Block universal wildcard in production - security vulnerability
    if (origins.includes('*')) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'CORS_ORIGINS wildcard (*) is not allowed in production. ' +
            'Specify explicit allowed origins for security.',
        );
      }
      Logger.warn(
        'CORS_ORIGINS contains wildcard (*). This is insecure and not recommended for production.',
      );
      // Parse non-wildcard origins, keep * as-is
      try {
        config.cors.allowedOrigins = origins.map((o) =>
          o === '*' ? o : parseCorsOrigin(o),
        );
      } catch (err) {
        throw new Error(
          `Invalid CORS_ORIGINS configuration: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      // Parse each origin (converts wildcard patterns to RegExp)
      try {
        config.cors.allowedOrigins = origins.map(parseCorsOrigin);
      } catch (err) {
        throw new Error(
          `Invalid CORS_ORIGINS configuration: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // If origins are provided, implicitly enable CORS if not explicitly disabled
    if (process.env.CORS_ENABLED === undefined) {
      config.cors.enabled = true;
    }
  }

  // SMTP Configuration
  if (process.env.SMTP_HOST) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    config.smtp = {
      host: process.env.SMTP_HOST,
      port,
      secure:
        process.env.SMTP_SECURE !== undefined
          ? process.env.SMTP_SECURE === 'true'
          : port === 465,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || '"SuperSync" <noreply@example.com>',
    };
  }

  // Privacy policy configuration. The generated policy is only served when the operator
  // has identified themselves as the controller — a policy naming the wrong controller is
  // worse than no policy at all, so every field below is required to enable it. Partial
  // configuration is a hard error rather than a silent fallback to placeholder text.
  const privacyEnv = {
    contactName: process.env.PRIVACY_CONTACT_NAME,
    addressStreet: process.env.PRIVACY_ADDRESS_STREET,
    addressCity: process.env.PRIVACY_ADDRESS_CITY,
    addressCountry: process.env.PRIVACY_ADDRESS_COUNTRY,
    contactEmail: process.env.PRIVACY_CONTACT_EMAIL,
  };
  const privacyKeys = Object.keys(privacyEnv) as (keyof typeof privacyEnv)[];
  const privacySet = privacyKeys.filter((key) => !!privacyEnv[key]?.trim());
  if (privacySet.length > 0 && privacySet.length < privacyKeys.length) {
    const missing = privacyKeys
      .filter((key) => !privacyEnv[key]?.trim())
      .map((key) => `PRIVACY_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
    throw new Error(
      `Incomplete privacy policy configuration. Missing: ${missing.join(', ')}. ` +
        `Set all of them to publish a privacy policy, or none to disable the legal pages.`,
    );
  }
  if (privacySet.length === privacyKeys.length) {
    config.privacy = {
      contactName: privacyEnv.contactName as string,
      addressStreet: privacyEnv.addressStreet as string,
      addressCity: privacyEnv.addressCity as string,
      addressCountry: privacyEnv.addressCountry as string,
      contactEmail: privacyEnv.contactEmail as string,
      hostingProvider: process.env.PRIVACY_HOSTING_PROVIDER?.trim() || undefined,
      supervisoryAuthority:
        process.env.PRIVACY_SUPERVISORY_AUTHORITY?.trim() || undefined,
    };
  }

  config.dataRegion = process.env.PRIVACY_DATA_REGION?.trim() || undefined;

  // Test mode configuration
  // Requires both TEST_MODE=true AND TEST_MODE_CONFIRM=yes-i-understand-the-risks
  // This double-check prevents accidental test mode enablement
  if (process.env.TEST_MODE === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TEST_MODE cannot be enabled in production');
    }
    if (process.env.TEST_MODE_CONFIRM !== 'yes-i-understand-the-risks') {
      throw new Error(
        'TEST_MODE requires TEST_MODE_CONFIRM=yes-i-understand-the-risks to prevent accidental enablement',
      );
    }
    Logger.warn(
      '⚠️  TEST_MODE is enabled - test routes are exposed. DO NOT use in production!',
    );
    config.testMode = {
      enabled: true,
      autoVerifyUsers: true,
    };
  }

  // Validation
  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error(`Invalid port configuration: ${config.port}`);
  }

  if (!config.host) {
    throw new Error('Host configuration is missing');
  }

  if (!config.dataDir) {
    throw new Error('Data directory configuration is missing');
  }

  return config;
};
