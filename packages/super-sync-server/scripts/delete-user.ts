import { prisma, disconnectDb } from '../src/db';
import { Logger } from '../src/logger';

const deleteUser = async (email: string) => {
  try {
    // Check if user exists first
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      Logger.warn(`User with email "${email}" not found.`);
      return;
    }

    // Delete user
    // Cascading deletes in schema will handle related data (operations, syncState, etc.)
    await prisma.user.delete({
      where: { id: user.id },
    });

    Logger.info(`Successfully deleted user: ${email}`);
  } catch (error) {
    Logger.error('Error deleting user:', error);
    process.exit(1);
  } finally {
    await disconnectDb();
  }
};

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.error('Please provide an email address.');
  console.error('Usage: npm run delete-user -- <email>');
  process.exit(1);
}

deleteUser(email);
