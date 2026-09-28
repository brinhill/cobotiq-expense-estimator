'use strict';

const { ProviderError, getJson } = require('./http');
const { fiscalYear, addDays, parseDate } = require('../calc/util');

const PROVIDER = 'GSA Per Diem';
const BASE = 'https://api.gsa.gov/travel/perdiem/v2/rates';

// "Austin, TX" -> { city: 'Austin', state: 'TX' }
function parseCityState(text) {
  const m = /^\s*([^,]+?)\s*,\s*([A-Za-z]{2})\b/.exec(text || '');
  return m ? { city: m[1], state: m[2].toUpperCase() } : null;
}

function pickRate(data, city) {
  const rates = ((data && data.rates) || []).flatMap((r) => r.rate || []);
  if (!rates.length) return null;
  const want = (city || '').toLowerCase();
  return (
    rates.find((r) => want && String(r.city || '').toLowerCase().includes(want)) ||
    rates.find((r) => String(r.standardRate) !== 'true') ||
    rates[0]
  );
}

function monthlyLodging(rate, monthNumber) {
  const months = (rate.months && rate.months.month) || [];
  const m = months.find((x) => Number(x.number) === monthNumber);
  return m ? Number(m.value) : null;
}

// M&IE per day, and lodging per night averaged over the nights of the stay
// (GSA lodging rates are seasonal and change by month).
async function lookupPerDiem({ destination, zip, departDate, returnDate }, { key, fetchImpl }) {
  const fy = fiscalYear(departDate);
  let path;
  let city = null;
  if (zip) {
    path = `zip/${encodeURIComponent(zip)}/year/${fy}`;
  } else {
    const cs = parseCityState(destination);
    if (!cs) throw new ProviderError(PROVIDER, 'destination must look like "City, ST" or include a ZIP');
    city = cs.city;
    path = `city/${encodeURIComponent(cs.city)}/state/${cs.state}/year/${fy}`;
  }
  const data = await getJson(PROVIDER, `${BASE}/${path}?api_key=${encodeURIComponent(key || 'DEMO_KEY')}`, { fetchImpl });
  const rate = pickRate(data, city);
  if (!rate) throw new ProviderError(PROVIDER, 'no rate returned');

  const meals = Number(rate.meals);
  const nightly = [];
  for (let d = departDate; d < returnDate; d = addDays(d, 1)) {
    const v = monthlyLodging(rate, parseDate(d).getUTCMonth() + 1);
    if (v) nightly.push(v);
  }
  if (!nightly.length) {
    const v = monthlyLodging(rate, parseDate(departDate).getUTCMonth() + 1);
    if (v) nightly.push(v);
  }
  const lodging = nightly.length ? Math.round((nightly.reduce((a, b) => a + b, 0) / nightly.length) * 100) / 100 : null;
  const label = String(rate.standardRate) === 'true' ? 'GSA standard rate' : `GSA rate for ${rate.city}`;
  return { meals: meals > 0 ? meals : null, lodging, detail: `${label}, FY${fy}` };
}

module.exports = { lookupPerDiem, parseCityState, pickRate };
