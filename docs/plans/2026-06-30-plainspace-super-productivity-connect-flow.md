# Dedicated "Connect from Super Productivity" Flow on plainspace.org

**Date:** 2026-06-30
**Status:** Open plan / design — not started.
**Scope:** plainspace.org only — the landing + token flow for a visitor arriving from Super Productivity's Connect dialog. The Super Productivity side is treated here as an external input/consumer, not part of this plan.

## Problem

When a user clicks **Open Plainspace** in SP's Connect dialog, they land on the generic plainspace.org marketing page:

> Plainspace — The simplest way to stay aligned with people who don't use your tools. [Create a Space] [Find my Spaces]

Their actual goal at that moment is narrow: **get an API token and take it back to Super Productivity.** The marketing page ignores that intent, offers no path to a token, and assumes a mental model (Spaces) the visitor may not have. The token UI itself is buried four levels deep (Space → People → Advanced → API tokens). Result: a funnel leak exactly at the handoff.

## Goals

- A visitor arriving **from SP** is recognized and guided straight to a connected state, with the fewest possible steps.
- Own the "how to get a token" guidance **interactively here**, so SP's dialog doesn't have to carry instructions.
- Treat the handoff as a two-sided acquisition funnel: a brand-new visitor from SP is a great moment to create a Plainspace account.

## Non-goals

- Not redesigning all of Plainspace's onboarding — only the from-SP path.
- No team/admin/reporting surface.

## What the flow must produce

SP needs an **account-level token** (`pat_…`). The Space is chosen _later_, inside SP's own space picker (create-new vs link-existing). So this flow's only job is: **get the visitor to a verified account and a named token.** It does **not** need to make them create a Space first.

## Inbound contract (from Super Productivity)

External inputs this flow can rely on (owned by the SP side, listed here only for context):

- SP opens a deep link carrying the source, e.g. `https://plainspace.org/connect/super-productivity` (or `?from=super-productivity`).
- (Model B only) SP provides a redirect/callback target to receive the token.

Plainspace uses the source marker to show the contextual flow, preserve the intent through signup/verify, and instrument the funnel.

## Two models

### Model A — Guided manual token (MVP)

Contextual landing ("Connecting Super Productivity? Get your token →") → sign in / sign up (+ email verify) → **one-click "Create token for Super Productivity"** → show the token with a copy button and "paste this into Super Productivity."

- Pros: small, ships fast, removes the marketing dead-end.
- Cons: copy-paste remains.

### Model B — OAuth-style authorize (target)

An authorize endpoint: the user signs in + approves, then Plainspace **redirects the token back to SP automatically** (SP-provided callback; desktop protocol/loopback, web redirect, PKCE-style).

- Pros: no copy-paste; the smoothest possible flow.
- Cons: needs an authorize endpoint + client registration here (and SP callback handling, which is external).

**Recommendation:** ship **A** first (fast win, kills the dead-end), design toward **B**.

## Account-state handling (the landing must cover all)

| State on arrival                         | Flow                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Signed out                               | Sign in **or** sign up — preserve the "from SP" intent through the detour so they return to the token step. |
| Email unverified                         | **Front-load verification** here, rather than blocking token creation late and silently.                    |
| Signed in                                | Straight to one-click token (A) / approve (B).                                                              |
| Already has a "Super Productivity" token | Offer to reuse, or rotate — don't silently create duplicates.                                               |

## Phasing

- **Phase 1:** contextual landing keyed on the source marker; one-click token; copy + "paste into SP"; front-loaded email verification.
- **Phase 2:** OAuth-style authorize endpoint + automatic handoff (no copy-paste).

## Open questions

- Token scope/lifetime; auto-name it "Super Productivity"; revoke/rotate UX.
- The token UI is buried four levels deep — surface a first-class "Connect an app" entry point.
- Gate token creation behind email verification, or allow token-then-verify?
- Model B: PKCE, token in fragment vs postMessage, redirect allow-listing, client registration.

## Measurement

Keyed on the `from=super-productivity` marker: land → sign up/in → verify → token created (→ "SP connected" if Model B lands). Use it to find the drop-off step.
