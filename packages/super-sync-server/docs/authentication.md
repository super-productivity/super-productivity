# Authentication Architecture

SuperSync's production authentication paths are passkeys and emailed magic
links. Successful authentication issues the same long-lived JWT regardless of
the login method. Password creation exists only in the guarded test routes; it
is not a production registration or login flow.

The executable authorities are [`api.ts`](../src/api.ts) for routes and rate
limits, [`auth.ts`](../src/auth.ts) for email tokens and JWT verification, and
[`passkey.ts`](../src/passkey.ts) for WebAuthn ceremonies and recovery. Keep
request and response payload details in those files instead of duplicating them
here.

## Stable Endpoint Purposes

All paths below are mounted under `/api`.

| Method and path                  | Stable purpose                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /register/passkey/options` | Start WebAuthn registration and retain a five-minute process-local challenge           |
| `POST /register/passkey/verify`  | Verify the ceremony and stage the exact credential pending email verification          |
| `POST /register/magic-link`      | Create an unverified email-only account and send its verification link                 |
| `POST /verify-email`             | Consume a verification token and activate the corresponding account or pending passkey |
| `POST /login/passkey/options`    | Start a WebAuthn authentication ceremony                                               |
| `POST /login/passkey/verify`     | Verify the passkey and issue a JWT                                                     |
| `POST /login/magic-link`         | Send an existing verified account a one-time login link                                |
| `POST /login/magic-link/verify`  | Consume the login token and issue a JWT                                                |
| `POST /recover/passkey`          | Send a verified passkey account a recovery link                                        |
| `POST /recover/passkey/options`  | Validate the recovery token and start replacement-passkey registration                 |
| `POST /recover/passkey/complete` | Replace the account's passkeys and invalidate its existing JWTs                        |
| `POST /replace-token`            | Increment the authenticated user's token version and return the sole replacement JWT   |

Authentication request schemas and neutral error responses are defined beside
these routes in [`api.ts`](../src/api.ts).

## Account Activation and Login

### Passkey Registration

The server verifies the WebAuthn registration ceremony but does not immediately
trust the submitted credential. It stores that credential as a
`PendingPasskeyRegistration`, bound to the exact email-verification token. When
that token is consumed, the server atomically verifies the user, deletes any
other pending or active credentials for that account, and promotes only the
credential bound to that link. This is the active architecture recorded in
[ADR #6](../../../ARCHITECTURE-DECISIONS.md#6-passkeys-stay-pending-until-email-verification).

### Magic-Link Registration and Login

Magic-link registration creates an unverified account with no password or
passkey. Email verification activates it. A separate 15-minute login token can
then be requested and exchanged once for a JWT. Registration, login, and
recovery responses avoid revealing whether an email address already exists.

### Passkey Login and Recovery

Passkey login performs a fresh WebAuthn ceremony and then issues a JWT. Passkey
recovery uses a one-hour emailed bearer token to start a replacement WebAuthn
ceremony. Successful completion deletes the old passkeys, stores the new one,
increments `tokenVersion`, and therefore invalidates the account's earlier
JWTs.

WebAuthn challenges live in a five-minute, process-local map and are consumed by
the corresponding completion request. Multi-instance deployments consequently
need shared challenge storage or sticky routing for each complete ceremony.

## JWT Lifecycle, Verification, and Revocation

JWTs are signed but are not stored as sessions. Every JWT carries `userId`,
`email`, and `tokenVersion` and expires after 365 days. The authentication
method matters only before issuance; passkey and magic-link sessions have the
same scope and lifetime.

Token verification checks the signature and then confirms that the account
still exists, is verified, and has the same `tokenVersion`. To avoid a database
read on every request, those account fields are cached for 30 seconds in a
bounded, process-local auth cache. Account deletion, verification, token
replacement, and recovery invalidate the local cache beside their database
writes.

This means revocation is immediate on the process that performs the write, but
not across independent replicas: another process can continue accepting a
previously cached token until its entry expires, for at most the remaining
30-second TTL. A multi-instance deployment must add shared invalidation (or a
stronger centralized verification design) if it requires immediate global
revocation. Routing all requests for an account consistently can reduce the
window but does not replace shared invalidation as a general guarantee.

`POST /api/replace-token` increments `tokenVersion`, invalidating all prior JWTs
for the account, and returns a new JWT with the new version. Selective
per-device revocation is not implemented.

The cache implementation and its single-replica constraint live in
[`auth-cache.ts`](../src/auth-cache.ts); JWT verification and version writes
live in [`auth.ts`](../src/auth.ts).

## Email Tokens Are Bearer Secrets

Verification, magic-login, and passkey-recovery tokens are random 32-byte values
stored as plain strings. They are cryptographically unguessable, time-limited,
and consumed with guarded database updates so the same token cannot complete
the flow twice. Current lifetimes are 24 hours for email verification, 15
minutes for magic login, and one hour for passkey recovery.

Those limits reduce exposure; they do not make plaintext tokens low-value. A
magic-login token grants a JWT, and a recovery token can replace the account's
passkeys. Consuming a passkey-registration verification token activates the
credential already bound to that token, so an attacker who staged a credential
they control and then obtains the corresponding email token can gain ongoing
account access. Database dumps, application logs, and proxy logs containing
unexpired tokens must therefore be treated as credential exposure.

Plaintext storage is a current known limitation. A stronger design would store
only token digests and compare the digest of a presented token, preserving
lookup and one-use semantics without leaving usable bearer values in the
database.

## WebSocket Token Transport

Authenticated HTTP endpoints receive the JWT in the bearer authorization
header. The WebSocket handshake uses the same full-access, 365-day JWT from the
`token` query parameter; it is not a short-lived or WebSocket-scoped credential.

Production deployments must use HTTPS and WSS. Because reverse-proxy access and
request failure/error logs can record request URIs and headers, every such setup
must omit sensitive query values and token-bearing `Referer` headers from both
log paths. Login and recovery pages must emit
`Referrer-Policy: no-referrer`; otherwise their same-origin script and API
requests can repeat the credential-bearing page URL in a logged header. The
[bundled Caddy configuration](../Caddyfile) replaces the complete logged query
suffix, drops `Referer` from both Caddy log paths, and sets that policy. Custom
proxy and logging configurations must provide equivalent protection. The
application error logger independently replaces its complete query suffix, so
malformed requests cannot bypass the proxy filter through application logs.

## Security Properties and Current Limits

| Concern                      | Current implementation                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| JWT signing                  | HMAC-SHA256 secret with a minimum length of 32 characters                              |
| JWT lifetime                 | 365 days for both passkey and magic-link authentication                                |
| Whole-account revocation     | `tokenVersion` increment, subject to the cross-replica cache window described above    |
| Passkey verification         | WebAuthn origin, RP ID, challenge, credential signature, and counter checks            |
| Email enumeration resistance | Neutral registration/login/recovery responses and dummy passkey options                |
| Email bearer-token entropy   | 32 random bytes                                                                        |
| WebAuthn challenge storage   | Five-minute process-local map; not multi-instance-safe without affinity/shared storage |
| Per-device JWT revocation    | Not implemented                                                                        |
| Refresh-token separation     | Not implemented                                                                        |

Set `JWT_SECRET` to a strong random value of at least 32 characters. WebAuthn
deployment identity is controlled by `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, and
`WEBAUTHN_ORIGIN`; production origins must use HTTPS.
