'use strict';

// Catalyst Data Store tables (create these in the Catalyst console):
//
//   ApiCache           cache_key (Var Char 100, unique), payload (Text), stored_at (Var Char 30)
//   EstimateSnapshots  deal_id (Var Char 50), total (Double), payload (Text), created_at (Var Char 30)
//
// Cache keys are hex hashes, so they are safe to embed in ZCQL.
const CACHE_TABLE = 'ApiCache';
const SNAPSHOT_TABLE = 'EstimateSnapshots';

function createCatalystStore(req) {
  // Required lazily so tests and local runs do not need the SDK installed.
  const catalyst = require('zcatalyst-sdk-node');
  const app = catalyst.initialize(req);

  async function findCacheRow(key) {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID, payload, stored_at FROM ${CACHE_TABLE} WHERE cache_key = '${key}'`,
    );
    return rows.length ? rows[0][CACHE_TABLE] : null;
  }

  return {
    async getCache(key) {
      const row = await findCacheRow(key);
      if (!row) return null;
      try {
        return { value: JSON.parse(row.payload), storedAt: row.stored_at };
      } catch {
        return null;
      }
    },
    async setCache(key, value, storedAt) {
      const table = app.datastore().table(CACHE_TABLE);
      const payload = JSON.stringify(value);
      const existing = await findCacheRow(key);
      if (existing) {
        await table.updateRow({ ROWID: existing.ROWID, payload, stored_at: storedAt });
      } else {
        await table.insertRow({ cache_key: key, payload, stored_at: storedAt });
      }
    },
    async saveSnapshot(snapshot) {
      const row = await app.datastore().table(SNAPSHOT_TABLE).insertRow({
        deal_id: snapshot.input.dealId || '',
        total: snapshot.estimate.totals.total,
        payload: JSON.stringify(snapshot),
        created_at: snapshot.pricedAt,
      });
      return String(row.ROWID);
    },
  };
}

module.exports = { createCatalystStore };
