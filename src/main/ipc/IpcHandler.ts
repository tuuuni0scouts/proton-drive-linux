/**
 * Registers all Electron ipcMain handlers that bridge the renderer
 * (React UI) and the main process services.
 *
 * All handlers are async and return serializable results; errors are
 * caught and returned as { ok: false, error: string } objects.
 */
import { ipcMain, dialog, app } from 'electron';
import { IPC } from '../../shared/ipc-types';
import type {
  LoginRequest,
  LoginResponse,
  AuthStatus,
  AppSettings,
  ShareNodeRequest,
} from '../../shared/ipc-types';
import type { AuthManager } from '../auth/AuthManager';
import type { DriveService } from '../drive/DriveService';
import type { SyncEngine } from '../sync/SyncEngine';
import type { VirtualFS } from '../vfs/VirtualFS';
import { getSettings, updateSettings } from '../store/AppSettings';

export class IpcHandler {
  constructor(
    private readonly auth: AuthManager,
    private readonly drive: DriveService,
    private readonly sync: SyncEngine,
    private readonly vfs: VirtualFS,
  ) {}

  register(): void {
    // Auth
    this.handle(IPC.AUTH_LOGIN, (req: LoginRequest) => this.handleLogin(req));
    this.handle(IPC.AUTH_LOGOUT, () => this.handleLogout());
    this.handle(IPC.AUTH_STATUS, () => this.handleAuthStatus());

    // Drive
    this.handle(IPC.DRIVE_GET_ROOT, () => this.drive.getRoot());
    this.handle(IPC.DRIVE_LIST_CHILDREN, (uid: string) => this.drive.listChildren(uid));
    this.handle(IPC.DRIVE_GET_NODE, (uid: string) => this.drive.getNode(uid));
    this.handle(IPC.DRIVE_CREATE_FOLDER, (args: { parentUid: string; name: string }) =>
      this.drive.createFolder(args.parentUid, args.name));
    this.handle(IPC.DRIVE_RENAME_NODE, (args: { uid: string; name: string }) =>
      this.drive.renameNode(args.uid, args.name));
    this.handle(IPC.DRIVE_MOVE_NODES, (args: { uids: string[]; newParentUid: string }) =>
      this.drive.moveNodes(args.uids, args.newParentUid));
    this.handle(IPC.DRIVE_TRASH_NODES, (uids: string[]) => this.drive.trashNodes(uids));
    this.handle(IPC.DRIVE_RESTORE_NODES, (uids: string[]) => this.drive.restoreNodes(uids));
    this.handle(IPC.DRIVE_DELETE_NODES, (uids: string[]) => this.drive.deleteNodes(uids));
    this.handle(IPC.DRIVE_DOWNLOAD_NODE, (args: { uid: string; destPath: string }) =>
      this.drive.downloadNode(args.uid, args.destPath));
    this.handle(IPC.DRIVE_UPLOAD_FILE, (args: { parentUid: string; filePath: string; fileName: string }) =>
      this.drive.uploadFile(args.parentUid, args.filePath, args.fileName));
    this.handle(IPC.DRIVE_CANCEL_UPLOAD, (id: string) => { this.drive.cancelTransfer(id); });

    // Sharing
    this.handle(IPC.SHARE_GET_INFO, (nodeUid: string) => this.drive.getShareInfo(nodeUid));
    this.handle(IPC.SHARE_NODE, (req: ShareNodeRequest) =>
      this.drive.shareNode(req.nodeUid, {
        users: req.emails,
        publicLink: req.publicLink
          ? { role: req.publicLink.role ?? 'viewer' as const, customPassword: req.publicLink.customPassword }
          : undefined,
      }));
    this.handle(IPC.SHARE_UNSHARE_NODE, (args: { nodeUid: string; users?: string[]; publicLink?: 'remove' }) =>
      this.drive.unshareNode(args.nodeUid, args));

    // Sync
    this.handle(IPC.SYNC_START, async () => {
      const s = getSettings();
      await this.sync.start(s.syncFolderPath);
    });
    this.handle(IPC.SYNC_STOP, () => this.sync.stop());
    this.handle(IPC.SYNC_PAUSE, () => { this.sync.pause(); });
    this.handle(IPC.SYNC_RESUME, () => { this.sync.resume(); });
    this.handle(IPC.SYNC_GET_STATUS, () => this.sync.getStatus());

    // Settings
    this.handle(IPC.SETTINGS_GET, () => getSettings());
    this.handle(IPC.SETTINGS_SET, (partial: Partial<AppSettings>) => updateSettings(partial));
    this.handle(IPC.SETTINGS_CHOOSE_FOLDER, () => this.handleChooseFolder());
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  private async handleLogin(req: LoginRequest): Promise<LoginResponse> {
    const result = await this.auth.login(req.username, req.password, req.totp);
    if (!result.ok) return { ok: false, error: result.error, requireTotp: result.requireTotp };
    await this.drive.initialize();
    const s = getSettings();
    if (s.syncMode === 'virtual') {
      await this.vfs.mount(s.vfsMountPath).catch((e) => console.error('[IPC] VFS mount error:', e));
    } else {
      await this.sync.start(s.syncFolderPath).catch((e) => console.error('[IPC] Sync start error:', e));
    }
    return { ok: true };
  }

  private async handleLogout(): Promise<void> {
    await this.sync.stop();
    await this.vfs.unmount();
    await this.auth.logout();
    this.drive.dispose();
  }

  private handleAuthStatus(): AuthStatus {
    const session = this.auth.getSession();
    return {
      authenticated: !!session,
      username: session?.username,
      email: session?.email,
    };
  }

  private async handleChooseFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose sync folder',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private handle<TArg = unknown, TResult = unknown>(
    channel: string,
    handler: (arg: TArg) => TResult | Promise<TResult>,
  ): void {
    ipcMain.handle(channel, async (_event, arg: TArg) => {
      try {
        return { ok: true, data: await handler(arg) };
      } catch (err) {
        console.error(`[IPC] Error in ${channel}:`, err);
        return { ok: false, error: String(err) };
      }
    });
  }
}
