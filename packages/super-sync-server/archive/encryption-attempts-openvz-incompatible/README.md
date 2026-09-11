# Retired encryption-at-rest experiments

> **Status:** Historical, unsupported, and incompatible with the current
> deployment.

SuperSync previously tested project-managed LUKS storage and PostgreSQL
transparent data encryption. Neither approach works in the production OpenVZ
environment, so the executable tooling and runbooks were removed instead of
leaving an unsafe deployment path in the repository.

The implementation remains available in Git history:

- LUKS tooling began in `cb2e2e65a2` and its test/migration support in
  `c8bce3c8cf`.
- Security follow-up landed in `0573468797`.
- The LUKS approach was retired and archived in `e050eb99fa`.
- The PostgreSQL TDE experiment landed in `1fdcc9a906` and was reverted in
  `3a58044826`.

Current status, security boundaries, and criteria for considering a replacement
are documented in:

- [`../../docs/encryption-at-rest.md`](../../docs/encryption-at-rest.md)
- [`../../../../docs/supersync-encryption-at-rest-decision.md`](../../../../docs/supersync-encryption-at-rest-decision.md)

Any future storage-encryption project needs a fresh design and an exercised
migration, rollback, boot, key-rotation, backup, and restore procedure on the
actual deployment environment. The old implementation is historical evidence,
not a shortcut to that review.

Backup-file encryption is a separate control from encryption of the live
database. Follow the maintained
[`../../docs/backup-and-recovery.md`](../../docs/backup-and-recovery.md) guide for
current backup and recovery behavior.
