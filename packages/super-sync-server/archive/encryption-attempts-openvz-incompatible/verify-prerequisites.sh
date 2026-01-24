#!/bin/bash
# Verify all prerequisites before setup

set -e

echo "Checking prerequisites for SuperSync encryption-at-rest..."

# Check required commands
command -v cryptsetup >/dev/null 2>&1 || { echo "❌ ERROR: cryptsetup not installed"; exit 1; }
command -v gpg >/dev/null 2>&1 || { echo "❌ ERROR: gnupg not installed"; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "❌ ERROR: rsync not installed"; exit 1; }
command -v numfmt >/dev/null 2>&1 || { echo "❌ ERROR: numfmt not installed (coreutils)"; exit 1; }
command -v iostat >/dev/null 2>&1 || { echo "❌ ERROR: iostat not installed (sysstat)"; exit 1; }

echo "✅ All required commands available"

# Check kernel modules
if ! lsmod | grep -q dm_crypt; then
  echo "❌ ERROR: dm-crypt kernel module not loaded"
  echo "   Run: modprobe dm-crypt"
  exit 1
fi
echo "✅ dm-crypt kernel module loaded"

# Check for AES-NI (warning only)
if ! grep -q aes /proc/cpuinfo; then
  echo "⚠️  WARNING: No AES-NI hardware acceleration detected"
  echo "   Encryption overhead may be 20-40% instead of 3-10%"
  echo "   Consider hardware with AES-NI support for production"
else
  echo "✅ AES-NI hardware acceleration available"
fi

# Check optional tools
if command -v diceware >/dev/null 2>&1; then
  echo "✅ diceware available for passphrase generation"
else
  echo "⚠️  WARNING: diceware not installed (optional)"
  echo "   Install with: pip install diceware"
fi

echo ""
echo "✅ All prerequisites satisfied! Ready to proceed with setup."
