---
type: explanation
source: https://documentation.ubuntu.com/core/explanation/refresh-control/
title: Refresh control
domain: ubuntu
---

# Refresh control

Snaps in Ubuntu Core update automatically, and by default, the *snapd* daemon checks for updates 4 times a day. Each update check is called a *refresh*.

However, some projects can benefit from holding a deployed snap, or a set of snaps, at a tested _revision_ until any new release is separately validated, and this requires refresh control.

A snap's revision is an automatic number assigned by the Snap Store to give each snap build a unique identity within its channel. Refresh control allows specific snaps to be kept at a specified revision, even when a new or different revision of a snap is released.

Another possible refresh control solution is to use a _validation set_. A validation set can be used to ensure only specific snaps are installed, and optionally, only specific snaps at fixed revisions.

## Gating snaps

Refresh control can be accomplished by using a **gating snap** to control which revisions of one or more **gated snaps** to install:

- the publisher of the **gating snap** validates which revisions of the one or more *gated snaps* to install.
- the **gating snap** lists the snaps that are to be controlled. Any system that has the gating snap installed is controlled.
- **gated snaps** are kept at their stated revisions. If any gated snaps are not currently at a validated revision, the next refresh ensures they're moved to one, assuming the validated revision is available on the channel that the system follows.

A gated snap can also require verification from *more than one* gating snaps, but this is discouraged to help avoid confusion. The best practice is to use a single gating snap for each gated snap.

Gating is especially useful when a device manufacturer needs to mediate releases of its *base* snap, allowing time for testing and validation of new revisions on their device models and compatibility with their software. This is separate from the ability for device managers to control the schedule of refreshes and revision control via a snap proxy.

## Preliminary setup

The mechanism of defining refresh control behavior involves:

- setting the list of controlled snaps (by snap ID) in the gating snap. After the Canonical Store team does this initial setup, the gating snap's snap-declaration assertion contains a refresh-control section that lists the gated snap IDs (see below)
- The gating snap publisher signing and issuing validation assertions that include:
  - the name of the gating snap
  - the name and revision the gated snap is held at
  - This is done by the gating snap Publisher

Validations can only be issued by the owner/publisher of the *gating* snap because publishing rights are required for an assertion to be issued for the snap.

Establishing the relationship between a gating and gated snap is required only once and can only be performed by a user with permission from the team operating the store controlling the gating snap.

## Example gating workflows

At this point, the publisher can issue validations asserting which revision of the gated snap is allowed to be installed when the gating snap is installed on a device. For example, specify that if the `roadmr-gating` snap is installed, the `roadmr-gated` snap can only be installed or refreshed to revision 2.

```text
$ snapcraft validate roadmr-gating roadmr-gated=2 --key-name my-key
Getting details for roadmr-gated
Signing validations assertion for roadmr-gated=2
```

This generates the assertion and pushes it to the assertions service. A copy of the assertion will also be left in the current directory.

As described earlier, this means that, if the gating snap is installed on the system, the gated snap can *only be installed or refreshed to the approved revision* (2 in this case).

If the gating snap is not installed on the system, the gated snap is not restricted and will be installable or updatable to whichever revision is available in the requested channel. The revision of the gating snap is not relevant here; what's relevant is the latest validation assertion which tells which revision of `roadmr-gated` is allowed.

- To control the revision of a gated snap, the gating snap Publisher signs and issues a validation assertion that names the gating snap and the gated snap name and revision.
- To sign the validation assertion, the Publisher must name/use a snapcraft key (snapcraft create-key KEYNAME) that has been registered (snapcraft register-key KEYNAME).

The snapcraft gated command can tell you which snaps are gated by a particular snap:

```text
$ snapcraft gated roadmr-gating
Name                Revision  Required    Approved
roadmr-gated        2         True        2018-05-30T21:00:04Z
```

Here we can see `roadmr-gating`, if installed, will constrain `roadmr-gated` to revision 2 (or nothing at all, if rev2 is not installable).
