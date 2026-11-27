---
type: explanation
source: https://ubuntu.com/desktop/docs/en/latest/explanation/snap-and-deb-packages/
title: Snap and deb packages
domain: ubuntu
---

# Snap and deb packages

When installing apps on Ubuntu, you'll come across two official, recommended package formats: snap and deb packages.

## What a package is

Software is a very broad term, and is generally taken to mean a program that you can run on your computer. However, such programs often need other resources to work. When you install software, thousands of files may be required just to let the program start. When you think that they all have to be put in exactly the right location, and some of those files might need to be changed depending on what type of computer you have, it can all get very complicated.

Ubuntu uses packages to store everything that a particular program needs to run. A *package*, then, is essentially a collection of files bundled into a single file, which can be handled much more easily. In addition to the files required for the program to run, there are often special files called installation scripts, which copy the files to where they are needed and configure them.

### Source and binary

**Source code** is written by programmers and is essentially a list of instructions to a computer which humans are able to read and write. Computers can only understand this code if it is interpreted for them into a form that they can use directly. One such way of interpreting source code for a computer is by translating or *compiling* it into **binary**, which computers can understand. This binary is then compressed into a *binary package* together with other resources.

Different computers use different types of binary, so if you make a binary package for one type (like an Intel PC), it won't work on another (like an ARM system). This is why you can find the same package, or even the whole Ubuntu installation image, available in several versions for different computer architectures.

Ubuntu chooses the correct binary packages for your system automatically, so you don't have to worry about picking the right ones.

### Dependencies

Programs often use some of the same files as each other. Rather than putting these files into each package, a separate package can be installed to provide them for all of the programs that need them. So, to install a program that needs one of these files, the package containing those files must also be installed. When a package depends on another in this way, it is known as a package dependency. By specifying dependencies, packages can be made smaller and simpler, and duplicates of files and programs are mostly removed.

Snap and deb packages have different solutions to package dependencies.

## Snap packages

The App Center on Ubuntu Desktop shows snaps by default, both in the search and on the category pages. Snap apps are usually *sandboxed*, which means that you can limit which system resources they can access.

## Which one to install

If an app is available both as a snap and a deb, we generally recommend installing the snap version, especially if the app comes from a third-party developer.

The snap usually provides a more recent version of the app and ensures stronger security.
