/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import { estimateMemoryUsage } from './cacheUtils.js';

// Default cache configuration
const DEFAULT_MAX_ENTRIES = 100; // Reduced for browser environments

/**
 * Simple Map-based cache implementation for browser environments
 * Uses a basic LRU eviction policy based on access order
 */
class BrowserCache {
  /**
   * Create a browser-compatible cache
   * @param {number} maxEntries - Maximum number of entries to cache
   */
  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    this.cache = new Map();
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
    const value = this.cache.get(key);

    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }

    return value;
  }

  /**
   * Set value in cache
   * @param {object} identity - Expression identity object
   * @param {any} value - Value to cache
   * @returns {Promise<void>} Promise that resolves when cache is set
   */
  async set(identity, value) {
    const key = this._generateKey(identity);

    // If we're at capacity, remove the least recently used item
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    // Remove if exists (to maintain insertion order)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, value);
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getStats() {
    let totalSize = 0;
    for (const value of this.cache.values()) {
      totalSize += estimateMemoryUsage(value);
    }

    return {
      size: this.cache.size,
      calculatedSize: totalSize,
      maxEntries: this.maxEntries
    };
  }
}

// Module-level default cache for browser
let defaultBrowserCache = null;

/**
 * Get the default browser cache
 * @returns {BrowserCache} The default browser cache instance
 */
export function getDefaultBrowserCache() {
  if (!defaultBrowserCache) {
    defaultBrowserCache = new BrowserCache();
  }
  return defaultBrowserCache;
}

export { BrowserCache };