---
type: how-to
source: https://documentation.ubuntu.com/core/how-to-guides/manage-ubuntu-core/gadget-boot-assets/
title: Updating gadget boot assets
domain: ubuntu
---

# Updating gadget boot assets

A [gadget snap's](https://snapcraft.io/docs/the-gadget-snap) boot assets can be automatically updated when the snap is refreshed. It's the responsibility of the gadget snap publisher to ensure the correctness and consistency of the update data, as outlined below.

- the update process relies heavily on the information provided in `gadget.yaml` as it attempts to verify the internal consistency of the gadget description
- gadget and kernel snap versions are not coupled. This means updated boot assets must be able to boot the old and new kernels of a given gadget
- a device will reboot after boot assets have been updated

## Enabling boot asset updates

Automatic boot asset updates are enabled by adding an `update` section below the `structure:` definition in a gadget snap's gadget.yaml:

```yaml
volumes:
  my-volume:
    structure:
      - name: some-structure
        ..
        update:
          edition: 2
```

The `edition` property identifies the version of assets for a particular `structure`.

Updates are performed when the `edition` value is higher than the value in the currently installed gadget snap. If this is the case, *snapd* next attempts to analyze the currently written assets so that only those that differ are updated.

### Backup and rollback

When an update is performed, snapd first creates a backup of all modified boot assets for both filesystem and non-filesystem structures. Backups are kept on the `writable` partition inside the snapd *state* directory and are cleaned-up after an update has been applied.

A rollback is only performed when the process of writing updated boot assets fails. Once the assets have been written, the changes will not be undone, even if a later step of snap installation fails.

## Volume and structures

Snapd analyzes the `volumes` declaration in `gadget.yaml` to map its members against partitions on the main block device used by the system.

A volume layout is built with the following constraints:

- **512 byte** sector size
- **1MB** default starting offset for the first non-MBR partition, unless otherwise specified

The volume layout describes the exact position of each structure (partition) and their content. At runtime, structures are identified by either their defined `name` or a `filesystem-label`:

- `name` structures are identified using `/dev/disk/by-partlabel` symlinks
- `filesystem-label` structures are identified using `/dev/disk/by-label` symlinks

Both `name` and `filesystem-label` must be unique amongst all named structures and labelled filesystems.

Volume structures obviously need to be named, and the filesystem needs to be labelled, to allow snapd to easily identify corresponding partitions and mount locations.

## Caveats

Currently, boot asset updates have the following limitations:

- the gadget snap can have only one defined volume
- the updated gadget snap must use the same structure-level layout
- once all of changed boot assets have been updated, the original files and images will not be restored from the backup, even if a later step of the installation fails
- a device will still reboot when an update is applied, even when no boot assets are effectively changed
- there must be enough space on the `writable` partition to hold a backup copy of all modified boot assets

The following are also unsupported:

- encrypted or otherwise nested structures, such as LVM volumes
- using `preserve` inside non-filesystem structures
- updating unnamed and unlabelled filesystem structures
- updating devices not described inside `gadget.yaml`, such as the _BOOT1/2_ regions of SD cards
