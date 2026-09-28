'use strict';

// Business defaults. Every value can be overridden per estimate through the
// `settings` object in the request, so these are starting points, not rules.
const DEFAULTS = Object.freeze({
  labor: {
    hourlyRate: 150,
    // Onsite service bills at least this many hours per technician per work day.
    onsiteMinHoursPerDay: 4,
    // Warehouse break/fix has no minimum.
    warehouseMinHoursPerDay: 0,
    // Overtime rule is not defined yet; placeholder multiplier on the hourly rate.
    overtimeMultiplier: 1.5,
    // Interim travel time rule: each travel day is billed at the onsite minimum.
    travelHoursPerTravelDay: 4,
    travelDays: 2,
  },
  travel: {
    techsPerCar: 2,
    fuelPerCarPerDay: 30,
    carClass: 'midsize',
    // IRS business mileage rate (USD per mile). Update every January.
    mileageRate: 0.70,
    // Used when a live search fails and nothing usable is cached.
    fallbackAirfarePerPerson: 450,
    fallbackCarPerDay: 65,
    // GSA CONUS standard rates, used when the GSA lookup fails.
    fallbackLodgingPerNight: 110,
    fallbackMealsPerDay: 68,
    // GSA rule: first and last travel day get 75% of M&IE.
    travelDayMealsPct: 0.75,
    // Hotel picks ignore properties rated below this.
    minHotelRating: 3.5,
  },
  adjustments: {
    expenseMarkupPct: 0,
    contingencyPct: 0,
  },
  rollup: {
    // 'single': one line for everything. 'laborSeparate': labor on its own line.
    mode: 'single',
    itemName: 'Travel & Labor (Field Service)',
    laborItemName: 'Field Service Labor',
  },
  cache: {
    freshHours: 24,
    // On a failed live search, a cached price up to this old is used and flagged.
    staleDays: 7,
  },
});

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function keys() {
  return {
    serpapi: env('SERPAPI_KEY', null),
    rapidapi: env('RAPIDAPI_KEY', null),
    // api.data.gov accepts DEMO_KEY with a low hourly limit.
    gsa: env('GSA_API_KEY', 'DEMO_KEY'),
  };
}

module.exports = { DEFAULTS, keys };
