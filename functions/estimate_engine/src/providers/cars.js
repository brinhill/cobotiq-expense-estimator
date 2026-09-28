'use strict';

const { ProviderError, getJson, query } = require('./http');

const PROVIDER = 'RapidAPI Booking.com Cars';
const HOST = 'booking-com15.p.rapidapi.com';

// Booking.com labels classes differently by market; these all mean midsize.
const CLASS_ALIASES = {
  economy: ['economy', 'mini', 'small'],
  compact: ['compact'],
  midsize: ['midsize', 'mid-size', 'intermediate', 'medium'],
  standard: ['standard'],
  fullsize: ['fullsize', 'full-size', 'full size', 'large'],
  suv: ['suv', 'suvs'],
};

async function rapid(path, params, { key, fetchImpl }) {
  if (!key) throw new ProviderError(PROVIDER, 'RAPIDAPI_KEY is not configured');
  const data = await getJson(PROVIDER, `https://${HOST}${path}?${query(params)}`, {
    fetchImpl,
    headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': HOST },
  });
  if (data && data.status === false) throw new ProviderError(PROVIDER, data.message || 'request rejected');
  return data;
}

function firstCoordinates(data) {
  const list = Array.isArray(data && data.data) ? data.data : [];
  for (const d of list) {
    const c = d.coordinates || d;
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, name: d.name || d.label || null };
  }
  return null;
}

function parseCars(data) {
  const results = (data && data.data && data.data.search_results) || [];
  return results
    .map((r) => {
      const v = r.vehicle_info || {};
      const p = r.pricing_info || {};
      return {
        name: v.v_name || v.label || 'Car',
        group: String(v.group || v.category || v.label || '').toLowerCase(),
        supplier: (r.supplier_info && r.supplier_info.name) || null,
        total: Number(p.drive_away_price || p.price),
        currency: p.currency || 'USD',
      };
    })
    .filter((c) => c.total > 0 && c.currency === 'USD');
}

function matchesClass(car, carClass) {
  const aliases = CLASS_ALIASES[carClass] || [carClass];
  return aliases.some((a) => car.group.includes(a));
}

// Total rental price per car for the whole pickup to drop off period at the
// destination airport. Picks the cheapest car in the requested class.
async function searchCars({ airport, pickupDate, dropoffDate, carClass }, deps) {
  const place = firstCoordinates(await rapid('/api/v1/cars/searchDestination', { query: airport }, deps));
  if (!place) throw new ProviderError(PROVIDER, `no pickup location found for ${airport}`);

  const data = await rapid('/api/v1/cars/searchCarRentals', {
    pick_up_latitude: place.lat,
    pick_up_longitude: place.lon,
    drop_off_latitude: place.lat,
    drop_off_longitude: place.lon,
    pick_up_date: pickupDate,
    drop_off_date: dropoffDate,
    pick_up_time: '10:00',
    drop_off_time: '10:00',
    driver_age: 30,
    currency_code: 'USD',
  }, deps);

  const cars = parseCars(data).sort((a, b) => a.total - b.total);
  if (!cars.length) throw new ProviderError(PROVIDER, 'no car rates returned');
  const inClass = cars.filter((c) => matchesClass(c, carClass));
  const pick = (inClass.length ? inClass : cars)[0];
  return {
    amount: pick.total,
    detail: `${pick.supplier ? `${pick.supplier}, ` : ''}${pick.name}${inClass.length ? '' : ` (no ${carClass} available, cheapest shown)`}`,
    options: (inClass.length ? inClass : cars).slice(0, 8),
  };
}

module.exports = { searchCars, parseCars, firstCoordinates, matchesClass };
