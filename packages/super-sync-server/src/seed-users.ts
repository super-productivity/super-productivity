/**
 * Seed users from the SEED_USERS environment variable.
 *
 * Creates verified users on startup and logs their access tokens.
 * Existing users are skipped (not modified).
 *
 * Format: SEED_USERS=email1@example.com,email2@example.com
 */
import * as jwt from 'jsonwebtoken';
import { prisma } from './db';
import { getJwtSecret, JWT_EXPIRY } from './auth';
import { Logger } from './logger';

export const seedUsers = async (): Promise<void> => {
  const seedList = process.env.SEED_USERS;
  if (!seedList) return;

  const emails = seedList
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  if (emails.length === 0) return;

  const JWT_SECRET = getJwtSecret();

  Logger.info(`Seeding ${emails.length} user(s)...`);

  for (const email of emails) {
    let user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, tokenVersion: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          isVerified: 1,
          tokenVersion: 0,
        },
        select: { id: true, email: true, tokenVersion: true },
      });
      Logger.info(`Seeded new user: ${email} (id=${user.id})`);
    } else {
      Logger.info(`Seed user already exists: ${email} (id=${user.id})`);
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, tokenVersion: user.tokenVersion ?? 0 },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY },
    );

    Logger.info(`Token for ${email}: ${token}`);
  }
};
