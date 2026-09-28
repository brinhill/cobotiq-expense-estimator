'use strict';

const fs = require('fs');
const path = require('path');

// Fixture values are illustrative shapes, not real market or GSA rates.
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));

// Fake fetch: routes map a URL substring to a fixture object, an HTTP status
// number, or an Error. Every call is recorded in `calls`.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const match = Object.keys(routes).find((k) => url.includes(k));
    if (!match) throw new Error(`unexpected fetch ${url}`);
    const r = routes[match];
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
  impl.calls = calls;
  return impl;
}

const ALL_ROUTES = () => ({
  'engine=google_flights': fixture('serpapi-flights'),
  'engine=google_hotels': fixture('serpapi-hotels'),
  searchDestination: fixture('cars-destination'),
  searchCarRentals: fixture('cars-search'),
  'api.gsa.gov': fixture('gsa-austin'),
});

const KEYS = { serpapi: 'test-serp', rapidapi: 'test-rapid', gsa: 'DEMO_KEY' };

function baseBody(extra = {}) {
  return {
    dealId: 'D-100',
    trip: {
      mode: 'fly',
      origin: 'Richmond, VA',
      destination: 'Austin, TX',
      originAirport: 'RIC',
      destAirport: 'AUS',
      departDate: '2026-03-01',
      returnDate: '2026-03-05',
    },
    team: { technicians: 2 },
    labor: { serviceType: 'onsite', hoursPerDay: 8 },
    ...extra,
  };
}

module.exports = { fixture, fakeFetch, ALL_ROUTES, KEYS, baseBody };
