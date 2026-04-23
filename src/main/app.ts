import { app, Notification, nativeTheme } from 'electron';
import { WindowManager } from './window';
import { TrayManager } from './tray';
import { IpcHandler } from './ipc/IpcHandler';
import { AuthManager } from './auth/AuthManager';
import { DriveService } from './drive/DriveService';
import { SyncEngine } from './sync/SyncEngine';
import { VirtualFS } from './vfs/VirtualFS';
import { getSettings } from './store/AppSettings';
import type { SyncStatus, NotificationPayload } from '../shared/ipc-types';
import { IPC } from '../shared/ipc-types';

export class AppLifecycle {
  private windowManager!: WindowManager;
  private trayManager!: TrayManager;
  private ipcHandler!: IpcHandler;
  private authManager!: AuthManager;
  private driveService!: DriveService;
  private syncEngine!: SyncEngine;
  private virtualFS!: VirtualFS;
  private stopping = false;

  async start(): Promise<void> {
    const settings = getSettings();

    // Apply theme
    nativeTheme.themeSource = settings.theme === 'system' ? 'system' : settings.theme;

    // Core services
    this.authManager = new AuthManager();
    this.driveService = new DriveService(this.authManager);
    this.syncEngine = new SyncEngine(this.driveService);
    this.virtualFS = new VirtualFS(this.driveService);

    // UI
    this.windowManager = new WindowManager();
    this.trayManager = new TrayManager(
      () => this.showMainWindow(),
      () => this.quit(),
      () => this.syncEngine.getStatus(),
    );

    // Wire IPC
    this.ipcHandler = new IpcHandler(
      this.authManager,
      this.driveService,
      this.syncEngine,
      this.virtualFS,
    );
    this.ipcHandler.register();

    // Forward sync status changes to renderer
    this.syncEngine.on('status', (status: SyncStatus) => {
      this.windowManager.send(IPC.EVENT_SYNC_STATUS_CHANGED, status);
      this.trayManager.updateStatus(status);
    });

    // Forward notification requests to OS
    this.syncEngine.on('notification', (n: NotificationPayload) => {
      if (getSettings().showNotifications) this.showOsNotification(n);
      this.windowManager.send(IPC.EVENT_NOTIFICATION, n);
    });

    // Create window
    this.windowManager.createMainWindow();

    // Check existing session
    const hasSession = await this.authManager.loadExistingSession();
    if (hasSession) {
      await this.driveService.initialize();
      const s = getSettings();
      if (s.syncMode === 'virtual') {
        await this.virtualFS.mount(s.vfsMountPath);
      } else {
        await this.syncEngine.start(s.syncFolderPath);
      }
    }
  }

  showMainWindow(): void {
    this.windowManager.showMainWindow();
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.virtualFS?.unmount();
    await this.syncEngine?.stop();
    this.trayManager?.destroy();
  }

  quit(): void {
    app.quit();
  }

  private showOsNotification(n: NotificationPayload): void {
    if (Notification.isSupported()) {
      new Notification({ title: n.title, body: n.message }).show();
    }
  }
}
