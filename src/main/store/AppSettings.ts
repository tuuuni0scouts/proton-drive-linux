import Store from 'electron-store';
import * as path from 'path';
import * as os from 'os';
import type { AppSettings } from '../../shared/ipc-types';
import { DEFAULT_SYNC_FOLDER_NAME, DEFAULT_VFS_FOLDER_NAME } from '../../shared/constants';

const defaults: AppSettings = {
  syncFolderPath: path.join(os.homedir(), DEFAULT_SYNC_FOLDER_NAME),
  vfsMountPath: path.join(os.homedir(), DEFAULT_VFS_FOLDER_NAME),
  launchAtStartup: false,
  minimizeToTray: true,
  showNotifications: true,
  syncMode: 'virtual',
  language: 'en',
  theme: 'system',
};

const store = new Store<{ settings: AppSettings }>({
  name: 'config',
  defaults: { settings: defaults },
  schema: {
    settings: {
      type: 'object',
      properties: {
        syncFolderPath: { type: 'string' },
        vfsMountPath: { type: 'string' },
        launchAtStartup: { type: 'boolean' },
        minimizeToTray: { type: 'boolean' },
        showNotifications: { type: 'boolean' },
        syncMode: { type: 'string', enum: ['virtual', 'full'] },
        language: { type: 'string' },
        theme: { type: 'string', enum: ['system', 'light', 'dark'] },
      },
      additionalProperties: false,
    },
  },
});

export function getSettings(): AppSettings {
  return store.get('settings');
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const updated = { ...getSettings(), ...partial };
  store.set('settings', updated);
  return updated;
}

export function resetSettings(): AppSettings {
  store.set('settings', defaults);
  return defaults;
}
