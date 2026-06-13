# Environment Configuration Setup

This project uses a hybrid approach for environment configuration:

- **Base configuration** (production/stage flags) are in static TypeScript files
- **Secrets and dynamic values** are loaded from `.env` files and converted to TypeScript constants

## Overview

### Static Environment Files

- `src/environments/environment.ts` - Development configuration
- `src/environments/environment.prod.ts` - Production configuration
- `src/environments/environment.stage.ts` - Staging configuration

These files contain base configuration like `production`, `stage`, and `version` flags.

### Dynamic Environment Variables

- `.env` - Environment variables for all environments
- `src/app/config/env.generated.ts` - Auto-generated TypeScript constants (gitignored)

The `.env` file contains secrets and environment-specific values that should not be committed to version control.

## Setup Instructions

1. **Create your .env file**

   ```bash
   cp .env.example .env
   ```

2. **Add your environment variables**

   ```bash
   # .env
   GOOGLE_DRIVE_TOKEN=your-token-here
   DROPBOX_API_KEY=your-api-key-here
   ```

3. **Access environment variables in your code**

   ```typescript
   // Import from the generated constants (type-safe!)
   import { ENV } from './app/config/env.generated';

   // Direct access
   const googleToken = ENV.GOOGLE_DRIVE_TOKEN;

   // Or using utility functions (with type safety)
   import { getEnv, getEnvOrDefault } from './app/util/env';

   const googleToken = getEnv('GOOGLE_DRIVE_TOKEN');
   const dropboxKey = getEnvOrDefault('DROPBOX_API_KEY', 'default-key');
   ```

## Running the Application

The npm scripts automatically generate TypeScript constants from `.env` before running:

```bash
# Development
npm run startFrontend

# Production configuration
npm run startFrontend:prod

# Staging configuration
npm run startFrontend:stage
```

Note: All commands use the same `.env` file. The difference between environments is controlled by the Angular configuration (production/stage flags).

## Build Commands

Build commands also generate constants before building:

```bash
# Production build
npm run buildFrontend:prod:es6

# Staging build
npm run buildFrontend:stage:es6
```

## How It Works

1. **load-env.js** reads the `.env` file and generates `src/app/config/env.generated.ts`
2. **TypeScript constants** are imported and used throughout the app (no process.env needed!)
3. **Type safety** - The utility functions use `keyof typeof ENV` for autocomplete and type checking
4. **Gitignored** - The generated file is never committed, keeping secrets safe

## Security Notes

- Never commit `.env` files to version control
- The generated `env.generated.ts` is gitignored automatically
- Secrets are compiled into the bundle at build time (not exposed as environment variables)
- Only add non-sensitive values to `.env.example`

## Adding New Environment Variables

1. Add to `.env`:

   ```bash
   NEW_API_KEY=your-api-key-here
   ```

2. The TypeScript types are automatically generated when you run any build/serve command

3. Use in your code with full type safety:

   ```typescript
   import { ENV } from './app/config/env.generated';
   const apiKey = ENV.NEW_API_KEY;

   // Or with utility function
   import { getEnv } from './app/util/env';
   const apiKey = getEnv('NEW_API_KEY'); // TypeScript knows all available keys!
   ```

## Benefits of This Approach

- ✅ **Type Safety**: Full TypeScript support with autocomplete
- ✅ **No Runtime Dependencies**: Constants are compiled into the bundle
- ✅ **Works Everywhere**: No need for process.env or special webpack config
- ✅ **Simple**: Just import and use the constants
- ✅ **Secure**: Secrets stay in `.env` and never in version control

---

## Electron-specific environment variables

These are read directly from `process.env` in the Electron main process. They are not part of the Angular build pipeline and must be set in the shell before launching Electron.

| Variable                      | Description                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SP_FORCE_LOCAL_REST_API=1`   | Enables the local REST API without changing the persisted user setting. Only takes effect when `NODE_ENV=DEV`. Useful for development scripts: `SP_FORCE_LOCAL_REST_API=1 npm start`.                   |
| `SP_LOCAL_REST_API_HOST=<ip>` | Overrides the IP address the local REST API binds to when the API is enabled. Must be a valid IPv4 address (IPv6 and hostnames are rejected with a warning). Example: `SP_LOCAL_REST_API_HOST=0.0.0.0`. |
