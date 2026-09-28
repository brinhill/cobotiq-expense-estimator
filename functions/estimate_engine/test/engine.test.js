'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { runEstimate } = require('../src/engine');
const { createMemoryStore } = require('../src/store/memory');
const { createHandler } = require('../index');
const { fakeFetch, ALL_ROUTES, KEYS, baseBody } = require('./helpers');

const NOW = new Date('2026-02-10T12:00:00.000Z');
const deps = (fetchImpl, store = createMemoryStore(), now = NOW) => ({ fetchImpl, store, keys: KEYS, now: () => now });

test('engine: full live estimate', async () => {
  const fetchImpl = fakeFetch(ALL_ROUTES());
  const r = await runEstimate(baseBody(), deps(fetchImpl));
  const src = Object.fromEntries(r.estimate.lines.map((l) => [l.key, l.source]));
  assert.equal(src.airfare, 'live');
  assert.equal(src.lodging, 'live');
  assert.equal(src.car, 'live');
  assert.equal(src.meals, 'live');
  assert.equal(r.prices.meals.amount, 74);
  assert.equal(r.prices.car.amount, 243.12);
  assert.ok(r.options.airfare.length > 0);
  assert.equal(r.prices.airfare.options, undefined);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.lineItems.length, 1);
  assert.equal(r.lineItems[0].rate, r.estimate.totals.total);
  assert.equal(r.estimate.allLive, true);
});

test('engine: fresh cache avoids repeat API calls', async () => {
  const store = createMemoryStore();
  const first = fakeFetch(ALL_ROUTES());
  await runEstimate(baseBody(), deps(first, store));
  const second = fakeFetch(ALL_ROUTES());
  const r = await runEstimate(baseBody(), deps(second, store, new Date(NOW.getTime() + 60 * 60 * 1000)));
  assert.equal(second.calls.length, 0);
  assert.equal(r.prices.airfare.source, 'live');
  assert.equal(r.prices.airfare.fetchedAt, NOW.toISOString());
});

test('engine: failed search uses a cached price within 7 days, flagged stale', async () => {
  const store = createMemoryStore();
  await runEstimate(baseBody(), deps(fakeFetch(ALL_ROUTES()), store));
  const failing = fakeFetch({ ...ALL_ROUTES(), searchCarRentals: 503 });
  const r = await runEstimate(baseBody(), deps(failing, store, new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000)));
  assert.equal(r.prices.car.source, 'stale');
  assert.equal(r.prices.car.amount, 243.12);
  assert.ok(r.warnings.some((w) => /cars: .*HTTP 503/.test(w)));
  assert.match(r.lineItems[0].description, /\[cached, not live\]/);
});

test('engine: no keys and no cache falls back to defaults and GSA, with warnings', async () => {
  const fetchImpl = fakeFetch({ 'api.gsa.gov': ALL_ROUTES()['api.gsa.gov'] });
  const r = await runEstimate(baseBody(), { ...deps(fetchImpl), keys: { serpapi: null, rapidapi: null, gsa: 'DEMO_KEY' } });
  assert.equal(r.prices.airfare.source, 'fallback');
  assert.equal(r.prices.airfare.amount, 450);
  // Hotel falls back to the GSA lodging rate for March.
  assert.equal(r.prices.lodging.source, 'fallback');
  assert.equal(r.prices.lodging.amount, 197);
  // 4 rental days x $65 default
  assert.equal(r.prices.car.amount, 260);
  assert.equal(r.prices.meals.source, 'live');
  assert.equal(r.estimate.allLive, false);
  assert.ok(r.warnings.some((w) => /SERPAPI_KEY is not configured/.test(w)));
  assert.ok(r.warnings.some((w) => /RAPIDAPI_KEY is not configured/.test(w)));
});

test('engine: everything down still produces an estimate', async () => {
  const r = await runEstimate(baseBody(), deps(fakeFetch({})));
  assert.equal(r.prices.lodging.amount, 110);
  assert.equal(r.prices.meals.amount, 68);
  assert.ok(r.estimate.totals.total > 0);
});

test('engine: manual overrides skip the search', async () => {
  const fetchImpl = fakeFetch({});
  const body = baseBody({ overrides: { airfarePerPerson: 399, lodgingPerNight: 150, carTotal: 300, mealsPerDay: 60 } });
  const r = await runEstimate(body, deps(fetchImpl));
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(r.prices.airfare.source, 'manual');
  assert.equal(r.estimate.lines.find((l) => l.key === 'airfare').amount, 798);
});

test('engine: save stores a snapshot', async () => {
  const store = createMemoryStore();
  const r = await runEstimate({ ...baseBody(), save: true }, deps(fakeFetch(ALL_ROUTES()), store));
  assert.equal(r.snapshotId, 'mem-1');
  assert.equal(store.snapshots[0].input.dealId, 'D-100');
  assert.equal(store.snapshots[0].estimate.totals.total, r.estimate.totals.total);
});

function call(handler, method, url, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  Object.assign(req, { method, url, headers });
  return new Promise((resolve) => {
    const res = {
      writeHead(status, h) { this.status = status; this.headers = h; },
      end(text) { resolve({ status: this.status, headers: this.headers, body: text ? JSON.parse(text) : null }); },
    };
    handler(req, res);
  });
}

test('handler: calculate, validation errors, health, 404', async () => {
  const handler = createHandler(() => deps(fakeFetch(ALL_ROUTES())));

  const ok = await call(handler, 'POST', '/estimate/calculate', baseBody());
  assert.equal(ok.status, 200);
  assert.ok(ok.body.estimate.totals.total > 0);

  const bad = await call(handler, 'POST', '/estimate/calculate', { trip: {} });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.problems.length > 0);

  const notJson = await call(handler, 'POST', '/estimate/calculate', '{oops');
  assert.equal(notJson.status, 400);

  const health = await call(handler, 'GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.defaults.labor.hourlyRate, 150);
  assert.equal(JSON.stringify(health.body).includes('test-serp'), false);

  assert.equal((await call(handler, 'GET', '/nope')).status, 404);
});

test('handler: CORS only for allowed origins', async () => {
  const handler = createHandler(() => deps(fakeFetch(ALL_ROUTES())));
  process.env.ALLOWED_ORIGINS = 'https://allowed.example.com';
  try {
    const yes = await call(handler, 'GET', '/health', undefined, { origin: 'https://allowed.example.com' });
    assert.equal(yes.headers['Access-Control-Allow-Origin'], 'https://allowed.example.com');
    const no = await call(handler, 'GET', '/health', undefined, { origin: 'https://evil.example.com' });
    assert.equal(no.headers['Access-Control-Allow-Origin'], undefined);
  } finally {
    delete process.env.ALLOWED_ORIGINS;
  }
});
