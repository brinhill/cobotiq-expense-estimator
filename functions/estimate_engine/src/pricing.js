'use strict';

const crypto = require('crypto');
const { searchFlights, searchHotels } = require('./providers/serpapi');
const { searchCars } = require('./providers/cars');
const { lookupPerDiem } = require('./providers/gsa');
const { addDays } = require('./calc/util');

const HOUR_MS = 60 * 60 * 1000;

function cacheKey(parts) {
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

// Fetches every price an estimate needs. Each price comes back as
// { amount, detail, source, fetchedAt } where source is one of:
//   live      fetched now, or cached within the fresh window
//   stale     live search failed; an older cached price was used
//   fallback  live search failed and nothing usable was cached; a default was used
//   manual    entered by the user (override); no search was made
async function fetchPrices(input, deps) {
  const { store, keys, fetchImpl } = deps;
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const { trip, include, overrides, settings } = input;
  const t = settings.travel;
  const warnings = [];
  const options = {};

  async function cached(name, parts, live) {
    const key = cacheKey([name, ...parts]);
    let hit = null;
    try {
      hit = await store.getCache(key);
    } catch (err) {
      warnings.push(`${name}: cache read failed (${err.message})`);
    }
    const ageMs = hit ? now - new Date(hit.storedAt) : Infinity;
    if (hit && ageMs < settings.cache.freshHours * HOUR_MS) {
      return { ...hit.value, source: 'live', fetchedAt: hit.storedAt };
    }
    try {
      const value = await live();
      try {
        await store.setCache(key, value, nowIso);
      } catch (err) {
        warnings.push(`${name}: cache write failed (${err.message})`);
      }
      return { ...value, source: 'live', fetchedAt: nowIso };
    } catch (err) {
      warnings.push(`${name}: ${err.message}`);
      if (hit && ageMs < settings.cache.staleDays * 24 * HOUR_MS) {
        return { ...hit.value, source: 'stale', fetchedAt: hit.storedAt };
      }
      return null;
    }
  }

  const manual = (amount) => ({ amount, detail: 'manual entry', source: 'manual', fetchedAt: null });
  const fallback = (amount, detail) => ({ amount, detail, source: 'fallback', fetchedAt: null });
  const withOptions = (name, price) => {
    if (price && price.options) options[name] = price.options;
    if (!price) return price;
    const { options: _omit, ...rest } = price;
    return rest;
  };

  const needGsa = (include.meals && overrides.mealsPerDay === undefined) ||
    (include.lodging && overrides.lodgingPerNight === undefined);
  const gsaPromise = needGsa
    ? cached('gsa', [trip.destinationZip || trip.destination, trip.departDate, trip.returnDate], () =>
      lookupPerDiem({ destination: trip.destination, zip: trip.destinationZip, departDate: trip.departDate, returnDate: trip.returnDate },
        { key: keys.gsa, fetchImpl }))
    : Promise.resolve(null);

  const airfareP = !include.airfare ? null
    : overrides.airfarePerPerson !== undefined ? manual(overrides.airfarePerPerson)
      : cached('flights', [trip.originAirport, trip.destAirport, trip.departDate, trip.returnDate], () =>
        searchFlights({ from: trip.originAirport, to: trip.destAirport, departDate: trip.departDate, returnDate: trip.returnDate },
          { key: keys.serpapi, fetchImpl }))
        .then((p) => p || fallback(t.fallbackAirfarePerPerson, 'default airfare'));

  const lodgingP = !include.lodging ? null
    : overrides.lodgingPerNight !== undefined ? manual(overrides.lodgingPerNight)
      : cached('hotels', [trip.destination, trip.departDate, trip.returnDate, t.minHotelRating], () =>
        searchHotels({ near: trip.destination, checkIn: trip.departDate, checkOut: trip.returnDate, minRating: t.minHotelRating },
          { key: keys.serpapi, fetchImpl }))
        .then(async (p) => {
          if (p) return p;
          const gsa = await gsaPromise;
          return gsa && gsa.lodging ? fallback(gsa.lodging, `${gsa.detail} lodging`) : fallback(t.fallbackLodgingPerNight, 'GSA standard lodging default');
        });

  const rentalDays = Math.max(trip.nights, 1);
  const dropoff = trip.nights > 0 ? trip.returnDate : addDays(trip.departDate, 1);
  const carP = !include.car ? null
    : overrides.carTotal !== undefined ? manual(overrides.carTotal)
      : cached('cars', [trip.destAirport, trip.departDate, dropoff, t.carClass], () =>
        searchCars({ airport: trip.destAirport, pickupDate: trip.departDate, dropoffDate: dropoff, carClass: t.carClass },
          { key: keys.rapidapi, fetchImpl }))
        .then((p) => p || fallback(Math.round(t.fallbackCarPerDay * rentalDays * 100) / 100, `default $${t.fallbackCarPerDay}/day`));

  const mealsP = !include.meals ? null
    : overrides.mealsPerDay !== undefined ? manual(overrides.mealsPerDay)
      : gsaPromise.then((gsa) => (gsa && gsa.meals
        ? { amount: gsa.meals, detail: `${gsa.detail} M&IE`, source: gsa.source, fetchedAt: gsa.fetchedAt }
        : fallback(t.fallbackMealsPerDay, 'GSA standard M&IE default')));

  const [airfare, lodging, car, meals] = await Promise.all([airfareP, lodgingP, carP, mealsP]);
  return {
    prices: {
      airfare: withOptions('airfare', airfare),
      lodging: withOptions('lodging', lodging),
      car: withOptions('car', car),
      meals,
    },
    options,
    warnings,
    pricedAt: nowIso,
  };
}

module.exports = { fetchPrices, cacheKey };
