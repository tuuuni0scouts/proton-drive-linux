/**
 * DriveService wraps the ProtonDriveClient and exposes a stable,
 * app-friendly API.  All references to SDK types are isolated here;
 * the rest of the app communicates through DriveService only.
 *
 * This decoupling means that when the SDK has breaking changes (as
 * noted in the README – the upcoming new crypto model), only this
 * file and its direct adapters need to be updated.
 */
import { EventEmitter } from 'events';
import { ProtonDriveClient, NullFeatureFlagProvider, NodeType } from '@protontech/drive-sdk';
import type {
  NodeEntity,
  MaybeNode,
  DriveListener,
  DriveEvent,
  DriveEventType,
  FileUploader,
  UploadMetadata,
  ShareNodeSettings,
  ShareResult,
  PublicLink,
} from '@protontech/drive-sdk';
import { DriveHttpClient } from './DriveHttpClient';
import { AccountAdapter } from './AccountAdapter';
import { CryptoAdapter } from './CryptoAdapter';
import { createEntitiesCache, createCryptoCache } from './CacheAdapter';
import { srpModule } from '../auth/ProtonSRP';
import type { AuthManager } from '../auth/AuthManager';
import type { IpcNode, IpcTransfer, ShareInfo } from '../../shared/ipc-types';
import { PROTON_DRIVE_API_HOST, MAX_CONCURRENT_TRANSFERS } from '../../shared/constants';
import { randomUUID } from 'crypto';

export class DriveService extends EventEmitter {
  private client: ProtonDriveClient | null = null;
  private accountAdapter: AccountAdapter;
  private activeTransfers = new Map<string, AbortController>();

  constructor(private readonly auth: AuthManager) {
    super();
    this.accountAdapter = new AccountAdapter(auth);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.client) return;

    const httpClient = new DriveHttpClient(this.auth);
    const cryptoModule = new CryptoAdapter();

    this.client = new ProtonDriveClient({
      httpClient,
      entitiesCache: createEntitiesCache(),
      cryptoCache: createCryptoCache(),
      account: this.accountAdapter,
      openPGPCryptoModule: cryptoModule,
      srpModule,
      config: {
        baseUrl: PROTON_DRIVE_API_HOST,
        clientUid: randomUUID(),
      },
      featureFlagProvider: new NullFeatureFlagProvider(),
    });

    this.emit('initialized');
  }

  dispose(): void {
    this.client = null;
    this.accountAdapter.invalidateCache();
    this.activeTransfers.clear();
  }

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  async getRoot(): Promise<IpcNode> {
    const client = this.requireClient();
    const rootIds = await client.getRootIDs();
    const rootUid = rootIds.myFiles;
    const node = await this.getNode(rootUid);
    return node;
  }

  async getNode(uid: string): Promise<IpcNode> {
    const client = this.requireClient();
    const result = await client.getNode(uid);
    if (!result) throw new Error(`Node not found: ${uid}`);
    return this.mapNode(result);
  }

  async listChildren(parentUid: string): Promise<IpcNode[]> {
    const client = this.requireClient();
    const nodes: IpcNode[] = [];
    for await (const result of client.iterateChildren(parentUid)) {
      nodes.push(this.mapNode(result));
    }
    return nodes;
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  async createFolder(parentUid: string, name: string): Promise<IpcNode> {
    const client = this.requireClient();
    const node = await client.createFolder(parentUid, name);
    return this.mapNode({ ok: true, value: node as unknown as NodeEntity });
  }

  async renameNode(uid: string, newName: string): Promise<void> {
    const client = this.requireClient();
    await client.renameNode(uid, newName);
  }

  async moveNodes(uids: string[], newParentUid: string): Promise<void> {
    const client = this.requireClient();
    await client.moveNodes(uids, newParentUid);
  }

  async trashNodes(uids: string[]): Promise<void> {
    const client = this.requireClient();
    await client.trashNodes(uids);
  }

  async restoreNodes(uids: string[]): Promise<void> {
    const client = this.requireClient();
    await client.restoreNodes(uids);
  }

  async deleteNodes(uids: string[]): Promise<void> {
    const client = this.requireClient();
    await client.deleteNodes(uids);
  }

  // -----------------------------------------------------------------------
  // Transfers
  // -----------------------------------------------------------------------

  /**
   * Upload a local file to a Drive folder.
   * Returns an IpcTransfer that callers can track via the 'transfer-progress' event.
   */
  async uploadFile(
    parentUid: string,
    filePath: string,
    fileName: string,
  ): Promise<IpcTransfer> {
    const client = this.requireClient();
    const fs = await import('fs');
    const stat = fs.statSync(filePath);

    const transfer: IpcTransfer = {
      id: randomUUID(),
      parentUid,
      fileName,
      direction: 'upload',
      status: 'active',
      progress: 0,
      bytesTransferred: 0,
      totalBytes: stat.size,
      startTime: Date.now(),
    };

    const controller = new AbortController();
    this.activeTransfers.set(transfer.id, controller);

    // Run upload async – emit events as progress is made
    this.runUpload(client, transfer, filePath, stat.size, controller).catch((err) => {
      transfer.status = 'error';
      transfer.error = String(err);
      this.emit('transfer-error', transfer);
    });

    return transfer;
  }

  private async runUpload(
    client: ProtonDriveClient,
    transfer: IpcTransfer,
    filePath: string,
    size: number,
    controller: AbortController,
  ): Promise<void> {
    const fs = await import('fs');
    const { createReadStream } = fs;

    const metadata: UploadMetadata = {
      mediaType: 'application/octet-stream',
      expectedSize: size,
      modificationTime: new Date((await import('fs')).statSync(filePath).mtimeMs),
    };

    const uploader: FileUploader = await client.getFileUploader(
      transfer.parentUid!,
      transfer.fileName,
      metadata,
    );

    // Convert Node.js ReadStream to Web ReadableStream
    const nodeStream = createReadStream(filePath);
    const webStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        nodeStream.on('data', (chunk) => ctrl.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
        nodeStream.on('end', () => ctrl.close());
        nodeStream.on('error', (e) => ctrl.error(e));
      },
    });

    const uploadCtrl = await uploader.uploadFromStream(webStream, [], (uploaded) => {
      transfer.bytesTransferred = uploaded;
      transfer.progress = size > 0 ? Math.round((uploaded / size) * 100) : 0;
      this.emit('transfer-progress', { ...transfer });
    });

    const result = await uploadCtrl.completion();
    transfer.nodeUid = result.nodeUid;
    transfer.status = 'completed';
    transfer.progress = 100;
    this.activeTransfers.delete(transfer.id);
    this.emit('transfer-completed', transfer);
  }

  async downloadNode(uid: string, destPath: string): Promise<IpcTransfer> {
    const client = this.requireClient();
    const node = await this.getNode(uid);

    const transfer: IpcTransfer = {
      id: randomUUID(),
      nodeUid: uid,
      fileName: node.name,
      direction: 'download',
      status: 'active',
      progress: 0,
      bytesTransferred: 0,
      totalBytes: node.size ?? 0,
      startTime: Date.now(),
    };

    const controller = new AbortController();
    this.activeTransfers.set(transfer.id, controller);

    this.runDownload(client, transfer, uid, destPath, node.size ?? 0, controller).catch((err) => {
      transfer.status = 'error';
      transfer.error = String(err);
      this.emit('transfer-error', transfer);
    });

    return transfer;
  }

  private async runDownload(
    client: ProtonDriveClient,
    transfer: IpcTransfer,
    uid: string,
    destPath: string,
    totalBytes: number,
    _controller: AbortController,
  ): Promise<void> {
    const sdk_node = await client.getNode(uid);
    if (!sdk_node?.ok) throw new Error(`Cannot get node for download: ${uid}`);
    const revisionUid = sdk_node.value.activeRevision?.uid;
    if (!revisionUid) throw new Error('No active revision');

    const downloader = await client.getFileDownloader(revisionUid);
    const readableStream = await downloader.download();

    const fs = await import('fs');
    const { createWriteStream } = fs;
    const writeStream = createWriteStream(destPath);

    let downloaded = 0;
    const reader = readableStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        downloaded += value.byteLength;
        transfer.bytesTransferred = downloaded;
        transfer.progress = totalBytes > 0 ? Math.round((downloaded / totalBytes) * 100) : 0;
        writeStream.write(Buffer.from(value));
        this.emit('transfer-progress', { ...transfer });
      }
    }

    writeStream.end();
    transfer.status = 'completed';
    transfer.progress = 100;
    this.activeTransfers.delete(transfer.id);
    this.emit('transfer-completed', transfer);
  }

  cancelTransfer(transferId: string): void {
    this.activeTransfers.get(transferId)?.abort();
    this.activeTransfers.delete(transferId);
  }

  // -----------------------------------------------------------------------
  // Sharing
  // -----------------------------------------------------------------------

  async getShareInfo(nodeUid: string): Promise<ShareInfo> {
    const client = this.requireClient();
    const result = await client.getShareInfo(nodeUid);
    return {
      members: (result.members ?? []).map((m) => ({
        uid: m.uid,
        email: m.inviteeEmail,
        role: m.role as 'viewer' | 'editor' | 'admin',
        inviteTime: m.invitationTime.getTime(),
      })),
      publicLink: result.publicLink
        ? {
            uid: result.publicLink.uid,
            url: result.publicLink.url,
            role: result.publicLink.role as 'viewer' | 'editor',
            expirationTime: result.publicLink.expirationTime?.getTime(),
            numberOfDownloads: result.publicLink.numberOfInitializedDownloads,
          }
        : undefined,
      editorsCanShare: result.editorsCanShare,
    };
  }

  async shareNode(nodeUid: string, settings: ShareNodeSettings): Promise<ShareResult> {
    const client = this.requireClient();
    return client.shareNode(nodeUid, settings);
  }

  async unshareNode(nodeUid: string, settings: { users?: string[]; publicLink?: 'remove' }): Promise<void> {
    const client = this.requireClient();
    await client.unshareNode(nodeUid, settings);
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  subscribeToDriveEvents(listener: DriveListener): () => void {
    const client = this.requireClient();
    return client.subscribeToEvents(listener);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private requireClient(): ProtonDriveClient {
    if (!this.client) throw new Error('DriveService not initialized');
    return this.client;
  }

  private mapNode(result: MaybeNode): IpcNode {
    if (!result.ok) {
      // Degraded node – return what we can
      const d = result.error;
      return {
        uid: d.uid,
        parentUid: d.parentUid,
        name: typeof d.name === 'string' ? d.name : '[encrypted]',
        type: d.type === NodeType.Folder ? 'folder' : 'file',
        mediaType: d.mediaType,
        size: d.activeRevision?.ok ? d.activeRevision.value.claimedSize : undefined,
        creationTime: d.creationTime.getTime(),
        modificationTime: d.modificationTime.getTime(),
        isShared: d.isShared,
        isSharedPublicly: d.isSharedPublicly,
        isTrashed: !!d.trashTime,
        hasThumbnail: false,
      };
    }
    const n = result.value;
    return {
      uid: n.uid,
      parentUid: n.parentUid,
      name: n.name,
      type: n.type === NodeType.Folder ? 'folder' : 'file',
      mediaType: n.mediaType,
      size: n.activeRevision?.claimedSize,
      creationTime: n.creationTime.getTime(),
      modificationTime: n.modificationTime.getTime(),
      isShared: n.isShared,
      isSharedPublicly: n.isSharedPublicly,
      isTrashed: !!n.trashTime,
      hasThumbnail: false,
    };
  }
}
