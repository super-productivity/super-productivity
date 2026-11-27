---
type: reference
source: https://documentation.ubuntu.com/core/reference/gadget-snap-format/
title: Gadget snap format
domain: ubuntu
---

# Gadget snap format

The gadget snap is responsible for defining and configuring system properties specific to one or more devices.

The gadget metadata and content defines:

- The layout of the volumes that comprise the device storage and image
- Configuration for the bootloader to use. The gadget also ships the bootloader itself and other boot assets.
- Default configuration options to use when snaps are installed.
- Interface connections configured in the `connections:` section are executed on the device's first boot only. Later changes to this section -- that is, changes added to the device at run time through gadget refreshes -- are not applied.
- Optional hooks that are invoked to control and customize the behavior over the device lifecycle, e.g. installation, initialisation and establishing device identity, factory reset.

## Setup files

In addition to traditional snap metadata, the gadget snap also holds some setup files fundamental to the initialisation and lifecycle of the device:

- **meta/snap.yaml**: traditional snap details, with `type: gadget` explicitly defined.
- **meta/gadget.yaml**: gadget-specific information. See below.
- **grub.conf**: marker file that declares that the gadget needs the grub bootloader and that files in the seed and boot partitions are used to store grub environment.
- **uboot.conf**: marker file that declares that the gadget needs the U-Boot bootloader and that files in the seed and boot partitions are used to store U-Boot environment. (Note: this is not needed when using a system-boot-state partition.)
- **cloud.conf**: optional cloud-init configuration; cloud-init is disabled if missing. Using cloud-init is _not recommended_ for production devices, and should only be included for testing and development purposes.

## The gadget.yaml file

Two YAML keys are used to describe your target device:

- **defaults** (YAML sub-section, optional): default configuration options for the defined snaps, applied on installation:

  ```yaml
  defaults:
        <snap id>:
            <key>: <value>
  ```

  In addition to `<snap id>`, it is also possible to use `system` to define system-wide configuration options, similar to running `snap set system key=value`:

  ```yaml
  defaults:
        system:
            <key>: <value>
  ```

- **volumes** (YAML sub-section, required): the volumes layout, where each disk image is represented as a YAML sub-section.

### The volumes mapping sub-section

Each volume entry is described by:

- a name as defined by the entry key
- a partition structure (required)
- a bootloader definition (`grub`, `u-boot`)
- a partitioning schema eg. `mbr`. Defaults to `gpt` if unspecified.

Volumes define the structure and content of the images to be written into one or more block devices of the gadget device. Each volume in the mapping represents a different image for a "disk" in the device.

Ubuntu Core typically uses the following storage partitions:

- **ubuntu-seed** (role: system-seed; *read-only, ext4 or typically vfat*)
- **ubuntu-boot** (role: system-boot; *read-only, ext4* or *vfat*)
- **ubuntu-save** (role: system-save; *writable, ext4*, **encrypted**)
- **ubuntu-data** (role: system-data; *writable*, ext4, **encrypted**)

**ubuntu-save** is mandatory on an encrypted system. The *initramfs* bootstrapped from **ubuntu-boot** is responsible for decrypting both the **ubuntu-save** and **ubuntu-data** partitions.

**ubuntu-data** needs to be the last partition. No extra partitions can be inserted between **ubuntu-boot**, **ubuntu-save** and **ubuntu-data**. If extra partitions are required, they need to be declared and created before **ubuntu-boot**.

The structure section lists entities with gadget data inside the image, most of which are partitions with a file system inside, with the exception of structures of type: bare, which can describe a region of data without a corresponding entry in the partition table.
