'use strict';

// In-memory store with the same interface as the Catalyst store. Used by tests
// and by the local smoke test script.
function createMemoryStore() {
  const cache = new Map();
  const snapshots = [];
  return {
    async getCache(key) {
      return cache.get(key) || null;
    },
    async setCache(key, value, storedAt) {
      cache.set(key, { value, storedAt });
    },
    async saveSnapshot(snapshot) {
      snapshots.push(snapshot);
      return `mem-${snapshots.length}`;
    },
    snapshots,
  };
}

module.exports = { createMemoryStore };
