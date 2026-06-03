/**
 * Migration script to fix passkey credential IDs that were stored with double-encoding.
 *
 * The bug: SimpleWebAuthn's credentialInfo.id is a Uint8Array containing the base64url
 * string as UTF-8 bytes. We incorrectly stored these bytes directly, then when looking
 * up during login, the browser sends the actual base64url string which we decode to
 * raw bytes - but the database has the ASCII bytes of the base64url string, not the
 * raw credential ID bytes.
 *
 * This script:
 * 1. Reads all passkeys
 * 2. Converts stored bytes (ASCII of base64url) → utf-8 string → decode base64url → raw bytes
 * 3. Updates with the correct raw bytes
 *
 * Run with: npx ts-node prisma/migrations/migrate-passkey-credentials.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migratePasskeyCredentials = async (): Promise<void> => {
  console.log('Starting passkey credential ID migration...\n');

  const passkeys = await prisma.passkey.findMany({
    select: {
      id: true,
      credentialId: true,
      userId: true,
    },
  });

  console.log(`Found ${passkeys.length} passkeys to check\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const passkey of passkeys) {
    try {
      // Convert stored bytes to UTF-8 string (this gives us the base64url string)
      const storedAsUtf8 = passkey.credentialId.toString('utf-8');

      // Check if it looks like a valid base64url string
      // Base64url uses only A-Z, a-z, 0-9, -, _
      const isBase64url = /^[A-Za-z0-9_-]+$/.test(storedAsUtf8);

      if (!isBase64url) {
        console.log(
          `Passkey ${passkey.id}: Already migrated or invalid format, skipping`,
        );
        skipped++;
        continue;
      }

      // Decode base64url to get raw credential ID bytes
      const rawCredentialId = Buffer.from(storedAsUtf8, 'base64url');

      // Verify the conversion makes sense (raw bytes should be shorter than base64url string bytes)
      if (rawCredentialId.length >= passkey.credentialId.length) {
        console.log(
          `Passkey ${passkey.id}: Unexpected size after decode, skipping (stored=${passkey.credentialId.length}, decoded=${rawCredentialId.length})`,
        );
        skipped++;
        continue;
      }

      console.log(`Passkey ${passkey.id} (user ${passkey.userId}):`);
      console.log(`  Old (hex): ${passkey.credentialId.toString('hex')}`);
      console.log(`  Old as UTF-8 (base64url): ${storedAsUtf8}`);
      console.log(`  New raw (hex): ${rawCredentialId.toString('hex')}`);
      console.log(`  New as base64url: ${rawCredentialId.toString('base64url')}`);

      // Update the credential ID
      await prisma.passkey.update({
        where: { id: passkey.id },
        data: { credentialId: rawCredentialId },
      });

      console.log(`  ✓ Migrated successfully\n`);
      migrated++;
    } catch (err) {
      console.error(`Passkey ${passkey.id}: Error - ${err}`);
      errors++;
    }
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total passkeys: ${passkeys.length}`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
};

migratePasskeyCredentials()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
