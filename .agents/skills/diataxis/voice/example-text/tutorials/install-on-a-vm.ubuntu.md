---
type: tutorial
source: https://documentation.ubuntu.com/core/tutorials/try-pre-built-images/install-on-a-vm/
title: Install on a VM
domain: ubuntu
---

# Install on a VM

You can try Ubuntu Core without any specific hardware from within a virtual machine using [Multipass](https://canonical.com/multipass) on Windows, Mac and Linux. Multipass has integrated support for the latest Ubuntu Core images and can launch and run virtual machines from a single command.

For deployment in the field, you would normally build a custom Ubuntu Core image that includes your required snaps, configuration, permissions and update policy. Pre-built images are useful for exploration, but a product image should be described by your own model assertion and built for your target device.

## Boot Ubuntu Core with Multipass

If it's not already installed, install the latest version of [Multipass](https://canonical.com/multipass/install):

```bash
snap install multipass
```

### List available images

To list which images Multipass currently has available, type `multipass find`.

The output will include Ubuntu Core images alongside standard Ubuntu images:

```text
Image        Aliases           Version          Description
[...]
core18                         20211124         Ubuntu Core 18
core20                         20230119         Ubuntu Core 20
core22                         20230717         Ubuntu Core 22
core24                         20240603         Ubuntu Core 24
core26                         20260506         Ubuntu Core 26
[...]
```

### Launch an image

To create a new instance and boot your choice of Ubuntu Core image, type:

```bash
multipass launch <image-name> -n <instance-name>
```

For example, the following command will launch and boot core26 with an instance name of `mycore26`:

```bash
multipass launch core26 -n mycore26
```

The image is downloaded and locally cached when it's launched for the first time.

### Access a running instance

You can connect to a running instance of Ubuntu Core by opening a shell environment on that running instance:

```bash
multipass shell mycore26
```
