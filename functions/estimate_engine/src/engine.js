'use strict';

const { normalizeInput } = require('./calc/validate');
const { computeEstimate } = require('./calc/estimate');
const { buildRollup } = require('./calc/rollup');
const { fetchPrices } = require('./pricing');

// Full estimate: validate input, fetch prices, calculate, build the Books
// line item(s), and optionally save a snapshot of everything used.
async function runEstimate(body, deps) {
  const input = normalizeInput(body);
  const { prices, options, warnings, pricedAt } = await fetchPrices(input, deps);
  const estimate = computeEstimate(input, prices);
  const lineItems = buildRollup(input, estimate, pricedAt);

  const result = { pricedAt, estimate, lineItems, prices, options, warnings, snapshotId: null };
  if (body && body.save) {
    try {
      result.snapshotId = await deps.store.saveSnapshot({ pricedAt, input, prices, estimate, lineItems, warnings });
    } catch (err) {
      warnings.push(`snapshot: save failed (${err.message})`);
    }
  }
  return result;
}

module.exports = { runEstimate };
