import { app } from 'electron';
import { AppLifecycle } from './app';

// Single instance lock – prevent multiple copies running simultaneously
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const lifecycle = new AppLifecycle();

  app.on('ready', () => lifecycle.start());

  app.on('second-instance', () => lifecycle.showMainWindow());

  app.on('window-all-closed', () => {
    // On Linux, keep the app alive in the tray when all windows close
    // (unless the user explicitly quits)
  });

  app.on('activate', () => lifecycle.showMainWindow());

  app.on('before-quit', () => lifecycle.stop());
}
