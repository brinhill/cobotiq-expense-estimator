'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInput, ValidationError } = require('../src/calc/validate');
const { computeEstimate } = require('../src/calc/estimate');
const { buildRollup } = require('../src/calc/rollup');
const { fiscalYear, daysBetween } = require('../src/calc/util');
const { baseBody } = require('./helpers');

const live = (amount) => ({ amount, detail: 'test', source: 'live', fetchedAt: '2026-02-10T00:00:00.000Z' });
const PRICES = { airfare: live(500), lodging: live(180), car: live(240), meals: live(74) };
const byKey = (est, key) => est.lines.find((l) => l.key === key);

test('dates: trip length and fiscal year', () => {
  assert.equal(daysBetween('2026-03-01', '2026-03-05'), 4);
  assert.equal(fiscalYear('2026-09-30'), 2026);
  assert.equal(fiscalYear('2026-10-01'), 2027);
});

test('defaults: work days exclude the two travel days', () => {
  const input = normalizeInput(baseBody());
  assert.equal(input.trip.nights, 4);
  assert.equal(input.trip.tripDays, 5);
  assert.equal(input.labor.workDays, 3);
  assert.equal(input.team.rooms, 2);
});

test('labor: onsite bills the 4 hour daily minimum', () => {
  const input = normalizeInput(baseBody({ labor: { serviceType: 'onsite', hoursPerDay: 2, workDays: 3 } }));
  const est = computeEstimate(input, PRICES);
  // 2 techs x 3 days x 4 hrs x $150
  assert.equal(byKey(est, 'labor_regular').amount, 3600);
  assert.match(byKey(est, 'labor_regular').detail, /4 hr minimum/);
});

test('labor: warehouse break/fix has no minimum', () => {
  const input = normalizeInput(baseBody({
    trip: { mode: 'none', departDate: '2026-03-02', returnDate: '2026-03-02' },
    team: { technicians: 1 },
    labor: { serviceType: 'warehouse', hoursPerDay: 1.5, workDays: 1 },
  }));
  const est = computeEstimate(input, {});
  assert.equal(byKey(est, 'labor_regular').amount, 225);
  assert.equal(byKey(est, 'labor_travel'), undefined);
  assert.equal(est.lines.filter((l) => l.category === 'expense').length, 0);
  assert.equal(est.totals.total, 225);
});

test('labor: overtime at the placeholder 1.5x and editable rates', () => {
  const input = normalizeInput(baseBody({
    labor: { serviceType: 'onsite', hoursPerDay: 8, overtimeHours: 3 },
    settings: { labor: { hourlyRate: 160 } },
  }));
  const est = computeEstimate(input, PRICES);
  // 2 techs x 3 OT hrs x $240
  assert.equal(byKey(est, 'labor_overtime').amount, 1440);
});

test('labor: travel days billed at 4 hours each, and can be turned off', () => {
  const on = computeEstimate(normalizeInput(baseBody()), PRICES);
  // 2 techs x 2 travel days x 4 hrs x $150
  assert.equal(byKey(on, 'labor_travel').amount, 2400);
  const off = computeEstimate(normalizeInput(baseBody({ labor: { billTravelTime: false } })), PRICES);
  assert.equal(byKey(off, 'labor_travel'), undefined);
});

test('expenses: airfare, hotel, shared car, fuel', () => {
  const est = computeEstimate(normalizeInput(baseBody({ team: { technicians: 3 } })), PRICES);
  assert.equal(byKey(est, 'airfare').amount, 1500);
  assert.equal(byKey(est, 'lodging').amount, 180 * 4 * 3);
  // 3 techs at 2 per car = 2 cars
  assert.equal(byKey(est, 'car').amount, 480);
  // 2 cars x 4 days x $30
  assert.equal(byKey(est, 'fuel').amount, 240);
});

test('expenses: fuel default is editable', () => {
  const est = computeEstimate(normalizeInput(baseBody({ settings: { travel: { fuelPerCarPerDay: 45 } } })), PRICES);
  assert.equal(byKey(est, 'fuel').amount, 180);
});

test('meals: GSA 75% on first and last day', () => {
  const est = computeEstimate(normalizeInput(baseBody()), PRICES);
  // 2 techs x (0.75 + 0.75 + 3 full days) x $74
  assert.equal(byKey(est, 'meals').amount, 666);
});

test('meals: single day trip gets one 75% day', () => {
  const input = normalizeInput(baseBody({ trip: { ...baseBody().trip, returnDate: '2026-03-01' }, team: { technicians: 1 } }));
  const est = computeEstimate(input, PRICES);
  assert.equal(byKey(est, 'meals').amount, 55.5);
  assert.equal(byKey(est, 'lodging'), undefined);
  // Same day rental is billed as one day.
  assert.equal(byKey(est, 'fuel').amount, 30);
});

test('drive mode: mileage instead of airfare and rental car', () => {
  const input = normalizeInput(baseBody({
    trip: { mode: 'drive', destination: 'Raleigh, NC', departDate: '2026-03-01', returnDate: '2026-03-03', roundTripMiles: 340 },
  }));
  const est = computeEstimate(input, PRICES);
  assert.equal(byKey(est, 'airfare'), undefined);
  assert.equal(byKey(est, 'car'), undefined);
  assert.equal(byKey(est, 'fuel'), undefined);
  // 1 vehicle for 2 techs x 340 mi x $0.70
  assert.equal(byKey(est, 'mileage').amount, 238);
});

test('adjustments: markup on expenses only, contingency on everything, cents exact', () => {
  const input = normalizeInput(baseBody({
    otherExpenses: [{ description: 'Parking', amount: 33.33 }],
    settings: { adjustments: { expenseMarkupPct: 10, contingencyPct: 5 } },
  }));
  const est = computeEstimate(input, PRICES);
  const { labor, expenses, markup, contingency, total } = est.totals;
  assert.equal(markup, Math.round(expenses * 10) / 100);
  assert.equal(contingency, Math.round((labor + expenses + markup) * 5) / 100);
  assert.equal(total, Math.round((labor + expenses + markup + contingency) * 100) / 100);
  assert.equal(byKey(est, 'other_0').amount, 33.33);
});

test('rollup: single line carries the full breakdown', () => {
  const input = normalizeInput(baseBody());
  const est = computeEstimate(input, PRICES);
  const items = buildRollup(input, est, '2026-02-10T12:00:00.000Z');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Travel & Labor (Field Service)');
  assert.equal(items[0].rate, est.totals.total);
  assert.match(items[0].description, /Onsite service, 2 techs, Richmond, VA to Austin, TX/);
  assert.match(items[0].description, /Hotel: 4 nights x 2 rooms/);
  assert.match(items[0].description, /Priced 2026-02-10 \(live rates\)/);
});

test('rollup: labor separate mode splits into two lines that sum to the total', () => {
  const input = normalizeInput(baseBody({ settings: { rollup: { mode: 'laborSeparate' } } }));
  const est = computeEstimate(input, PRICES);
  const items = buildRollup(input, est, '2026-02-10T12:00:00.000Z');
  assert.equal(items.length, 2);
  assert.equal(Math.round((items[0].rate + items[1].rate) * 100), Math.round(est.totals.total * 100));
});

test('rollup: flags non live prices', () => {
  const input = normalizeInput(baseBody());
  const est = computeEstimate(input, { ...PRICES, car: { amount: 260, detail: 'default', source: 'fallback' } });
  assert.equal(est.allLive, false);
  const [item] = buildRollup(input, est, '2026-02-10T12:00:00.000Z');
  assert.match(item.description, /Car rental: .*\[estimated, not live\]/);
  assert.match(item.description, /includes non live rates/);
});

test('validation: reports every problem at once', () => {
  assert.throws(
    () => normalizeInput({ trip: { mode: 'fly', departDate: '2026-03-05', returnDate: '2026-03-01', originAirport: 'RI' }, team: { technicians: 0 } }),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.ok(err.problems.includes('trip.returnDate must be on or after trip.departDate'));
      assert.ok(err.problems.includes('trip.originAirport must be a 3 letter code'));
      assert.ok(err.problems.includes('trip.destination is required'));
      assert.ok(err.problems.some((p) => p.startsWith('team.technicians')));
      return true;
    },
  );
});

test('validation: rejects impossible dates', () => {
  assert.throws(() => normalizeInput(baseBody({ trip: { ...baseBody().trip, departDate: '2026-02-30' } })), ValidationError);
});
