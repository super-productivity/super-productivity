/**
 * DeviceService - Handles device-related queries
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles device ownership and online status queries.
 */
import { prisma } from '../../db';
import {
  DEVICE_TOUCH_THROTTLE_MS,
  ONLINE_DEVICE_THRESHOLD_MS,
  RETENTION_MS,
  SyncDeviceInfo,
} from '../sync.types';

/** Upper bound on rows `listDevices` returns, and so on the dialog's row count. */
const MAX_LISTED_DEVICES = 100;

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

  /**
   * List the devices that have synced with this account, newest activity first.
   *
   * Deliberately exposes no device name or user agent: the two nullable columns
   * for those are never written, and harvesting a hostname would put the first
   * user-identifying cleartext beyond the account email on a server whose whole
   * point is that op payloads are opaque to it. The clientId's platform prefix
   * (E/A/I/B) is enough to tell devices apart.
   *
   * The retention filter makes the "devices drop off the list after the
   * retention period" promise hold by construction — the daily cleanup job
   * deletes the rows eventually, but the list must not depend on when it last
   * ran. Capped because a clientId rotates on clean-slate/backup-restore, so an
   * account can accumulate rows within the retention window.
   */
  async listDevices(userId: number): Promise<SyncDeviceInfo[]> {
    const rows = await prisma.syncDevice.findMany({
      where: {
        userId,
        lastSeenAt: { gt: BigInt(Date.now() - RETENTION_MS) },
      },
      select: { clientId: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
      take: MAX_LISTED_DEVICES,
    });
    return rows.map((r) => ({
      clientId: r.clientId,
      lastSeenAt: Number(r.lastSeenAt),
    }));
  }

  /**
   * Record that `clientId` is alive, for the device list.
   *
   * Runs on every download, i.e. on every sync poll. The `WHERE` on the
   * `ON CONFLICT` clause is the throttle: at most one actual row write per
   * device per window, correct across instances and restarts. The suppressed
   * case still costs one single-PK-row statement per poll — deliberately not
   * cached in-process, because the window is 2x the default 1-minute poll
   * interval, so a process-local cache would only ever skip sub-minute bursts
   * of an already write-free statement.
   *
   * The INSERT half registers download-only devices, which the upload
   * transaction's upsert would otherwise never create.
   */
  async touchDevice(userId: number, clientId: string): Promise<void> {
    const nowBig = BigInt(Date.now());
    const staleBefore = nowBig - BigInt(DEVICE_TOUCH_THROTTLE_MS);
    await prisma.$executeRaw`
      INSERT INTO sync_devices (client_id, user_id, last_seen_at, last_acked_seq, created_at)
      VALUES (${clientId}, ${userId}, ${nowBig}::bigint, 0, ${nowBig}::bigint)
      ON CONFLICT (user_id, client_id) DO UPDATE
      SET last_seen_at = EXCLUDED.last_seen_at
      WHERE sync_devices.last_seen_at < ${staleBefore}::bigint
    `;
  }

  async deleteStaleDevices(beforeTime: number): Promise<number> {
    const result = await prisma.syncDevice.deleteMany({
      where: {
        lastSeenAt: { lt: BigInt(beforeTime) },
      },
    });
    return result.count;
  }
}
