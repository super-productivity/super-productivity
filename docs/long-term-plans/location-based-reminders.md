# Location-based reminders

> **Status:** Proposed; no implementation is approved.
>
> **Owner:** Unassigned.
>
> **Tracking:** [GitHub issue #5336](https://github.com/super-productivity/super-productivity/issues/5336).
>
> **Last verified:** 2026-07-29.
>
> **Removal condition:** Delete this proposal if the issue is declined or
> closed without implementation. If accepted, replace it with an implementation
> plan and move enduring behavior into maintained documentation.

## User need

Users want an opt-in reminder when they arrive at a place so a relevant task or
list appears at the useful moment. The tracking issue records several distinct
participants and current workflow examples. That demand justifies retaining the
proposal, but not the large, implementation-specific design that previously
lived here.

## Product and privacy constraints

Any accepted design must:

- remain off until a user explicitly configures a location reminder and grants
  the required platform permission;
- work locally and offline, without analytics, telemetry, or a remote location
  service becoming a prerequisite;
- make any decision to sync coordinates explicit, because saved places are
  sensitive data and may not belong on every synced device;
- use platform geofencing or another battery-conscious native mechanism rather
  than continuous foreground polling;
- avoid repeated or stale notifications by defining when a reminder fires,
  expires, and can fire again;
- degrade calmly on platforms that cannot provide reliable background
  geofencing; and
- begin with the smallest useful workflow rather than maps, travel-time
  prediction, or general location-history features.

## Decisions still required

The tracking issue must establish the initial reminder scope, supported
platforms, precision and dwell-time behavior, permission flow, data model,
sync policy, battery/reliability evidence, and deletion/export behavior before
implementation starts.

The original detailed draft is historical research, not a current
specification. It remains available in Git history at
`aff89beafa:docs/long-term-plans/location-based-reminders.md`.
