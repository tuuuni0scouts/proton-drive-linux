/**
 * Watches the local sync folder for changes using chokidar and
 * translates file-system events into Drive upload/rename/delete operations.
 */
import { EventEmitter } from 'events';
import chokidar, { type FSWatcher } from 'chokidar';
import * as path from 'path';

export interface LocalChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  absolutePath: string;
  relativePath: string;
}

export class LocalWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;

  start(watchPath: string): void {
    if (this.watcher) this.stop();

    this.watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: false,
      ignored: /(^\.)|(\/\.)/,   // ignore hidden files
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      followSymlinks: false,
    });

    const emit = (type: LocalChangeEvent['type']) => (abs: string) => {
      this.emit('change', {
        type,
        absolutePath: abs,
        relativePath: path.relative(watchPath, abs),
      } satisfies LocalChangeEvent);
    };

    this.watcher
      .on('add', emit('add'))
      .on('change', emit('change'))
      .on('unlink', emit('unlink'))
      .on('addDir', emit('addDir'))
      .on('unlinkDir', emit('unlinkDir'))
      .on('error', (err) => this.emit('error', err));
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
