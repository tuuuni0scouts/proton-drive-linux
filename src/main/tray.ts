import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import type { SyncStatus } from '../shared/ipc-types';

export class TrayManager {
  private tray: Tray | null = null;
  private currentStatus: SyncStatus = { state: 'idle', pendingItems: 0 };

  constructor(
    private readonly onShow: () => void,
    private readonly onQuit: () => void,
    private readonly getStatus: () => SyncStatus,
  ) {
    this.create();
  }

  private create(): void {
    // Fall back to a blank 16x16 image if the icon file is missing
    let icon: Electron.NativeImage;
    try {
      const iconPath = path.join(process.resourcesPath, 'tray-icon.png');
      icon = nativeImage.createFromPath(iconPath);
    } catch {
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon.resize({ width: 22, height: 22 }));
    this.tray.setToolTip('LinuxDrive');
    this.tray.on('activate', () => this.onShow()); // macOS double-click
    this.tray.on('click', () => this.onShow()); // Linux/Windows single-click
    this.buildMenu();
  }

  updateStatus(status: SyncStatus): void {
    this.currentStatus = status;
    this.buildMenu();

    const icon = this.getStatusIcon(status.state);
    this.tray?.setToolTip(`LinuxDrive – ${this.labelFor(status)}`);
    if (icon) this.tray?.setImage(icon);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private buildMenu(): void {
    const s = this.currentStatus;
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'LinuxDrive', enabled: false },
      { label: this.labelFor(s), enabled: false },
      { type: 'separator' },
      { label: 'Open LinuxDrive', click: () => this.onShow() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuiting = true; this.onQuit(); } },
    ];
    this.tray?.setContextMenu(Menu.buildFromTemplate(template));
  }

  private labelFor(s: SyncStatus): string {
    switch (s.state) {
      case 'syncing': return `Syncing… (${s.pendingItems} items)`;
      case 'paused': return 'Sync paused';
      case 'error': return `Error: ${s.errorMessage ?? 'unknown'}`;
      case 'offline': return 'Offline';
      default: return 'Up to date';
    }
  }

  private getStatusIcon(state: SyncStatus['state']): Electron.NativeImage | null {
    // In production, return themed icons; for now, return null (use default)
    void state;
    return null;
  }
}

// Extend Electron's App type to allow custom property
declare global {
  namespace Electron {
    interface App { isQuiting?: boolean; }
  }
}
