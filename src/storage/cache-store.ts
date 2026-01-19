import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from '../config.js';
import { CacheEntry, CacheEntrySchema } from '../types/index.js';

export class CacheStore {
  private cacheDir: string;
  private ttlMs: number;
  private enabled: boolean;

  constructor() {
    this.cacheDir = config.paths.cache;
    this.ttlMs = config.cache.ttlHours * 60 * 60 * 1000;
    this.enabled = config.cache.enabled;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  private generateKey(prefix: string, data: unknown): string {
    const hash = createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .slice(0, 16);
    return `${prefix}_${hash}`;
  }

  private getFilePath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  async get<T>(prefix: string, data: unknown): Promise<T | null> {
    if (!this.enabled) return null;

    const key = this.generateKey(prefix, data);
    const filePath = this.getFilePath(key);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const entry = CacheEntrySchema.parse(JSON.parse(content));

      const expiresAt = new Date(entry.expiresAt);
      if (expiresAt < new Date()) {
        await this.delete(key);
        return null;
      }

      return entry.data as T;
    } catch {
      return null;
    }
  }

  async set<T>(prefix: string, data: unknown, value: T): Promise<void> {
    if (!this.enabled) return;

    const key = this.generateKey(prefix, data);
    const filePath = this.getFilePath(key);

    const now = new Date();
    const entry: CacheEntry = {
      key,
      data: value,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
    };

    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map((f) => fs.unlink(join(this.cacheDir, f)))
      );
    } catch {
      // Ignore errors
    }
  }

  async cleanup(): Promise<number> {
    let cleaned = 0;
    try {
      const files = await fs.readdir(this.cacheDir);
      const now = new Date();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.cacheDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const entry = CacheEntrySchema.parse(JSON.parse(content));

          if (new Date(entry.expiresAt) < now) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch {
          // Delete corrupted cache files
          await fs.unlink(filePath);
          cleaned++;
        }
      }
    } catch {
      // Ignore errors
    }
    return cleaned;
  }
}

// Singleton instance
export const cacheStore = new CacheStore();
