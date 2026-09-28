'use strict';

const { ProviderError, getJson, query } = require('./http');
const { median } = require('../calc/util');

const BASE = 'https://serpapi.com/search.json';

async function serpapi(provider, params, { key, fetchImpl }) {
  if (!key) throw new ProviderError(provider, 'SERPAPI_KEY is not configured');
  const data = await getJson(provider, `${BASE}?${query({ ...params, api_key: key })}`, { fetchImpl });
  if (data.error) throw new ProviderError(provider, data.error);
  return data;
}

function parseFlights(data) {
  const toOption = (group) => (f) => {
    const legs = Array.isArray(f.flights) ? f.flights : [];
    return {
      price: Number(f.price),
      airline: [...new Set(legs.map((l) => l.airline).filter(Boolean))].join(' / ') || 'Multiple airlines',
      stops: Math.max(legs.length - 1, 0),
      durationMin: Number(f.total_duration) || null,
      group,
    };
  };
  return [
    ...(data.best_flights || []).map(toOption('best')),
    ...(data.other_flights || []).map(toOption('other')),
  ].filter((o) => o.price > 0);
}

// Round trip economy fare for one adult. The pick is the cheapest of Google's
// "best" flights, which avoids pricing a quote on an unrealistic itinerary.
async function searchFlights({ from, to, departDate, returnDate }, deps) {
  const data = await serpapi('SerpApi Google Flights', {
    engine: 'google_flights',
    departure_id: from,
    arrival_id: to,
    outbound_date: departDate,
    return_date: returnDate,
    type: 1,
    travel_class: 1,
    adults: 1,
    currency: 'USD',
    hl: 'en',
    gl: 'us',
  }, deps);
  const options = parseFlights(data).sort((a, b) => a.price - b.price);
  if (!options.length) throw new ProviderError('SerpApi Google Flights', 'no flights returned');
  const best = options.filter((o) => o.group === 'best');
  const pick = (best.length ? best : options)[0];
  return {
    amount: pick.price,
    detail: `${pick.airline}, ${pick.stops} stop${pick.stops === 1 ? '' : 's'}`,
    options: options.slice(0, 8),
  };
}

function parseHotels(data) {
  return (data.properties || [])
    .map((p) => ({
      name: p.name,
      perNight: Number(p.rate_per_night && p.rate_per_night.extracted_lowest),
      rating: Number(p.overall_rating) || null,
      hotelClass: Number(p.extracted_hotel_class) || null,
    }))
    .filter((h) => h.perNight > 0);
}

// Nightly rate including taxes and fees. The pick is the median of well rated
// hotels near the site, so one luxury or budget outlier does not skew a quote.
async function searchHotels({ near, checkIn, checkOut, minRating }, deps) {
  const data = await serpapi('SerpApi Google Hotels', {
    engine: 'google_hotels',
    q: `hotels near ${near}`,
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults: 1,
    currency: 'USD',
    hl: 'en',
    gl: 'us',
  }, deps);
  const all = parseHotels(data);
  if (!all.length) throw new ProviderError('SerpApi Google Hotels', 'no hotel rates returned');
  const rated = all.filter((h) => h.rating !== null && h.rating >= minRating);
  const pool = rated.length ? rated : all;
  const amount = Math.round(median(pool.map((h) => h.perNight)) * 100) / 100;
  return {
    amount,
    detail: `median of ${pool.length} hotel${pool.length === 1 ? '' : 's'}${rated.length ? ` rated ${minRating}+` : ''}`,
    options: [...pool].sort((a, b) => a.perNight - b.perNight).slice(0, 8),
  };
}

module.exports = { searchFlights, searchHotels, parseFlights, parseHotels };
