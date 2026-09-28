'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchFlights, searchHotels } = require('../src/providers/serpapi');
const { searchCars, matchesClass } = require('../src/providers/cars');
const { lookupPerDiem, parseCityState } = require('../src/providers/gsa');
const { fixture, fakeFetch } = require('./helpers');

test('flights: picks cheapest "best" itinerary, not the cheapest overall', async () => {
  const fetchImpl = fakeFetch({ google_flights: fixture('serpapi-flights') });
  const r = await searchFlights({ from: 'RIC', to: 'AUS', departDate: '2026-03-01', returnDate: '2026-03-05' }, { key: 'k', fetchImpl });
  assert.equal(r.amount, 512);
  assert.equal(r.detail, 'Delta, 1 stop');
  assert.equal(r.options[0].price, 289);
  assert.equal(r.options.length, 3);
  const url = fetchImpl.calls[0];
  assert.match(url, /departure_id=RIC/);
  assert.match(url, /return_date=2026-03-05/);
  assert.match(url, /api_key=k/);
});

test('flights: missing key and API errors are reported', async () => {
  await assert.rejects(searchFlights({}, { key: null, fetchImpl: fakeFetch({}) }), /SERPAPI_KEY is not configured/);
  await assert.rejects(
    searchFlights({ from: 'RIC', to: 'AUS' }, { key: 'k', fetchImpl: fakeFetch({ google_flights: { error: 'Invalid API key.' } }) }),
    /Invalid API key/,
  );
  await assert.rejects(searchFlights({ from: 'RIC', to: 'AUS' }, { key: 'k', fetchImpl: fakeFetch({ google_flights: 429 }) }), /HTTP 429/);
});

test('hotels: median of hotels rated 3.5 and up', async () => {
  const fetchImpl = fakeFetch({ google_hotels: fixture('serpapi-hotels') });
  const r = await searchHotels({ near: 'Austin, TX', checkIn: '2026-03-01', checkOut: '2026-03-05', minRating: 3.5 }, { key: 'k', fetchImpl });
  // Rated pool: 158, 171, 189, 689 -> median (171 + 189) / 2
  assert.equal(r.amount, 180);
  assert.match(r.detail, /median of 4 hotels rated 3.5\+/);
  assert.match(fetchImpl.calls[0], /q=hotels\+near\+Austin%2C\+TX/);
});

test('cars: cheapest midsize in USD, drive away price preferred', async () => {
  const fetchImpl = fakeFetch({ searchDestination: fixture('cars-destination'), searchCarRentals: fixture('cars-search') });
  const r = await searchCars({ airport: 'AUS', pickupDate: '2026-03-01', dropoffDate: '2026-03-05', carClass: 'midsize' }, { key: 'k', fetchImpl });
  assert.equal(r.amount, 243.12);
  assert.equal(r.detail, 'Enterprise, Toyota Corolla');
  assert.match(fetchImpl.calls[1], /pick_up_latitude=30.1945/);
});

test('cars: falls back to cheapest car when class is unavailable', async () => {
  const fetchImpl = fakeFetch({ searchDestination: fixture('cars-destination'), searchCarRentals: fixture('cars-search') });
  const r = await searchCars({ airport: 'AUS', pickupDate: '2026-03-01', dropoffDate: '2026-03-05', carClass: 'minivan' }, { key: 'k', fetchImpl });
  assert.equal(r.amount, 176.4);
  assert.match(r.detail, /no minivan available/);
});

test('cars: class aliases', () => {
  assert.ok(matchesClass({ group: 'intermediate' }, 'midsize'));
  assert.ok(matchesClass({ group: 'medium' }, 'midsize'));
  assert.ok(!matchesClass({ group: 'economy' }, 'midsize'));
});

test('gsa: city lookup, fiscal year, seasonal lodging average', async () => {
  const fetchImpl = fakeFetch({ 'api.gsa.gov': fixture('gsa-austin') });
  // Nights of Feb 27, Feb 28, Mar 1: (163 + 163 + 197) / 3
  const r = await lookupPerDiem({ destination: 'Austin, TX', departDate: '2026-02-27', returnDate: '2026-03-02' }, { key: 'DEMO_KEY', fetchImpl });
  assert.equal(r.meals, 74);
  assert.equal(r.lodging, 174.33);
  assert.equal(r.detail, 'GSA rate for Austin, FY2026');
  assert.match(fetchImpl.calls[0], /rates\/city\/Austin\/state\/TX\/year\/2026\?api_key=DEMO_KEY/);
});

test('gsa: ZIP lookup takes priority and October uses next fiscal year', async () => {
  const fetchImpl = fakeFetch({ 'api.gsa.gov': fixture('gsa-austin') });
  await lookupPerDiem({ destination: 'Austin, TX', zip: '78701', departDate: '2026-10-05', returnDate: '2026-10-07' }, { key: 'x', fetchImpl });
  assert.match(fetchImpl.calls[0], /rates\/zip\/78701\/year\/2027/);
});

test('gsa: parses "City, ST"', () => {
  assert.deepEqual(parseCityState('San Antonio, tx 78205'), { city: 'San Antonio', state: 'TX' });
  assert.equal(parseCityState('Austin'), null);
});
