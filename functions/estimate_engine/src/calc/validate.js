'use strict';

const { DEFAULTS } = require('../config');
const { parseDate, daysBetween, deepMerge } = require('./util');

class ValidationError extends Error {
  constructor(problems) {
    super(`Invalid estimate input: ${problems.join('; ')}`);
    this.name = 'ValidationError';
    this.problems = problems;
  }
}

const MODES = ['fly', 'drive', 'none'];
const SERVICE_TYPES = ['onsite', 'warehouse'];
const PRICE_OVERRIDES = ['airfarePerPerson', 'lodgingPerNight', 'carTotal', 'mealsPerDay'];

const num = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : Number(v));
const bool = (v, fallback) => (v === undefined || v === null ? fallback : Boolean(v));
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const airport = (v) => str(v).toUpperCase();

// Turns a raw request body into a fully defaulted, validated input object.
// Throws ValidationError listing every problem at once.
function normalizeInput(body) {
  const problems = [];
  const raw = body && typeof body === 'object' ? body : {};
  const settings = deepMerge(DEFAULTS, raw.settings);
  const trip = raw.trip || {};
  const team = raw.team || {};
  const labor = raw.labor || {};
  const include = raw.include || {};

  const mode = str(trip.mode) || 'fly';
  if (!MODES.includes(mode)) problems.push(`trip.mode must be one of ${MODES.join(', ')}`);

  const departDate = str(trip.departDate);
  const returnDate = str(trip.returnDate);
  if (!parseDate(departDate)) problems.push('trip.departDate must be YYYY-MM-DD');
  if (!parseDate(returnDate)) problems.push('trip.returnDate must be YYYY-MM-DD');
  const nights = parseDate(departDate) && parseDate(returnDate) ? daysBetween(departDate, returnDate) : 0;
  if (nights < 0) problems.push('trip.returnDate must be on or after trip.departDate');

  const destination = str(trip.destination);
  if (mode !== 'none' && !destination) problems.push('trip.destination is required');

  const originAirport = airport(trip.originAirport);
  const destAirport = airport(trip.destAirport);
  if (mode === 'fly') {
    if (!/^[A-Z]{3}$/.test(originAirport)) problems.push('trip.originAirport must be a 3 letter code');
    if (!/^[A-Z]{3}$/.test(destAirport)) problems.push('trip.destAirport must be a 3 letter code');
  }

  const roundTripMiles = num(trip.roundTripMiles, 0);
  if (mode === 'drive' && !(roundTripMiles > 0)) problems.push('trip.roundTripMiles is required for drive trips');

  const technicians = num(team.technicians, 1);
  if (!Number.isInteger(technicians) || technicians < 1) problems.push('team.technicians must be a whole number of at least 1');
  const rooms = num(team.rooms, technicians);
  if (!Number.isInteger(rooms) || rooms < 0) problems.push('team.rooms must be a whole number');

  const serviceType = str(labor.serviceType) || 'onsite';
  if (!SERVICE_TYPES.includes(serviceType)) problems.push(`labor.serviceType must be one of ${SERVICE_TYPES.join(', ')}`);

  const tripDays = nights + 1;
  const travelDays = mode === 'none' ? 0 : Math.min(settings.labor.travelDays, tripDays);
  const workDays = num(labor.workDays, Math.max(tripDays - travelDays, 1));
  const hoursPerDay = num(labor.hoursPerDay, 8);
  const overtimeHours = num(labor.overtimeHours, 0);
  for (const [name, v] of [['labor.workDays', workDays], ['labor.hoursPerDay', hoursPerDay], ['labor.overtimeHours', overtimeHours]]) {
    if (!(v >= 0)) problems.push(`${name} must be zero or more`);
  }

  const otherExpenses = Array.isArray(raw.otherExpenses) ? raw.otherExpenses : [];
  otherExpenses.forEach((e, i) => {
    if (!(Number(e && e.amount) >= 0)) problems.push(`otherExpenses[${i}].amount must be zero or more`);
  });

  const overrides = {};
  for (const k of PRICE_OVERRIDES) {
    const v = raw.overrides && raw.overrides[k];
    if (v === undefined || v === null || v === '') continue;
    if (!(Number(v) >= 0)) problems.push(`overrides.${k} must be zero or more`);
    overrides[k] = Number(v);
  }

  if (problems.length) throw new ValidationError(problems);

  const flying = mode === 'fly';
  const traveling = mode !== 'none';
  return {
    dealId: str(raw.dealId) || null,
    customerName: str(raw.customerName) || null,
    trip: {
      mode,
      origin: str(trip.origin),
      destination,
      destinationZip: str(trip.destinationZip) || null,
      originAirport: originAirport || null,
      destAirport: destAirport || null,
      departDate,
      returnDate,
      nights,
      tripDays,
      travelDays,
      roundTripMiles,
    },
    team: { technicians, rooms },
    labor: {
      serviceType,
      workDays,
      hoursPerDay,
      overtimeHours,
      billTravelTime: bool(labor.billTravelTime, traveling),
    },
    include: {
      airfare: flying && bool(include.airfare, true),
      lodging: traveling && nights > 0 && bool(include.lodging, true),
      car: flying && bool(include.car, true),
      fuel: flying && bool(include.car, true) && bool(include.fuel, true),
      mileage: mode === 'drive',
      meals: traveling && bool(include.meals, true),
    },
    otherExpenses: otherExpenses.map((e) => ({ description: str(e.description) || 'Other', amount: Number(e.amount) })),
    overrides,
    settings,
  };
}

module.exports = { normalizeInput, ValidationError };
