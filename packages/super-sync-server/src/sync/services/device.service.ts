/**
 * DeviceService - Handles device-related queries
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles device ownership and online status queries.
 */
import { prisma } from '../../db';
import { ONLINE_DEVICE_THRESHOLD_MS } from '../sync.types';

export class DeviceService {
  /**
   * Check if a device (identified by clientId) belongs to a user.
   */
  async isDeviceOwner(userId: number, clientId: string): Promise<boolean> {
    const count = await prisma.syncDevice.count({
      where: { userId, clientId },
    });
    return count > 0;
  }

  /**
   * Get all user IDs that have sync state.
   * Used for batch operations like cleanup.
   */
  async getAllUserIds(): Promise<number[]> {
    const users = await prisma.userSyncState.findMany({
      select: { userId: true },
      distinct: ['userId'],
    });
    return users.map((u) => u.userId);
  }

  /**
   * Get count of devices that have been seen recently for a user.
   * A device is considered "online" if it was seen within the threshold.
   */
  async getOnlineDeviceCount(userId: number): Promise<number> {
    const threshold = Date.now() - ONLINE_DEVICE_THRESHOLD_MS;
    const count = await prisma.syncDevice.count({
      where: {
        userId,
        lastSeenAt: { gt: BigInt(threshold) },
      },
    });
    return count;
  }
}
