'use strict';

const { toCents, toDollars } = require('./util');

const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function line(key, category, label, detail, cents, price) {
  return {
    key,
    category,
    label,
    detail,
    amount: toDollars(cents),
    source: price ? price.source : 'rule',
    fetchedAt: price ? price.fetchedAt || null : null,
  };
}

function laborLines(input) {
  const { team, labor, trip, settings } = input;
  const s = settings.labor;
  const rate = toCents(s.hourlyRate);
  const techs = team.technicians;
  const lines = [];

  const minHours = labor.serviceType === 'onsite' ? s.onsiteMinHoursPerDay : s.warehouseMinHoursPerDay;
  const billedHours = Math.max(labor.hoursPerDay, minHours);
  const regularHours = techs * labor.workDays * billedHours;
  if (regularHours > 0) {
    const minNote = billedHours > labor.hoursPerDay ? ` (${minHours} hr minimum)` : '';
    lines.push(line('labor_regular', 'labor', 'Labor',
      `${n(techs, 'tech')} x ${n(labor.workDays, 'day')} x ${n(billedHours, 'hr')}${minNote} @ $${s.hourlyRate}/hr`,
      regularHours * rate));
  }

  if (labor.overtimeHours > 0) {
    const otRate = Math.round(rate * s.overtimeMultiplier);
    lines.push(line('labor_overtime', 'labor', 'Overtime',
      `${n(techs, 'tech')} x ${n(labor.overtimeHours, 'hr')} @ $${toDollars(otRate)}/hr`,
      techs * labor.overtimeHours * otRate));
  }

  if (labor.billTravelTime && trip.travelDays > 0 && s.travelHoursPerTravelDay > 0) {
    const hours = techs * trip.travelDays * s.travelHoursPerTravelDay;
    lines.push(line('labor_travel', 'labor', 'Travel time',
      `${n(techs, 'tech')} x ${n(trip.travelDays, 'travel day')} x ${n(s.travelHoursPerTravelDay, 'hr')} @ $${s.hourlyRate}/hr`,
      hours * rate));
  }
  return lines;
}

function expenseLines(input, prices) {
  const { team, trip, include, settings } = input;
  const t = settings.travel;
  const techs = team.technicians;
  const cars = Math.ceil(techs / Math.max(1, t.techsPerCar));
  const rentalDays = Math.max(trip.nights, 1);
  const lines = [];

  if (include.airfare && prices.airfare) {
    lines.push(line('airfare', 'expense', 'Airfare',
      `${n(techs, 'round trip')} ${trip.originAirport} to ${trip.destAirport}`,
      techs * toCents(prices.airfare.amount), prices.airfare));
  }

  if (include.lodging && prices.lodging && team.rooms > 0) {
    lines.push(line('lodging', 'expense', 'Hotel',
      `${n(trip.nights, 'night')} x ${n(team.rooms, 'room')} @ $${prices.lodging.amount}/night`,
      trip.nights * team.rooms * toCents(prices.lodging.amount), prices.lodging));
  }

  if (include.car && prices.car) {
    lines.push(line('car', 'expense', 'Car rental',
      `${n(cars, `${t.carClass} car`)} x ${n(rentalDays, 'day')}`,
      cars * toCents(prices.car.amount), prices.car));
  }

  if (include.fuel && t.fuelPerCarPerDay > 0) {
    lines.push(line('fuel', 'expense', 'Fuel',
      `${n(cars, 'car')} x ${n(rentalDays, 'day')} @ $${t.fuelPerCarPerDay}/day`,
      cars * rentalDays * toCents(t.fuelPerCarPerDay)));
  }

  if (include.mileage) {
    lines.push(line('mileage', 'expense', 'Mileage',
      `${n(cars, 'vehicle')} x ${trip.roundTripMiles} mi @ $${t.mileageRate}/mi`,
      cars * trip.roundTripMiles * toCents(t.mileageRate)));
  }

  if (include.meals && prices.meals) {
    // GSA: first and last travel day at 75% of M&IE, full rate in between.
    const pct = t.travelDayMealsPct;
    const dayUnits = trip.tripDays === 1 ? pct : 2 * pct + (trip.tripDays - 2);
    lines.push(line('meals', 'expense', 'Meals (per diem)',
      `${n(techs, 'tech')} x ${n(trip.tripDays, 'day')} @ $${prices.meals.amount}/day, travel days at ${pct * 100}%`,
      techs * dayUnits * toCents(prices.meals.amount), prices.meals));
  }

  input.otherExpenses.forEach((e, i) => {
    if (e.amount > 0) lines.push(line(`other_${i}`, 'expense', e.description, 'Manual entry', toCents(e.amount), { source: 'manual' }));
  });
  return lines;
}

// Pure calculation: inputs plus already fetched prices in, priced lines out.
function computeEstimate(input, prices) {
  const adj = input.settings.adjustments;
  const labor = laborLines(input);
  const expenses = expenseLines(input, prices || {});
  const sum = (ls) => ls.reduce((acc, l) => acc + toCents(l.amount), 0);

  const laborCents = sum(labor);
  const expenseCents = sum(expenses);
  const markupCents = Math.round(expenseCents * (adj.expenseMarkupPct / 100));
  const contingencyCents = Math.round((laborCents + expenseCents + markupCents) * (adj.contingencyPct / 100));
  const totalCents = laborCents + expenseCents + markupCents + contingencyCents;

  return {
    lines: [...labor, ...expenses],
    totals: {
      labor: toDollars(laborCents),
      expenses: toDollars(expenseCents),
      markup: toDollars(markupCents),
      contingency: toDollars(contingencyCents),
      total: toDollars(totalCents),
    },
    allLive: expenses.every((l) => !['fallback', 'stale'].includes(l.source)),
  };
}

module.exports = { computeEstimate };
