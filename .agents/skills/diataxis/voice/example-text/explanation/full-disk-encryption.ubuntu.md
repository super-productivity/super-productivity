---
type: explanation
source: https://documentation.ubuntu.com/core/explanation/full-disk-encryption/
title: Full disk encryption
domain: ubuntu
---

# Full disk encryption

Ubuntu Core uses full disk encryption (FDE) whenever the hardware allows, protecting both the confidentiality and integrity of a device's data when there's physical access to a device, or after a device has been lost or stolen.

Built-in FDE support requires both UEFI Secure Boot and TPM 2.0 (Trusted Platform Module) support. A device will also need an IOMMU to secure data transfers.

External I2C/SPI-based TPM modules are not currently supported.

Otherwise, the full disk encryption implementation in Ubuntu Core is generic and widely compatible to help support a range of hardware.

TPM-based FDE seals the FDE secret key to the full EFI state, including the kernel command line, which is subsequently unsealed by the initrd code in the secure-boot protected _kernel.efi_ at boot time.

The following factors affect how a device is encrypted:

- Storage layouts: the potential partitions created on the device
- Disabling encryption: an optional parameter that can disable encryption
- Model grade: interacts with _storage-safety_ to set the device constraints

For a non-standard (non-UEFI+TPM platform) FDE platform, such as a Raspberry Pi or other ARM devices, implementation is board-specific and will typically involve creating custom gadget and kernel snaps. UC20/UC22, however, do provide a helper mechanism, via a hook interface, to ensure the integrity of any subsequently executed or accessed data.

## Storage layouts

The layout of the generated image used to install Ubuntu Core, and the resultant storage on the device, is described by the gadget snap and its associated `gadget.yaml`.

On first boot, Ubuntu Core will create and populate the following storage partitions:

- **ubuntu-seed** (role: system-seed; *read-only*, *ext4* or typically *vfat*)
- **ubuntu-boot** (role: system-boot; *read-only*, *ext4* or *vfat*)
- **ubuntu-save** (role: system-save; *writable*, *ext4*, **encrypted**)
- **ubuntu-data** (role: system-data; *writable*, *ext4*, **encrypted**)

**ubuntu-save** is mandatory on an encrypted system. The _initramfs_ bootstrapped from **ubuntu-boot** is responsible for decrypting both the **ubuntu-save** and **ubuntu-data** partitions.

The system boot process:

1. verifies the bootloaders and kernel signatures
1. measures the above and the kernel command line with the TPM
1. on-top of the above _trusted set_, the snapd initrd code measures the snap device model
1. snapd then separately verifies other snaps with their assertions as needed

When run normally, the snap content comes from snaps in the encrypted data partition, with the exception of the kernel image which is loaded from the system boot partition via secure boot. In any case the unsealing of the disk encryption key(s) is tied to the correct TPM boot measurements.

If an encrypted drive is detected, but the TPM does not contain a valid key, the Ubuntu Core boot process will prompt for a recovery key.

For more information on how Ubuntu Core uses these partitions, what they contain, and how they boot, see Storage layout.

## Disabling encryption

It is sometimes desirable to install Ubuntu Core without encryption, even when the device hardware supports it.

This option is provided by the "storage-safety" setting in the model assertion used to build the installable image. It can be set to one of the following:

- **encrypted**: ensure encryption is used and fail if the device does not support it.
- **prefer-encrypted**: do encrypt if the hardware supports it.
- **prefer-unencrypted**: do not encrypt by default, even if the device supports encryption.

## Model grade

The `grade` option in the model assertion is used to set the constraints for the device. It can be one of the following:

- **dangerous**: relax some of the constraints here (mandatory snap id for example), and should allow for the use of unasserted snaps, devmode snaps, or the presence of extra snaps in the recovery system. These relaxations are meant for development and not for production system use as they weaken the system security.
- **signed** (default): no unasserted (unsigned) snaps or snaps not mentioned in the model can appear or be used in the recovery system.
- **secured**: same properties as signed plus it is mandatory for the device to use full disk encryption and secure boot.

The `snap model` command can be used to view the currently running model declaration, including its _grade_ and _storage-safety_ values:

```bash
snap model --verbose
brand-id:      bJzr2XzZg6Qv6Z53HIeziXyxtn1XItIq
model:         ubuntu-core-20-amd64
grade:         signed
serial:        0fb187ff-a037-42ca-b0d6-1a802245e799
architecture:  amd64
base:          core20
timestamp:     today at 08:54 UTC
```

Note: `grade:secured` is the same as `grade:signed` and `storage-safety:encrypted`.
`storage-safety:prefer-encrypted` is the same as `unset`
