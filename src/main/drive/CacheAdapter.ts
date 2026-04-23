/**
 * In-memory implementations of ProtonDriveEntitiesCache and
 * ProtonDriveCryptoCache.  In production these can be backed by
 * SQLite or leveldb for persistence across restarts.
 *
 * Both caches implement the ProtonDriveCache<T> interface expected
 * by the SDK constructor.
 */
import type { ProtonDriveEntitiesCache, ProtonDriveCryptoCache, CachedCryptoMaterial } from '@protontech/drive-sdk';

class InMemoryCache<T> {
  private readonly store = new Map<string, T>();

  async get(key: string): Promise<T | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export function createEntitiesCache(): ProtonDriveEntitiesCache {
  return new InMemoryCache<string>();
}

export function createCryptoCache(): ProtonDriveCryptoCache {
  return new InMemoryCache<CachedCryptoMaterial>();
}
