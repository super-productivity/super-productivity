import * as path from 'path';
import { Logger } from './logger';

/** CORS origin can be a string or RegExp for pattern matching (e.g., localhost with any port) */
export type CorsOrigin = string | RegExp;

export interface PrivacyConfig {
  contactName: string;
  addressStreet: string;
  addressCity: string;
  addressCountry: string;
  contactEmail: string;
}

export interface ServerConfig {
  port: number;
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
 * Default CORS origins for production security.
 * Only allows the official Super Productivity app.
 * Use CORS_ORIGINS env var to add development origins (e.g., localhost).
 */
const DEFAULT_CORS_ORIGINS: CorsOrigin[] = ['https://app.super-productivity.com'];

const DEFAULT_CONFIG: ServerConfig = {
  port: 1900,
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
    // Block wildcard in production - this is a security vulnerability
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
    }
    config.cors.allowedOrigins = origins;
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

  // Privacy policy configuration (for German legal requirements)
  if (process.env.PRIVACY_CONTACT_NAME) {
    config.privacy = {
      contactName: process.env.PRIVACY_CONTACT_NAME,
      addressStreet: process.env.PRIVACY_ADDRESS_STREET || '',
      addressCity: process.env.PRIVACY_ADDRESS_CITY || '',
      addressCountry: process.env.PRIVACY_ADDRESS_COUNTRY || '',
      contactEmail: process.env.PRIVACY_CONTACT_EMAIL || '',
    };
  }

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

  if (!config.dataDir) {
    throw new Error('Data directory configuration is missing');
  }

  return config;
};
