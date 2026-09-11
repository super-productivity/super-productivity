# SuperSync database encryption at rest

> **Status:** Accepted
>
> **Decision date:** 2026-01
>
> **Last verified:** 2026-07-29

## Decision

The current SuperSync deployment operates without project-managed encryption of
the PostgreSQL database files. The repository does not provide or support a LUKS
or PostgreSQL transparent-data-encryption deployment path.

The previously implemented LUKS tooling requires `dm-crypt` and other host kernel
capabilities that are unavailable in the production OpenVZ environment. The
PostgreSQL TDE experiment was also not viable in that environment. Both attempts
were retired rather than leaving an untestable security mechanism in the active
deployment path.

The retirement summary and implementation-history pointers remain under
[`packages/super-sync-server/archive/encryption-attempts-openvz-incompatible/`](../packages/super-sync-server/archive/encryption-attempts-openvz-incompatible/)
as historical evidence. The executable files and runbooks were removed so they
cannot be mistaken for a supported production path.

## Security boundary

- PostgreSQL files and ordinary database dumps are not encrypted by SuperSync.
  Protect the host, database credentials, filesystem, snapshots, and backup
  locations accordingly.
- SuperSync end-to-end encryption is a separate client-side feature. When it is
  enabled, operation payloads are encrypted before upload, but routing and causal
  metadata remain plaintext. It does not encrypt the PostgreSQL volume.
- An encrypted database-backup stream is also separate from live database-file
  encryption. See the server's
  [backup and recovery guide](../packages/super-sync-server/docs/backup-and-recovery.md)
  for the maintained recovery procedure.
- Do not describe the archived LUKS design as production-ready or as proof of
  regulatory compliance.

## Consequences

The deployment relies on access controls and the hosting environment for
database-file protection. Users who need server-blind content confidentiality
should enable SuperSync E2EE. Operators whose threat model requires encrypted
storage must supply that property at the infrastructure layer and verify backup
and restore behavior themselves.

## Revisit conditions

Reconsider this decision only with an operations-owned proposal that includes:

1. a deployment environment that supports the chosen mechanism;
2. a tested migration and rollback on the current Compose/database layout;
3. boot, key rotation, backup, and disaster-recovery procedures;
4. monitoring and an exercised restore test; and
5. an updated threat model that clearly separates payload E2EE, database-file
   encryption, and backup encryption.

Viable future directions include moving to a KVM host with infrastructure-managed
disk encryption or a managed PostgreSQL service that provides encryption at rest.
The retired implementation in Git history is a research input, not a shortcut
to approval.
