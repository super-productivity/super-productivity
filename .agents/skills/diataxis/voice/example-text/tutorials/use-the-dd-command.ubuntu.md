---
type: tutorial
source: https://documentation.ubuntu.com/core/tutorials/try-pre-built-images/use-the-dd-command/
title: Use the dd command
domain: ubuntu
---

# Use the dd command

Ubuntu Core runs on a large range of hardware, and pre-built images are available for amd64 and Raspberry Pi reference platforms.

Installation on a reference platform is easy and a great way to quickly get started with Ubuntu Core, or to explore Ubuntu Core's features and evaluate its potential.

Below, we cover how to install a reference image of the latest version of Ubuntu Core on a small form factor PC NUC, however, these instructions will also work for most generic PC configurations too.

At the end of this tutorial, you'll be able to connect to your PC, install and configure applications, safe in the knowledge that Ubuntu Core will automatically keep your device updated and secure.

## Requirements

This tutorial is suitable for anyone with an interest in Ubuntu Core - no prior knowledge necessary, but you will need a few things first:

- A NUC or similar PC (internal storage will be erased, so make sure it's backed up).
- A secondary Windows, macOS, or Linux computer to flash an image.
- 6GB+ USB flash drive (this will also be erased, so make sure it's backed up).
- Connected screen and keyboard for installation.
- An Ubuntu SSO account with associated SSH keys.

Pre-built Ubuntu Core images do not use a username and password to login to the system. Instead, they uses SSH with SSH keys uploaded to your Ubuntu One account using the console-conf snap. SSH is not a requirement for other Ubuntu Core images.

Unlike installing Ubuntu Core on an IoT device, such as Installing Ubuntu Core a Raspberry Pi, NUC or PC installations require the Ubuntu Core image to be written directly to internal storage. This cannot be done from an operating system running on the same storage, and needs to be performed from an external storage device.

In this tutorial, we will first write and boot a _live_ version of Ubuntu to a USB flash drive, download Ubuntu Core, and write the Ubuntu Core image to the device's internal storage.

Alongside enough flash storage to hold an Ubuntu image (6GB+), you will need a screen and keyboard connected to the device. These are required for installation, but neither are needed after setup has completed. You may also need to check the BIOS configuration of your device to make sure it can boot from USB devices.

After Ubuntu Core is up and running, if you want to access your device remotely, you'll need an SSH client for your operating system. Linux and macOS both have clients built-in, whereas Windows users can use [Ubuntu on WSL](https://ubuntu.com/wsl).

## Install Ubuntu Core from live Ubuntu desktop

Connect the your freshly flashed USB device to your target NUC or PC and make sure it's configured to boot from an external USB device, either via function-key triggered boot menu, via a BIOS setting, or simply by default.

Turn on the machine and if it's booting correctly from the USB device, it will show the GNU GRUB boot menu. Select the default option, **Try or Install Ubuntu** to launch the desktop.

Similarly, when the desktop appears, select **Try Ubuntu** rather than proceeding with the installation.

From the live desktop that now appears, we need to do three things:

1. **Download Ubuntu Core**
   Ubuntu Core images are hosted at:
   [https://cdimage.ubuntu.com/ubuntu-core/26/stable/current/](https://cdimage.ubuntu.com/ubuntu-core/26/stable/current/)

   Images are compressed with *XZ* and have a corresponding `.xz` file extension.

   Use Firefox to download the following amd64 image for your device:
   [ubuntu-core-26-amd64.img.xz](https://cdimage.ubuntu.com/ubuntu-core/26/stable/current/ubuntu-core-26-amd64.img.xz) **(450MB)**

1. **Discover the internal storage device name**
   This is usually `/dev/sda` but it's important to first make sure. One of the easiest ways is to open _GPartEd_ and use the drop-down menu in the top-right to select the correct device. You'll see storage space and layout below. Make a note of the device name.

1. **Write the Ubuntu Core image to internal storage**
   Open the terminal application and enter the following command, adjusting the paths to the Ubuntu Core download and the internal storage device accordingly:

   ```bash
   xzcat ~/Downloads/ubuntu-core-26-amd64.img.xz | \
   sudo dd of=/dev/<target disk device> bs=32M status=progress; sync
   ```

**Your internal storage will be irrevocably overwritten**. Please make sure anything you wish to keep is backed-up before you start. After the write process has completed, you can safely restart and reboot your machine, which will then trigger the Ubuntu Core installation process.

## Boot Ubuntu Core for the first time

When your device boots for the first time, you will see the following error message. This can be safely ignored:

```
Error: no such device ubuntu-boot
```

It can take a few minutes the system to instantiate itself. You will see typical Linux output on the screen, periods where there's just a flashing cursor, and messages like _Installing the system, please wait for a reboot_. When this process has finished, you will see the following:

`Press enter to configure.`

Press **Enter** and you will see a small menu with a single item:

`Configure the network and setup an administrator account on this all-snap Ubuntu Core system.`

Press **Enter** again and you will be taken to the network setup page.

## Connect to the device

Each time the device starts up, if a display connected it will show its various addresses and the account linked to the device.

You can now connect to your Ubuntu Core machine with the _ssh_ command and your username followed by the IP address of your device:

```text
$ ssh account@10.0.2.15
The authenticity of host '10.0.2.15 (10.0.2.15)' can't be established.
ECDSA key fingerprint is SHA256:EiZUZG50l1Dvr1/aR940EX/lKW4qLfkRiMaMFwuzuf8
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added '10.0.2.15' (ECDSA) to the list of known hosts.
[...]
This Ubuntu Core machine is a tiny, transactional edition of Ubuntu,
designed for appliances, firmware and fixed-function VMs.
```

As shown above, the first time you connect to a new device you will be asked to accept its authenticity. You can check the _ECDSA_ key fingerprint against the finger print shown on the screen after a first reboot. ECDSA is the second one listed.

Congratulations! You have successfully downloaded, installed, and connected to Ubuntu Core on your PC.
