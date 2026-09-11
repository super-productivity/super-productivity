# Database encryption at rest

> **Status:** Not provided by the current SuperSync deployment
>
> **Last verified:** 2026-07-29

SuperSync does not currently encrypt PostgreSQL database files or the database
volume. The former LUKS and PostgreSQL TDE implementations were retired after
testing showed that they could not run in the production OpenVZ environment.

The retirement summary is preserved under
[`../archive/encryption-attempts-openvz-incompatible/`](../archive/encryption-attempts-openvz-incompatible/)
for historical context. The executable Compose override, scripts, and runbooks
were removed; Git history retains them for forensic reference.

The durable rationale and revisit criteria are recorded in
[the repository decision](../../../docs/supersync-encryption-at-rest-decision.md).

## What is and is not encrypted

- The live PostgreSQL files are not encrypted by this project.
- Ordinary database dumps are not automatically encrypted by database E2EE.
- When a client enables SuperSync end-to-end encryption, the client encrypts the
  operation payload before upload. Routing and causal metadata remain plaintext;
  see [the server architecture](architecture.md#e2ee-boundary).
- Backup-file encryption is a separate operational control and does not encrypt
  the live database. The maintained backup and restore procedure is documented in
  [Backup and Disaster Recovery](backup-and-recovery.md).

## Operator guidance

Protect the host, PostgreSQL credentials, filesystem, provider snapshots, and
backup locations as sensitive infrastructure. If encrypted storage is required,
provide it through an infrastructure layer that is supported by the deployment
environment, such as host-level encryption on a suitable VM or a managed database
service.

Before claiming that a deployment has encryption at rest, exercise migration,
boot/unlock, backup, restore, key rotation, monitoring, and rollback on the exact
production topology. Do not infer regulatory compliance from an encryption
algorithm or from the archived implementation alone.
