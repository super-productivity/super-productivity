import { warn } from 'electron-log/main';
import { randomBytes } from 'crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname } from 'path';

/*
 * Small secrets owned by the main process — credentials for the loopback APIs
 * that exist on this one machine and must never reach the synced config. They
 * are kept in 0600 files under userData, written so that a crash, a permissive
 * filesystem or a planted symlink can never leave a readable or redirected copy.
 */

/**
 * Restores the 0600 the token file is supposed to have, or reports that it
 * could not. A file that ends up group- or world-readable — restored from a
 * backup, copied with a permissive umask, moved off a filesystem that has no
 * modes — is otherwise served happily for as long as the user never presses
 * Regenerate, which is the one path that used to fix it.
 */
export const restrictSecretFileMode = (filePath: string, label: string): boolean => {
  // POSIX modes carry no meaning on Windows (`statSync` reports a synthesised
  // 0666/0444 from the read-only flag); access there is governed by the ACL the
  // file inherits from userData.
  if (process.platform === 'win32') {
    return true;
  }
  try {
    if ((statSync(filePath).mode & 0o077) === 0) {
      return true;
    }
    chmodSync(filePath, 0o600);
    // chmod() is allowed to report success without changing anything — a CIFS
    // mount without unix extensions is the documented case — so the one thing
    // worth reading back is the mode it claims to have set. Without this the
    // fail-closed path below never fires on exactly the filesystems that need
    // it, and a world-readable credential is served as if it were locked down.
    if ((statSync(filePath).mode & 0o077) !== 0) {
      warn(
        `[secure-file] The ${label} file is still readable by other accounts ` +
          'after chmod — this filesystem does not enforce POSIX modes',
      );
      return false;
    }
    return true;
  } catch (error) {
    warn(`[secure-file] Could not restrict the ${label} file mode`, error);
    return false;
  }
};

/**
 * Reads a secret written by writeSecretFile(), or returns undefined when it is
 * missing, malformed, or cannot be made private.
 */
export const readSecretFile = (
  filePath: string,
  pattern: RegExp,
  label: string,
): string | undefined => {
  try {
    if (!existsSync(filePath)) {
      return undefined;
    }
    const token = readFileSync(filePath, 'utf8').trim();
    // Only accept what the writer could have written: a truncated or otherwise
    // corrupted file must not silently become the live credential.
    if (!pattern.test(token)) {
      warn(`[secure-file] Ignoring malformed ${label} file — generating a new one`);
      return undefined;
    }
    // Fail closed if it cannot be locked down: discarding it mints a fresh
    // token into a fresh 0600 file, which costs the user their old token but
    // never keeps serving one that everyone on the machine can read.
    if (!restrictSecretFileMode(filePath, label)) {
      return undefined;
    }
    return token;
  } catch (error) {
    warn(`[secure-file] Failed to read ${label} file`, error);
    return undefined;
  }
};

/**
 * Tries to make the *directory entry* created by renameSync() durable. On POSIX the
 * rename is atomic but not crash-safe until the parent directory is fsynced, so
 * without this an abrupt power loss can bring the previous token back after a
 * regeneration that reported success — exactly the guarantee persistToken()
 * exists to make. Best effort by design, and therefore best-effort crash
 * resistance rather than a durability guarantee: the rename already happened
 * and the new token is on disk, so a filesystem that refuses to fsync a
 * directory must not turn a completed write into a failed one — the failure is
 * logged and the rotation still reports success.
 */
export const fsyncDirectory = (dirPath: string): void => {
  // Windows has no directory-fsync equivalent — opening a directory for reading
  // fails outright — and NTFS metadata ordering makes the rename durable anyway.
  if (process.platform === 'win32') {
    return;
  }
  let dirFd: number | undefined;
  try {
    dirFd = openSync(dirPath, 'r');
    fsyncSync(dirFd);
  } catch (error) {
    warn('[secure-file] Could not fsync the secret file directory', error);
  } finally {
    if (dirFd !== undefined) {
      try {
        closeSync(dirFd);
      } catch {
        // Nothing useful left to do with the descriptor.
      }
    }
  }
};

/**
 * Writes the token or throws. Everything up to and including the rename is
 * deliberately not swallowed: the caller must never activate a token that did
 * not reach the disk. The directory fsync that follows the rename is the one
 * exception — the token is already on disk by then, so turning that into a
 * throw would report a failed rotation for a write that actually succeeded,
 * and leave the new token to go live on the next launch while the caller keeps
 * serving the old one. fsyncDirectory() logs instead.
 */
export const writeSecretFile = (filePath: string, token: string, label: string): void => {
  // Write a sibling temp file and rename it into place. rename() is atomic, so
  // a crash mid-write cannot leave a half-written token behind.
  //
  // The suffix is random and the open below is exclusive, because the temp path
  // is the weak point of this sequence: a predictable name lets anyone who can
  // create entries in this directory pre-plant a symlink there, and 'w' would
  // follow it — writing the token into a file outside the profile and then
  // renaming the *symlink* into place, so every later read and rotation stays
  // redirected. 'wx' alone would close that, but on a pid-derived name it also
  // refuses to run once a leftover temp from a hard kill is met by a run that
  // draws the same pid, which needs stale-temp handling to undo. A random name
  // has nothing to pre-plant and makes EEXIST unreachable in practice, so the
  // two together need no such recovery. The trade is that a hard kill inside
  // the window orphans a temp file — empty, partial, or the whole 32 bytes,
  // depending on where it lands — that no later run reclaims.
  //
  // What this does not close: renameSync() resolves the name again rather than
  // the open descriptor, so an attacker who renames the temp entry away after
  // the open and leaves a symlink at that path still redirects the result. That
  // needs a won race instead of a file planted at leisure, and it needs the
  // authority to rename an entry this process owns — which a sticky directory
  // denies even when it is world-writable, and which is enough to replace the
  // token file itself where it is not.
  const tmpFilePath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
  let fd: number | undefined;

  try {
    fd = openSync(tmpFilePath, 'wx', 0o600);
    // `mode` is a request, not a guarantee: a filesystem that does not enforce
    // POSIX modes can create the file group- or world-readable regardless.
    fchmodSync(fd, 0o600);
    // And verify it through the same descriptor rather than trusting the call:
    // fchmod() can succeed without effect on a filesystem that does not enforce
    // POSIX modes. Throwing keeps the write closed, so a token never goes live
    // out of a file other accounts can read.
    if (process.platform !== 'win32') {
      const mode = fstatSync(fd).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        throw new Error(
          `Refusing to store the ${label}: the filesystem left ` +
            `it at mode 0${mode.toString(8)} instead of 0600, so other accounts on ` +
            `this machine could read it.`,
        );
      }
    }
    // Only now, once the descriptor is known to be private, does the secret
    // reach the disk. Writing first would put it in a readable file for the
    // length of the check on exactly the filesystems that check exists for.
    writeFileSync(fd, token, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpFilePath, filePath);
    fsyncDirectory(dirname(filePath));
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Already failing; nothing useful left to do with the descriptor.
      }
    }
    try {
      unlinkSync(tmpFilePath);
    } catch {
      // Best effort: there may be nothing to clean up.
    }
    throw error;
  }
};
