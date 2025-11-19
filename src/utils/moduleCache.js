/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import { LRUCache } from 'lru-cache';
import { estimateMemoryUsage } from './cacheUtils.js';

// Default cache configuration
const DEFAULT_MAX_SIZE = 128 * 1024 * 1024; // 128MB

/**
 * LRU Cache implementation that uses memory size for eviction policy
 */
class MemoryLRUCache {
  /**
   * Create a memory-based LRU cache
   * @param {number} maxSize - Maximum memory size in bytes
   */
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.cache = new LRUCache({
      maxSize: maxSize,
      sizeCalculation: (value) => {
        return estimateMemoryUsage(value);
      },
      dispose: () => {
        // Optional: implement cache eviction logging here if needed
      }
    });
  }

  /**
   * Generate a cache key from expression identity
   * @param {object} identity - Expression identity object
   * @returns {string} Cache key
   */
  _generateKey(identity) {
    // Create a deterministic string key from the identity object
    // Include ALL identity components to ensure proper cache isolation
    const keyParts = [
      identity.version,
      identity.source,
      identity.recover ? 'recover' : 'normal',
      identity.rootPackages ? JSON.stringify(identity.rootPackages) : ''
    ];
    return keyParts.join('|');
  }

  /**
   * Get value from cache
   * @param {object} identity - Expression identity object
   * @returns {Promise<any>} Cached value or undefined
   */
  async get(identity) {
    const key = this._generateKey(identity);
    return this.cache.get(key);
  }

  /**
   * Set value in cache
   * @param {object} identity - Expression identity object
   * @param {any} value - Value to cache
   * @returns {Promise<void>} Promise that resolves when cache is set
   */
  async set(identity, value) {
    const key = this._generateKey(identity);
    this.cache.set(key, value);
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
      maxSize: this.cache.maxSize
    };
  }
}

// Module-level default cache
let defaultCache = null;

/**
 * Get the default module-level cache
 * @returns {MemoryLRUCache} The default cache instance
 */
export function getDefaultCache() {
  if (!defaultCache) {
    defaultCache = new MemoryLRUCache();
  }
  return defaultCache;
}

export { MemoryLRUCache };