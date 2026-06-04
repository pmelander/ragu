import NodeCache from 'node-cache';
import { logger } from './logger';

export class Cache {
  private static instance: Cache;
  private cache: NodeCache;

  private constructor() {
    // CACHE_TTL is in seconds (node-cache stdTTL expects seconds, not milliseconds)
    const ttl = parseInt(process.env.CACHE_TTL || '3600');
    this.cache = new NodeCache({
      stdTTL: isNaN(ttl) ? 3600 : ttl, // 1 hour default (3600 s)
      checkperiod: 600, // Check for expired keys every 10 minutes
      useClones: false, // Don't clone objects for better performance
      deleteOnExpire: true
    });

    // Event listeners for monitoring
    this.cache.on('set', (key, _value) => {
      logger.debug(`Cache set: ${key}`);
    });

    this.cache.on('del', (key, _value) => {
      logger.debug(`Cache delete: ${key}`);
    });

    this.cache.on('expired', (key: string, _value: any) => {
      logger.debug(`Cache expired: ${key}`);
    });

    this.cache.on('flush', (keys: string[] | undefined) => {
      logger.debug(`Cache flushed: ${keys?.length || 0} keys`);
    });
  }

  public static getInstance(): Cache {
    if (!Cache.instance) {
      Cache.instance = new Cache();
    }
    return Cache.instance;
  }

  public set(key: string, value: any, ttl?: number): boolean {
    try {
      if (ttl !== undefined) {
        return this.cache.set(key, value, ttl);
      } else {
        return this.cache.set(key, value);
      }
    } catch (error) {
      logger.error('Cache set error', error);
      return false;
    }
  }

  public get<T = any>(key: string): T | undefined {
    try {
      return this.cache.get(key);
    } catch (error) {
      logger.error('Cache get error', error);
      return undefined;
    }
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public delete(key: string): number {
    return this.cache.del(key);
  }

  public clear(): void {
    this.cache.flushAll();
    logger.info('Cache cleared');
  }

  public getStats(): NodeCache.Stats {
    return this.cache.getStats();
  }

  public keys(): string[] {
    return this.cache.keys();
  }

  // Specialized methods for RAG
  public setEmbedding(text: string, embedding: number[]): boolean {
    const key = `embedding:${this.hashString(text)}`;
    return this.set(key, embedding);
  }

  public getEmbedding(text: string): number[] | undefined {
    const key = `embedding:${this.hashString(text)}`;
    return this.get(key);
  }

  public setSearchResult(query: string, collection: string, results: any, fingerprint = ''): boolean {
    const key = `search:${collection}:${this.hashString(query + '\n' + fingerprint)}`;
    return this.set(key, results, 1800); // 30 minutes (node-cache TTL is in seconds)
  }

  public getSearchResult(query: string, collection: string, fingerprint = ''): any | undefined {
    const key = `search:${collection}:${this.hashString(query + '\n' + fingerprint)}`;
    return this.get(key);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

export const cache = Cache.getInstance();