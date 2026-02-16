# Authentication Architecture

This document explains the design decisions and security features of the Super Sync Server authentication system.

## Overview

The server uses **stateless JWT authentication** with:

- **Token versioning** for revocation (no blacklist needed)
- **Email verification** for new accounts
- **Account lockout** protection against brute force

## Design Decisions

### Why Stateless JWTs (Not Stored in DB)

JWTs are issued but never persisted to the database.

**Benefits:**

- No session store needed - scales horizontally without shared state
- Reduced DB load - no lookup on every authenticated request
- Simpler architecture - no session cleanup jobs

**Trade-off:**

- Cannot revoke individual tokens - only all tokens via version increment
- Token remains valid until expiry (365 days) unless version bumped

### Why Token Versioning (Not Blacklisting)

Each user has a `tokenVersion` integer. JWTs include this version, and verification checks it matches the current DB value.

```
Token issued with version 5 → User changes password → DB version becomes 6 → Token rejected (5 ≠ 6)
```

**Benefits:**

- O(1) storage per user (single integer vs. unbounded blacklist)
- No cleanup jobs needed (blacklists grow indefinitely)
- Instant revocation of ALL tokens with one DB update

**Trade-off:**

- Cannot selectively revoke one device's token
- All devices must re-authenticate when version changes

**When version increments:**

- Password change
- Explicit "log out all devices" action
- Token replacement (`/api/replace-token`)

### Why Verification Tokens Are Plain Strings

Email verification tokens are stored as plain 64-character hex strings (32 random bytes).

**Why this is acceptable:**

1. **Cryptographically unguessable** - 256 bits of entropy from `crypto.randomBytes(32)`
2. **One-time use** - Cleared immediately after successful verification
3. **Short-lived** - 24-hour expiry
4. **Low-value target** - Only activates an account, grants no ongoing access

**Trade-off:**

- If DB is compromised, attacker could verify pending (unverified) accounts
- Minimal impact: they still don't know the password

**Alternative considered:** Hashing verification tokens (like password reset tokens in some systems) would add complexity with minimal security benefit for this use case.

### Why bcrypt with 12 Rounds

**Why bcrypt:**

- Industry standard, battle-tested
- Built-in salt generation
- Resistant to GPU/ASIC attacks (memory-hard)

**Why 12 rounds:**

- ~250ms on modern hardware (balances security and UX)
- OWASP recommends 10+ rounds
- Adjustable if hardware improves

## Security Features

| Feature                  | Implementation        | Value               |
| ------------------------ | --------------------- | ------------------- |
| Password hashing         | bcrypt                | 12 rounds           |
| Password minimum         | Zod validation        | 12 characters       |
| JWT signing              | HMAC-SHA256           | Secret min 32 chars |
| JWT expiry               | Uniform               | 365 days            |
| Verification token       | `crypto.randomBytes`  | 32 bytes (256 bits) |
| Verification expiry      | Time-based            | 24 hours            |
| Lockout threshold        | Failed attempts       | 5 attempts          |
| Lockout duration         | Time-based            | 15 minutes          |
| Timing attack mitigation | Dummy hash comparison | Always compare      |

### Timing Attack Mitigation

Even when a user doesn't exist, the login flow compares the provided password against a dummy hash. This ensures the response time is consistent whether the user exists or not, preventing attackers from enumerating valid emails.

```typescript
const dummyHash = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
const hashToCompare = user ? user.passwordHash : dummyHash;
await bcrypt.compare(password, hashToCompare);
```

## Token Lifecycle

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Register   │────▶│ Verification     │────▶│ Verified        │
│  (email +   │     │ Token (24h)      │     │ Account         │
│  password)  │     │ sent via email   │     │                 │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │  Login          │
                                             │  (email +       │
                                             │  password)      │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │  JWT (365d)     │
                                             │  contains:      │
                                             │  - userId       │
                                             │  - email        │
                                             │  - tokenVersion │
                                             └────────┬────────┘
                                                      │
                              ┌────────────────────────┴────────────────────────┐
                              │                                                 │
                              ▼                                                 ▼
                    ┌─────────────────┐                               ┌─────────────────┐
                    │ Token expires   │                               │ Password change │
                    │ (after expiry)  │                               │ tokenVersion++  │
                    │                 │                               │                 │
                    │ User must       │                               │ ALL tokens      │
                    │ re-login        │                               │ invalidated     │
                    └─────────────────┘                               └─────────────────┘
```

## API Reference

See [README.md](../README.md) for endpoint documentation.

**Password requirements:**

- Minimum 12 characters (validated via Zod schema in `api.ts`)

**JWT Secret requirements:**

- Minimum 32 characters
- Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Configuration

All auth-related constants are defined in `src/auth.ts`:

```typescript
const MIN_JWT_SECRET_LENGTH = 32;
const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = '365d'; // All JWT tokens, regardless of auth method
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
```

To modify these values, edit `src/auth.ts` and rebuild.

## Future Considerations

Features not currently implemented but could be added:

- **2FA/MFA** - TOTP or WebAuthn
- **Refresh tokens** - Separate short-lived access + long-lived refresh
- **Per-device token revocation** - Track device IDs in JWT
- **Rate limiting per-user** - Currently only IP-based for auth endpoints
