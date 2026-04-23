/** Typed IPC channel names shared between main and renderer. */
export const IPC = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',

  // Drive operations
  DRIVE_GET_ROOT: 'drive:get-root',
  DRIVE_LIST_CHILDREN: 'drive:list-children',
  DRIVE_GET_NODE: 'drive:get-node',
  DRIVE_CREATE_FOLDER: 'drive:create-folder',
  DRIVE_RENAME_NODE: 'drive:rename-node',
  DRIVE_MOVE_NODES: 'drive:move-nodes',
  DRIVE_TRASH_NODES: 'drive:trash-nodes',
  DRIVE_RESTORE_NODES: 'drive:restore-nodes',
  DRIVE_DELETE_NODES: 'drive:delete-nodes',
  DRIVE_DOWNLOAD_NODE: 'drive:download-node',
  DRIVE_UPLOAD_FILE: 'drive:upload-file',
  DRIVE_CANCEL_UPLOAD: 'drive:cancel-upload',
  DRIVE_GET_THUMBNAIL: 'drive:get-thumbnail',

  // Sharing
  SHARE_GET_INFO: 'share:get-info',
  SHARE_NODE: 'share:node',
  SHARE_UNSHARE_NODE: 'share:unshare-node',
  SHARE_GET_LINK: 'share:get-link',

  // Sync
  SYNC_START: 'sync:start',
  SYNC_STOP: 'sync:stop',
  SYNC_PAUSE: 'sync:pause',
  SYNC_RESUME: 'sync:resume',
  SYNC_GET_STATUS: 'sync:get-status',

  // Transfers
  TRANSFERS_GET_ALL: 'transfers:get-all',
  TRANSFERS_CANCEL: 'transfers:cancel',
  TRANSFERS_PAUSE: 'transfers:pause',
  TRANSFERS_RESUME: 'transfers:resume',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHOOSE_FOLDER: 'settings:choose-folder',

  // Main -> renderer push events
  EVENT_NODE_UPDATED: 'event:node-updated',
  EVENT_NODE_DELETED: 'event:node-deleted',
  EVENT_SYNC_STATUS_CHANGED: 'event:sync-status-changed',
  EVENT_TRANSFER_PROGRESS: 'event:transfer-progress',
  EVENT_TRANSFER_COMPLETED: 'event:transfer-completed',
  EVENT_TRANSFER_ERROR: 'event:transfer-error',
  EVENT_AUTH_EXPIRED: 'event:auth-expired',
  EVENT_NOTIFICATION: 'event:notification',
} as const;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginRequest {
  username: string;
  password: string;
  totp?: string;
}

export interface LoginResponse {
  ok: boolean;
  requireTotp?: boolean;
  error?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  username?: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Nodes (simplified for IPC, not the full SDK NodeEntity)
// ---------------------------------------------------------------------------

export type IpcNodeType = 'file' | 'folder';

export interface IpcNode {
  uid: string;
  parentUid?: string;
  name: string;
  type: IpcNodeType;
  mediaType?: string;
  size?: number;
  creationTime: number; // Unix epoch ms
  modificationTime: number;
  isShared: boolean;
  isSharedPublicly: boolean;
  isTrashed: boolean;
  hasThumbnail: boolean;
}

export interface IpcTransfer {
  id: string;
  nodeUid?: string;
  parentUid?: string;
  fileName: string;
  direction: 'upload' | 'download';
  status: 'pending' | 'active' | 'paused' | 'completed' | 'error';
  /** 0-100 */
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
  error?: string;
  startTime: number;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'paused' | 'error' | 'offline';
  pendingItems: number;
  lastSyncTime?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  syncFolderPath: string;
  vfsMountPath: string;
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  showNotifications: boolean;
  /** 'virtual' = FUSE on-demand; 'full' = full local copy */
  syncMode: 'virtual' | 'full';
  language: string;
  theme: 'system' | 'light' | 'dark';
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export interface ShareMember {
  uid: string;
  email: string;
  role: 'viewer' | 'editor' | 'admin';
  inviteTime: number;
}

export interface PublicLinkInfo {
  uid: string;
  url: string;
  role: 'viewer' | 'editor';
  expirationTime?: number;
  customPassword?: string;
  numberOfDownloads: number;
}

export interface ShareInfo {
  members: ShareMember[];
  publicLink?: PublicLinkInfo;
  editorsCanShare: boolean;
}

export interface ShareNodeRequest {
  nodeUid: string;
  emails?: Array<{ email: string; role: 'viewer' | 'editor' }>;
  publicLink?: {
    enabled: boolean;
    role?: 'viewer' | 'editor';
    customPassword?: string;
    expirationDays?: number;
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationPayload {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}
