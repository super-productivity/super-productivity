---
type: how-to
source: https://documentation.ubuntu.com/core/how-to-guides/manage-ubuntu-core/upgrade-ubuntu-core/
title: Upgrade Ubuntu Core
domain: ubuntu
---

# Upgrade Ubuntu Core

A device can be upgraded to a later Ubuntu Core release if it has:

- **an assigned serial number**: from either a serial assertion or the Snap Store.
- **identical storage layout**: layouts are identical unless they've been manually reconfigured.
- **consistent base and system snaps**: significant differences will cause an upgrade to fail.

It is not currently possible to upgrade from releases earlier than UC20, or from either a UC20 reference image or a reference model assertion, including those available on [https://cdimage.ubuntu.com/ubuntu-core/20](https://cdimage.ubuntu.com/ubuntu-core/20).

Reference model assertions can be easily modified to build a custom image that can be upgraded.

Upgrades are performed by remodeling, which is the process of replacing one model assertion with another on a deployed system. For an upgrade from UC20 to UC22, for example, this means updating the base and system snaps in a UC20 model assertion with their UC22 counterparts.

## Prerequisites

On the device, run `snap model` to make sure the device has been assigned a serial:

```bash
$ snap model
brand   <brand-id>
model   ubuntu-core-20-amd64
grade   signed
serial  810d53c7-a741-9351-0a7e2b96095b
```

The contents of `/etc/os-release` show which version of Ubuntu Core is running:

```bash
$ cat /etc/os-release
NAME="Ubuntu Core"
VERSION="20"
ID=ubuntu-core
PRETTY_NAME="Ubuntu Core 20"
VERSION_ID="20"
HOME_URL="https://snapcraft.io/"
BUG_REPORT_URL="https://bugs.launchpad.net/snappy/"
```

## Model assertions

The model assertion defines which system snaps make up the device's operating system, including the gadget snap, kernel snap and the base snap with the (read-only) root filesystem.

On an Ubuntu Core 20 system, _kernel_ and _gadget_ snaps are installed from a `20` track, with the base snap being `core20`. The _snapd_ snap remains unchanged, as it's always at the latest version available.

Another important requirement for the updated model is the inclusion of a `revision` field.

The presence of a revision value permits an assertion to be updated to an updated assertion with a higher revision value. If no revision is specified, … a revision value of `0` is implied.

The updated model will need to be signed with the same key that the original model was signed with.

Reference unsigned model assertions can be found here: [https://github.com/canonical/models](https://github.com/canonical/models).

## Perform the upgrade

To manually upgrade a device running the original UC20 model assertion, first copy the signed and updated UC22 model assertion to the device. This can be accomplished in many ways, but _scp_ OpenSSH secure file copy is a good option:

```
scp <new-model.model-assertion> <sso-account-name>@<device-ip>:/home/<sso-account-name>
```

The final step is to run `sudo snap remodel <new-model.model-assertion>` on the device itself. The process will take some time and will involve several device restarts before eventually completing. You can then reconnect and check the upgrade was successful:

```bash
$ cat /etc/os-release
NAME="Ubuntu Core"
VERSION="22"
ID=ubuntu-core
PRETTY_NAME="Ubuntu Core 22"
VERSION_ID="22"
HOME_URL="https://snapcraft.io/"
BUG_REPORT_URL="https://bugs.launchpad.net/snappy/"
```

And also using the new model assertion:

```bash
$ snap model
brand   <brand-id>
model   ubuntu-core-22-amd64
grade   signed
serial  810d53c7-a741-9351-0a7e2b96095b
```
