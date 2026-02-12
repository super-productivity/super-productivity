import * as fs from 'fs';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import { loadConfigFromEnv, ServerConfig, PrivacyConfig } from './config';
import { Logger } from './logger';
import { prisma, disconnectDb } from './db';
import { apiRoutes } from './api';
import { pageRoutes } from './pages';
import { syncRoutes, startCleanupJobs, stopCleanupJobs } from './sync';
import { testRoutes } from './test-routes';

// HTML escape to prevent XSS in generated HTML
const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const generatePrivacyHtml = (privacy?: PrivacyConfig): void => {
  const publicDir = path.join(__dirname, '../../public');
  const templatePath = path.join(publicDir, 'privacy.template.html');
  const outputPath = path.join(publicDir, 'privacy.html');

  if (!fs.existsSync(templatePath)) {
    Logger.warn('privacy.template.html not found, skipping generation');
    return;
  }

  let template = fs.readFileSync(templatePath, 'utf-8');

  // Replace placeholders with HTML-escaped values from config (prevent XSS)
  template = template
    .replace(
      /\{\{\s*PRIVACY_CONTACT_NAME\s*\}\}/g,
      escapeHtml(privacy?.contactName || '[Contact Name]'),
    )
    .replace(
      /\{\{\s*PRIVACY_ADDRESS_STREET\s*\}\}/g,
      escapeHtml(privacy?.addressStreet || '[Street Address]'),
    )
    .replace(
      /\{\{\s*PRIVACY_ADDRESS_CITY\s*\}\}/g,
      escapeHtml(privacy?.addressCity || '[City]'),
    )
    .replace(
      /\{\{\s*PRIVACY_ADDRESS_COUNTRY\s*\}\}/g,
      escapeHtml(privacy?.addressCountry || '[Country]'),
    )
    .replace(
      /\{\{\s*PRIVACY_CONTACT_EMAIL\s*\}\}/g,
      escapeHtml(privacy?.contactEmail || '[Email]'),
    );

  fs.writeFileSync(outputPath, template);
  Logger.info('Generated privacy.html from template');
};

export { ServerConfig, loadConfigFromEnv };

export const createServer = (
  config: Partial<ServerConfig> = {},
): {
  fastifyServer?: FastifyInstance;
  start: () => Promise<string>;
  stop: () => Promise<void>;
} => {
  const fullConfig = loadConfigFromEnv(config);

  // Ensure data directory exists
  if (!fs.existsSync(fullConfig.dataDir)) {
    fs.mkdirSync(fullConfig.dataDir, { recursive: true });
    Logger.info(`Created data directory: ${fullConfig.dataDir}`);
  }

  // Generate privacy.html from template with env vars
  generatePrivacyHtml(fullConfig.privacy);

  let fastifyServer: FastifyInstance | undefined;

  return {
    get fastifyServer() {
      return fastifyServer;
    },
    start: async (): Promise<string> => {
      fastifyServer = Fastify({
        logger: false, // We use our own logger
        bodyLimit: 20 * 1024 * 1024, // 20MB - needed for large imports
        // Add explicit timeouts for long-running operations
        connectionTimeout: 90000, // 90s - match client timeout
        requestTimeout: 80000, // 80s - must exceed DB timeout (60s) but be less than Caddy (85s)
      });

      // Security Headers
      await fastifyServer.register(helmet, {
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Inline styles for HTML pages
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"], // Prevent clickjacking
            formAction: ["'self'"],
            baseUri: ["'self'"],
          },
        },
      });

      // Rate Limiting (prevent brute force)
      if (!fullConfig.testMode?.enabled) {
        await fastifyServer.register(rateLimit, {
          max: 100,
          timeWindow: '15 minutes',
        });
      }

      // CORS Configuration
      // Supports both string origins and RegExp patterns
      if (fullConfig.cors.enabled) {
        const hasWildcard = fullConfig.cors.allowedOrigins?.some((o) => o === '*');
        await fastifyServer.register(cors, {
          origin: hasWildcard ? true : fullConfig.cors.allowedOrigins,
          methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
          allowedHeaders: [
            'Authorization',
            'Content-Type',
            'Content-Encoding',
            'Content-Transfer-Encoding', // Used by some HTTP clients for binary/base64 payloads
            'X-Expected-Rev',
            'X-Force-Overwrite',
            'X-Requested-With',
          ],
          exposedHeaders: ['X-Rev', 'X-Updated-At'],
          credentials: true,
          maxAge: 86400,
          preflight: true,
        });
      }

      // Serve static files
      await fastifyServer.register(fastifyStatic, {
        root: path.join(__dirname, '../../public'),
        prefix: '/',
      });

      // Health Check - verifies database connectivity
      fastifyServer.get('/health', async (_, reply) => {
        try {
          // Simple query to verify DB is responsive
          await prisma.$queryRaw`SELECT 1`;
          return { status: 'ok', db: 'connected' };
        } catch (err) {
          Logger.error('Health check failed: DB not responsive', err);
          return reply.status(503).send({
            status: 'error',
            db: 'disconnected',
            message: 'Database not responsive',
          });
        }
      });

      // API Routes
      await fastifyServer.register(apiRoutes, { prefix: '/api' });

      // Sync Routes (operation-based sync)
      await fastifyServer.register(syncRoutes, { prefix: '/api/sync' });

      // Test Routes (only in test mode)
      if (fullConfig.testMode?.enabled) {
        await fastifyServer.register(testRoutes, { prefix: '/api/test' });
        Logger.warn('TEST MODE ENABLED - Test routes available at /api/test/*');
      }

      // Page Routes
      await fastifyServer.register(pageRoutes, { prefix: '/' });

      // Start cleanup jobs
      startCleanupJobs();

      try {
        const address = await fastifyServer.listen({
          port: fullConfig.port,
          host: '0.0.0.0',
        });
        Logger.info(`Server started on ${address}`);
        return address;
      } catch (err) {
        Logger.error('Failed to start server:', err);
        throw err;
      }
    },
    stop: async (): Promise<void> => {
      stopCleanupJobs();
      if (fastifyServer) {
        await fastifyServer.close();
        fastifyServer = undefined;
      }
      await disconnectDb();
    },
  };
};
