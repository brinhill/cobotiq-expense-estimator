'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

// All money math is done in integer cents so totals never drift by a penny.
const toCents = (dollars) => Math.round(Number(dollars) * 100);
const toDollars = (cents) => Math.round(cents) / 100;

function formatUsd(dollars) {
  return Number(dollars).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Parses YYYY-MM-DD as a UTC calendar date, avoiding local time zone shifts.
function parseDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d;
}

function daysBetween(fromIso, toIso) {
  return Math.round((parseDate(toIso) - parseDate(fromIso)) / DAY_MS);
}

function addDays(iso, n) {
  return new Date(parseDate(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

// Federal fiscal year runs October through September.
function fiscalYear(iso) {
  const d = parseDate(iso);
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

module.exports = {
  toCents,
  toDollars,
  formatUsd,
  parseDate,
  daysBetween,
  addDays,
  fiscalYear,
  deepMerge,
  median,
};
