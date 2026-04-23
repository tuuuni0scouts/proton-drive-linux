import { BrowserWindow, shell } from 'electron';
import * as path from 'path';
import {
  MAIN_WINDOW_WIDTH,
  MAIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from '../shared/constants';

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;

  createMainWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: MAIN_WINDOW_WIDTH,
      height: MAIN_WINDOW_HEIGHT,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      title: 'LinuxDrive',
      // No Proton branding – plain window icon
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      show: false,
      backgroundColor: '#1a1a2e',
    });

    this.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    this.mainWindow.once('ready-to-show', () => this.mainWindow?.show());

    // Open external links in the OS browser, not in Electron
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    this.mainWindow.on('close', (e) => {
      // If minimizeToTray is enabled, hide instead of close
      const { getSettings } = require('./store/AppSettings');
      if (getSettings().minimizeToTray) {
        e.preventDefault();
        this.mainWindow?.hide();
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  showMainWindow(): void {
    if (!this.mainWindow) {
      this.createMainWindow();
    } else {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  send(channel: string, ...args: unknown[]): void {
    this.mainWindow?.webContents.send(channel, ...args);
  }

  getWindow(): BrowserWindow | null {
    return this.mainWindow;
  }
}
