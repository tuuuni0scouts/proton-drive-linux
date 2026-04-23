/**
 * Virtual File System using FUSE (via fuse-native).
 *
 * Mounts a directory that mirrors Proton Drive without downloading files
 * locally.  Files are fetched on-demand when read.  This provides the
 * 'virtual' sync mode where only metadata is kept locally.
 *
 * Requires: fuse3 (or fuse) package + FUSE kernel module (loaded by default
 * on most modern Linux kernels).
 */
import Fuse from 'fuse-native';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { DriveService } from '../drive/DriveService';
import type { IpcNode } from '../../shared/ipc-types';

interface FuseAttr {
  mtime: Date;
  atime: Date;
  ctime: Date;
  size: number;
  mode: number;
  uid: number;
  gid: number;
  nlink: number;
}

type FuseCb<T = void> = (code: number, result?: T) => void;

export class VirtualFS {
  private fuse: Fuse | null = null;
  private mountPath = '';

  // In-memory metadata cache: relative path → IpcNode
  private nodeByPath = new Map<string, IpcNode>();
  // uid → IpcNode
  private nodeByUid = new Map<string, IpcNode>();
  // parent uid → children uids (populated lazily)
  private childrenLoaded = new Set<string>();

  constructor(private readonly drive: DriveService) {}

  async mount(mountPath: string): Promise<void> {
    fs.mkdirSync(mountPath, { recursive: true });
    this.mountPath = mountPath;

    // Bootstrap root
    try {
      const root = await this.drive.getRoot();
      this.indexNode('', root);
    } catch (e) {
      console.error('[VirtualFS] Failed to get root:', e);
    }

    const ops = this.buildOps();
    this.fuse = new Fuse(mountPath, ops, {
      debug: false,
      allowOther: false,
      displayFolder: true,
      mkdir: false,
    });

    await new Promise<void>((resolve, reject) => {
      this.fuse!.mount((err: Error | null) => (err ? reject(err) : resolve()));
    });

    console.log(`[VirtualFS] Mounted at ${mountPath}`);
  }

  async unmount(): Promise<void> {
    if (!this.fuse) return;
    await new Promise<void>((res) => {
      this.fuse!.unmount((err: Error | null) => {
        if (err) console.error('[VirtualFS] unmount error:', err);
        res();
      });
    });
    this.fuse = null;
  }

  // -----------------------------------------------------------------------
  // FUSE operations
  // -----------------------------------------------------------------------

  private buildOps() {
    const self = this;
    return {
      readdir(p: string, cb: FuseCb<string[]>) {
        self.fuseReaddir(p, cb);
      },
      getattr(p: string, cb: FuseCb<FuseAttr>) {
        self.fuseGetattr(p, cb);
      },
      open(p: string, flags: number, cb: FuseCb<number>) {
        void flags;
        // Return a file descriptor (we use 42 as a dummy; reads use path)
        cb(0, 42);
      },
      read(p: string, _fd: number, buf: Buffer, len: number, pos: number, cb: FuseCb<number>) {
        self.fuseRead(p, buf, len, pos, cb);
      },
      mkdir(p: string, _mode: number, cb: FuseCb) {
        self.fuseMkdir(p, cb);
      },
      create(p: string, _mode: number, cb: FuseCb<number>) {
        // Creation is handled via upload from the GUI; FUSE create not used
        void p;
        cb(Fuse.ENOSYS);
      },
      unlink(p: string, cb: FuseCb) {
        self.fuseUnlink(p, cb);
      },
      rmdir(p: string, cb: FuseCb) {
        self.fuseUnlink(p, cb);
      },
      rename(src: string, dest: string, cb: FuseCb) {
        self.fuseRename(src, dest, cb);
      },
    };
  }

  private async fuseReaddir(p: string, cb: FuseCb<string[]>): Promise<void> {
    const node = this.nodeByPath.get(this.norm(p));
    if (!node && p !== '/') { cb(Fuse.ENOENT); return; }

    const uid = node?.uid ?? (await this.drive.getRoot().then(r => r.uid).catch(() => ''));
    if (!uid) { cb(Fuse.EIO); return; }

    if (!this.childrenLoaded.has(uid)) {
      try {
        const children = await this.drive.listChildren(uid);
        for (const child of children) this.indexNode(this.norm(p) + '/' + child.name, child);
        this.childrenLoaded.add(uid);
      } catch { cb(Fuse.EIO); return; }
    }

    const names = [...this.nodeByPath.entries()]
      .filter(([k]) => this.isDirectChild(this.norm(p), k))
      .map(([k]) => path.basename(k));

    cb(0, ['.', '..', ...names]);
  }

  private fuseGetattr(p: string, cb: FuseCb<FuseAttr>): void {
    if (p === '/') {
      cb(0, this.dirAttr(new Date()));
      return;
    }
    const node = this.nodeByPath.get(this.norm(p));
    if (!node) { cb(Fuse.ENOENT); return; }
    const attr = node.type === 'folder'
      ? this.dirAttr(new Date(node.modificationTime))
      : this.fileAttr(node.size ?? 0, new Date(node.modificationTime));
    cb(0, attr);
  }

  private fuseRead(p: string, buf: Buffer, len: number, pos: number, cb: FuseCb<number>): void {
    const node = this.nodeByPath.get(this.norm(p));
    if (!node) { cb(Fuse.ENOENT); return; }

    const tmpPath = path.join(os.tmpdir(), `ld-${node.uid}`);

    const doRead = () => {
      try {
        const fd = fs.openSync(tmpPath, 'r');
        const bytesRead = fs.readSync(fd, buf, 0, len, pos);
        fs.closeSync(fd);
        cb(bytesRead);
      } catch { cb(Fuse.EIO); }
    };

    if (fs.existsSync(tmpPath)) {
      doRead();
    } else {
      this.drive.downloadNode(node.uid, tmpPath)
        .then(doRead)
        .catch(() => cb(Fuse.EIO));
    }
  }

  private async fuseMkdir(p: string, cb: FuseCb): Promise<void> {
    const parentPath = path.dirname(this.norm(p));
    const name = path.basename(p);
    const parentNode = this.nodeByPath.get(parentPath);
    if (!parentNode) { cb(Fuse.ENOENT); return; }
    try {
      const node = await this.drive.createFolder(parentNode.uid, name);
      this.indexNode(this.norm(p), node);
      cb(0);
    } catch { cb(Fuse.EIO); }
  }

  private async fuseUnlink(p: string, cb: FuseCb): Promise<void> {
    const node = this.nodeByPath.get(this.norm(p));
    if (!node) { cb(Fuse.ENOENT); return; }
    try {
      await this.drive.trashNodes([node.uid]);
      this.nodeByPath.delete(this.norm(p));
      this.nodeByUid.delete(node.uid);
      cb(0);
    } catch { cb(Fuse.EIO); }
  }

  private async fuseRename(src: string, dest: string, cb: FuseCb): Promise<void> {
    const node = this.nodeByPath.get(this.norm(src));
    if (!node) { cb(Fuse.ENOENT); return; }
    const newName = path.basename(dest);
    const newParentPath = path.dirname(this.norm(dest));
    const newParent = this.nodeByPath.get(newParentPath);
    try {
      if (newParent && newParent.uid !== node.parentUid) {
        await this.drive.moveNodes([node.uid], newParent.uid);
      }
      if (newName !== node.name) {
        await this.drive.renameNode(node.uid, newName);
      }
      this.nodeByPath.delete(this.norm(src));
      this.indexNode(this.norm(dest), { ...node, name: newName, parentUid: newParent?.uid ?? node.parentUid });
      cb(0);
    } catch { cb(Fuse.EIO); }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private indexNode(p: string, node: IpcNode): void {
    this.nodeByPath.set(p, node);
    this.nodeByUid.set(node.uid, node);
  }

  private norm(p: string): string {
    return p === '/' ? '' : p.replace(/\/$/, '');
  }

  private isDirectChild(parent: string, child: string): boolean {
    if (!child.startsWith(parent + '/')) return false;
    return !child.slice(parent.length + 1).includes('/');
  }

  private dirAttr(mtime: Date): FuseAttr {
    return { mtime, atime: mtime, ctime: mtime, size: 4096, mode: 0o40755, uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000, nlink: 2 };
  }

  private fileAttr(size: number, mtime: Date): FuseAttr {
    return { mtime, atime: mtime, ctime: mtime, size, mode: 0o100644, uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000, nlink: 1 };
  }
}
