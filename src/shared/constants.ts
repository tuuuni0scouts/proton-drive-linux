export const APP_NAME = 'LinuxDrive';
export const APP_VERSION = '0.1.0';

/**
 * x-pm-appversion header sent with every request.
 * Must satisfy regex from SDK docs:
 * /^(external-drive)+(-[a-z_]+)+@[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?-((stable|beta|RC|alpha)(([.-]?\d+)*)?)?([.-]?dev)?(\+.*)?$/i
 */
export const APP_VERSION_HEADER = 'external-drive-linuxdrive@0.1.0-beta';

// Proton endpoints
export const PROTON_CORE_API = 'https://mail.proton.me/api';
export const PROTON_DRIVE_API_HOST = 'drive-api.proton.me'; // SDK adds https://

// Electron window
export const MAIN_WINDOW_WIDTH = 1020;
export const MAIN_WINDOW_HEIGHT = 700;
export const MIN_WINDOW_WIDTH = 720;
export const MIN_WINDOW_HEIGHT = 500;

// Keychain
export const KEYCHAIN_SERVICE = 'LinuxDrive';
export const KEYCHAIN_SESSION_ACCOUNT = 'proton-session';

// Sync / VFS defaults
export const DEFAULT_SYNC_FOLDER_NAME = 'LinuxDrive';
export const DEFAULT_VFS_FOLDER_NAME = 'LinuxDrive-vfs';
export const MAX_CONCURRENT_TRANSFERS = 3;
export const TRANSFER_RETRY_LIMIT = 3;

// Event polling
export const EVENT_POLL_INTERVAL_MS = 30_000;
export const OFFLINE_RETRY_INTERVAL_MS = 10_000;
