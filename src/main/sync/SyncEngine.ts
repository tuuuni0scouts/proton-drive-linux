/**
 * Orchestrates bi-directional sync between Proton Drive and the local
 * file system:
 *
 *   Remote → Local : Drive events → download changed nodes
 *   Local → Remote : LocalWatcher events → upload / rename / delete
 *
 * In 'virtual' mode the FUSE filesystem handles on-demand access;
 * the sync engine only keeps the directory structure up-to-date.
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { EventProcessor } from './EventProcessor';
import { LocalWatcher } from './LocalWatcher';
import type { DriveService } from '../drive/DriveService';
import type { IpcNode, SyncStatus } from '../../shared/ipc-types';

type SyncState = SyncStatus['state'];

export class SyncEngine extends EventEmitter {
  private state: SyncState = 'idle';
  private pendingItems = 0;
  private lastSyncTime?: number;
  private errorMessage?: string;
  private unsubscribeDriveEvents?: () => void;
  private localWatcher = new LocalWatcher();
  private eventProcessor: EventProcessor;
  private syncRoot = '';

  // uid → absolute local path
  private nodePathMap = new Map<string, string>();

  constructor(private readonly drive: DriveService) {
    super();
    this.eventProcessor = new EventProcessor(drive);
    this.wireEventProcessor();
    this.wireLocalWatcher();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(syncRoot: string): Promise<void> {
    this.syncRoot = syncRoot;
    fs.mkdirSync(syncRoot, { recursive: true });

    this.setState('syncing');

    // Subscribe to remote Drive events (SDK handles polling internally)
    this.unsubscribeDriveEvents = this.drive.subscribeToDriveEvents(
      (event) => this.eventProcessor.process(event),
    );

    // Start watching the local folder
    this.localWatcher.start(syncRoot);

    // Initial full enumeration
    await this.fullRefresh();

    this.setState('idle');
  }

  async stop(): Promise<void> {
    this.unsubscribeDriveEvents?.();
    this.localWatcher.stop();
    this.setState('idle');
  }

  pause(): void {
    this.localWatcher.stop();
    this.setState('paused');
  }

  resume(): void {
    if (this.syncRoot) this.localWatcher.start(this.syncRoot);
    this.setState('idle');
  }

  getStatus(): SyncStatus {
    return {
      state: this.state,
      pendingItems: this.pendingItems,
      lastSyncTime: this.lastSyncTime,
      errorMessage: this.errorMessage,
    };
  }

  // -----------------------------------------------------------------------
  // Remote → Local
  // -----------------------------------------------------------------------

  private wireEventProcessor(): void {
    this.eventProcessor.on('node-upserted', async (node: IpcNode) => {
      this.pendingItems++;
      this.emitStatus();
      try {
        await this.syncNodeToLocal(node);
      } finally {
        this.pendingItems = Math.max(0, this.pendingItems - 1);
        this.lastSyncTime = Date.now();
        this.emitStatus();
      }
    });

    this.eventProcessor.on('node-deleted', (uid: string) => {
      const localPath = this.nodePathMap.get(uid);
      if (localPath && fs.existsSync(localPath)) {
        try {
          fs.rmSync(localPath, { recursive: true });
          this.emit('notification', { title: 'LinuxDrive', message: `Deleted: ${path.basename(localPath)}`, type: 'info' });
        } catch { /* ignore */ }
      }
      this.nodePathMap.delete(uid);
    });

    this.eventProcessor.on('full-refresh', () => {
      this.fullRefresh().catch((e) => this.setError(String(e)));
    });

    this.eventProcessor.on('error', (_err: unknown, _event: unknown) => {
      // Log but don't crash the engine
    });
  }

  private async syncNodeToLocal(node: IpcNode): Promise<void> {
    const localPath = this.localPathFor(node);
    this.nodePathMap.set(node.uid, localPath);

    if (node.type === 'folder') {
      fs.mkdirSync(localPath, { recursive: true });
    } else {
      // Only download if the remote version is newer
      const remoteTime = node.modificationTime;
      const exists = fs.existsSync(localPath);
      const localTime = exists ? fs.statSync(localPath).mtimeMs : 0;
      if (!exists || remoteTime > localTime) {
        await this.drive.downloadNode(node.uid, localPath);
      }
    }
  }

  private async fullRefresh(): Promise<void> {
    const root = await this.drive.getRoot();
    await this.syncNodeToLocal(root);
    await this.syncChildren(root.uid);
  }

  private async syncChildren(folderUid: string): Promise<void> {
    const children = await this.drive.listChildren(folderUid);
    for (const child of children) {
      await this.syncNodeToLocal(child);
      if (child.type === 'folder') await this.syncChildren(child.uid);
    }
  }

  // -----------------------------------------------------------------------
  // Local → Remote
  // -----------------------------------------------------------------------

  private wireLocalWatcher(): void {
    this.localWatcher.on('change', async ({ type, absolutePath, relativePath }) => {
      if (this.state === 'paused') return;
      try {
        await this.handleLocalChange(type, absolutePath, relativePath);
      } catch (err) {
        this.setError(String(err));
      }
    });
  }

  private async handleLocalChange(
    type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir',
    absolutePath: string,
    relativePath: string,
  ): Promise<void> {
    const parts = relativePath.split(path.sep);
    const fileName = parts[parts.length - 1]!;
    const parentRelative = parts.slice(0, -1).join(path.sep);

    // Find parent Drive UID from our map
    const parentUid = this.findUidByRelPath(parentRelative);
    if (!parentUid && type !== 'addDir') return; // can't locate parent

    switch (type) {
      case 'add':
      case 'change':
        if (parentUid) {
          this.pendingItems++;
          this.emitStatus();
          try {
            await this.drive.uploadFile(parentUid, absolutePath, fileName);
          } finally {
            this.pendingItems = Math.max(0, this.pendingItems - 1);
            this.lastSyncTime = Date.now();
            this.emitStatus();
          }
        }
        break;

      case 'addDir':
        if (parentUid) {
          const node = await this.drive.createFolder(parentUid, fileName);
          this.nodePathMap.set(node.uid, absolutePath);
        }
        break;

      case 'unlink':
      case 'unlinkDir': {
        const uid = [...this.nodePathMap.entries()].find(([, p]) => p === absolutePath)?.[0];
        if (uid) await this.drive.trashNodes([uid]);
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private localPathFor(node: IpcNode): string {
    if (!node.parentUid) return this.syncRoot;
    const parentPath = this.nodePathMap.get(node.parentUid) ?? this.syncRoot;
    return path.join(parentPath, node.name);
  }

  private findUidByRelPath(relPath: string): string | undefined {
    const abs = relPath ? path.join(this.syncRoot, relPath) : this.syncRoot;
    return [...this.nodePathMap.entries()].find(([, p]) => p === abs)?.[0];
  }

  private setState(state: SyncState, error?: string): void {
    this.state = state;
    this.errorMessage = error;
    if (state !== 'error') this.errorMessage = undefined;
    this.emitStatus();
  }

  private setError(msg: string): void {
    this.setState('error', msg);
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }
}
