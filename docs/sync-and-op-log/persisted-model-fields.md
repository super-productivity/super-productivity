# Persisted-Model Fields: Adding a Field Without Breaking Existing Installs

**The invariant (AGENTS.md, sync rule 11): a new REQUIRED field on a persisted
model breaks every existing install — type it optional (`?`) plus a runtime
default.** This document carries the full failure analysis behind the rule; the
short form lives in [AGENTS.md](../../AGENTS.md).

Origin: #9125, #9124 (audit of the #8965 → v18.15.0 boot-to-empty-store
incident). File-level specifics below were verified 2026-07 — re-check the
named source files before relying on the exact counts.

## Why a required field breaks installs

Data already on users' disks lacks the new field, and typia validation rejects
the stored snapshot on hydration: the model says the field must exist, the data
says it doesn't. Prefer `?` plus a runtime default. A backfill migration is the
exception, not the alternative — it costs a schema bump, and rule 10 (AGENTS.md)
explains why a bump is near-irreversible and defaults to "no".

## Why TypeScript will not warn you

TypeScript guards only _new_ data: a required field errors until you add it to
the relevant `DEFAULT_*` constant, then compiles clean — while every existing
install still fails validation against its old snapshot. A green build is no
evidence the fleet survives.

## Why you cannot assume a heal exists

There is no blanket "missing field → default" repair on the normal hydration
path (as of 2026-07):

- `loadAllData` merges per-section defaults for only 9 of the 21 `globalConfig`
  sections (`global-config.reducer.ts`); the remaining sections are a top-level
  spread, so a stored section wins wholesale and keeps its missing field.
- Entity slices get only the generic coercions in `auto-fix-typia-errors.ts`:
  missing boolean → `false`, nullable → `null`.
- That file's blanket `globalConfig.*` defaulting runs only inside the
  user-facing `dataRepair` flow — not on normal hydration.

## Adding a heal correctly

A per-type heal needs its own branch in `auto-fix-typia-errors.ts`. Do **not**
add the type to `recreate-fallback.const.ts` instead — membership there also
opts the type into SPAP-14 disjoint-field auto-merge, which is a sync-behavior
change, not a repair.

## Why the failure is latent

Hydration trusts a snapshot whose schema version matches, so an invalid model
ships silently and detonates later, when an unrelated schema bump drags stored
data onto the migration/validation path. #8965 shipped in January 2026 and
surfaced months later in v18.15.0 as a boot-to-empty-store.

## Guard

`src/app/op-log/validation/frozen-state.spec.ts` validates the current model
against frozen historical state shapes. If it fails after your change, the
model is wrong for data already in the field — fix the model, never the
fixture.
