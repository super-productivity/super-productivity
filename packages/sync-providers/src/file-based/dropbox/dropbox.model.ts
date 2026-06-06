export type DropboxTimestamp = string;
export type DropboxRev = string;

export interface DropboxMetadata {
  /**
   * The last component of the path (including extension). This never
   * contains a slash.
   */
  name: string;
  /**
   * The lowercased full path in the user's Dropbox. This always starts with
   * a slash. This field will be null if the file or folder is not mounted.
   */
  path_lower?: string;
  /**
   * The cased path to be used for display purposes only. In rare instances
   * the casing will not correctly match the user's filesystem, but this
   * behavior will match the path provided in the Core API v1, and at least
   * the last path component will have the correct casing. Changes to only
   * the casing of paths won't be returned by listFolderContinue(). This
   * field will be null if the file or folder is not mounted.
   */
  path_display?: string;
  /**
   * Please use FileSharingInfo.parent_shared_folder_id or
   * FolderSharingInfo.parent_shared_folder_id instead.
   */
  parent_shared_folder_id?: string;
}

export interface DropboxFileMetadata extends DropboxMetadata {
  /**
   * A unique identifier for the file.
   */
  id: string;
  /**
   * For files, this is the modification time set by the desktop client when
   * the file was added to Dropbox. Since this time is not verified (the
   * Dropbox server stores whatever the desktop client sends up), this
   * should only be used for display purposes (such as sorting) and not, for
   * example, to determine if a file has changed or not.
   */
  client_modified: DropboxTimestamp;
  /**
   * The last time the file was modified on Dropbox.
   */
  server_modified: DropboxTimestamp;
  /**
   * A unique identifier for the current revision of a file. This field is
   * the same rev as elsewhere in the API and can be used to detect changes
   * and avoid conflicts.
   */
  rev: DropboxRev;
  /**
   * The file size in bytes.
   */
  size: number;
  /**
   * Additional information if the file is a photo or video. This field will
   * not be set on entries returned by listFolder(), listFolderContinue(),
   * or getThumbnailBatch(), starting December 2, 2019.
   */
  media_info?: unknown;
  /**
   * Set if this file is a symlink.
   */
  symlink_info?: unknown;
  /**
   * Set if this file is contained in a shared folder.
   */
  sharing_info?: unknown;
  /**
   * Defaults to True.
   */
  is_downloadable?: boolean;
  /**
   * Information about format this file can be exported to. This filed must
   * be set if is_downloadable is set to false.
   */
  export_info?: unknown;
  /**
   * Additional information if the file has custom properties with the
   * property template specified.
   */
  property_groups?: Array<unknown>;
  /**
   * This flag will only be present if include_has_explicit_shared_members
   * is true in listFolder() or getMetadata(). If this  flag is present, it
   * will be true if this file has any explicit shared  members. This is
   * different from sharing_info in that this could be true  in the case
   * where a file has explicit members but is not contained within  a shared
   * folder.
   */
  has_explicit_shared_members?: boolean;
  /**
   * A hash of the file content. This field can be used to verify data
   * integrity. For more information see our
   * [Content hash]{@link https://www.dropbox.com/developers/reference/content-hash} page.
   */
  content_hash?: string;
}
