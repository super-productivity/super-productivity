# SuperSync CORS Wildcard Support Design

**Date:** 2026-01-24
**Status:** Approved
**Author:** Claude Code

## Overview

Add wildcard pattern support to SuperSync server CORS configuration to allow preview deployment domains like `https://*.super-productivity-preview.pages.dev` while maintaining security.

## Problem Statement

Currently, CORS origins only support exact string matching. Preview deployments use dynamic subdomains (e.g., `https://f5382282.super-productivity-preview.pages.dev`) that cannot be whitelisted without manually updating the environment configuration for each deployment.

## Design Decision

Use **wildcard syntax** instead of arbitrary RegExp parsing for security and simplicity.

### Why Wildcards Over RegExp?

- **Security**: @fastify/cors documentation warns that RegExp patterns can enable DoS attacks through catastrophic backtracking
- **Simplicity**: `https://*.example.com` is clearer than `/^https:\/\/[^\/]+\.example\.com$/`
- **Validation**: We can strictly validate wildcard patterns and reject dangerous ones
- **Sufficient**: Covers the preview deployment use case without exposing attack surface

## Implementation Design

### 1. Wildcard Syntax

**Supported:**

- `https://*.example.com` - any subdomain of example.com
- `https://*.super-productivity-preview.pages.dev` - preview deployments
- `http://*.localhost:4200` - local dev with subdomains

**Rejected patterns:**

- `https://*` - too broad
- `https://example.*` - TLD wildcards
- `https://*/path` - path wildcards
- `*://example.com` - protocol wildcards
- Multiple wildcards in one origin

### 2. Parsing Function

```typescript
function parseCorsOrigin(origin: string): CorsOrigin {
  const trimmed = origin.trim();

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

  // Convert to safe RegExp
  const escapedDomain = domain.replace(/\./g, '\\.');
  const portPart = port ? port.replace('.', '\\.') : '';
  const pattern = `^${protocol}:\\/\\/[^\\/]+\\.${escapedDomain}${portPart}$`;

  return new RegExp(pattern);
}
```

### 3. Configuration Integration

**Update `config.ts`:**

- Add `parseCorsOrigin()` helper
- Call when parsing `CORS_ORIGINS` env var
- Update default origins to include preview pattern

**Default origins:**

```typescript
const DEFAULT_CORS_ORIGINS: CorsOrigin[] = [
  'https://app.super-productivity.com',
  /^https:\/\/[^\/]+\.super-productivity-preview\.pages\.dev$/,
];
```

**Environment variable example:**

```bash
CORS_ORIGINS=https://app.super-productivity.com,https://*.super-productivity-preview.pages.dev,http://localhost:4200
```

### 4. Error Handling

- Errors thrown during config loading (server won't start with invalid config)
- Clear, actionable error messages
- Examples in error output

## Testing Strategy

### Unit Tests (`config.spec.ts`)

Test `parseCorsOrigin()` function:

- Valid wildcards convert to correct RegExp
- Exact matches pass through unchanged
- Invalid patterns throw descriptive errors
- Edge cases: multiple wildcards, wrong positions, missing protocol

### Integration Tests

- Server starts with wildcard origins
- CORS headers returned correctly for matching origins
- Non-matching origins rejected

### Manual Testing

- Test with actual preview URL in browser
- Verify CORS headers in DevTools
- Test preflight OPTIONS requests

## Security Considerations

1. **DoS Prevention**: Only allowing simple subdomain wildcards prevents catastrophic backtracking
2. **No Arbitrary RegExp**: Users cannot inject complex patterns from environment
3. **Strict Validation**: Invalid patterns fail fast at startup
4. **Production Safety**: Wildcard in production still requires explicit domain specification

## Migration Path

**No breaking changes:**

- Existing exact-match origins continue working
- New wildcard syntax is additive
- Default config includes preview domain pattern

**Documentation updates:**

- Update `.env.example` with wildcard examples
- Update README with CORS configuration section
- Add comments explaining wildcard syntax

## Implementation Checklist

- [ ] Add `parseCorsOrigin()` to `config.ts`
- [ ] Update CORS origin parsing in `loadConfigFromEnv()`
- [ ] Update `DEFAULT_CORS_ORIGINS` to include preview pattern
- [ ] Update `.env.example` with documentation
- [ ] Write unit tests for `parseCorsOrigin()`
- [ ] Write integration tests for CORS with wildcards
- [ ] Manual testing with preview deployment
- [ ] Update README if needed
