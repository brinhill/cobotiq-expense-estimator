'use strict';

const { formatUsd, toCents, toDollars } = require('./util');

const SOURCE_NOTE = {
  stale: 'cached, not live',
  fallback: 'estimated, not live',
  manual: 'manual',
};

function describe(lines, extras) {
  const rows = lines.map((l) => {
    const note = SOURCE_NOTE[l.source] ? ` [${SOURCE_NOTE[l.source]}]` : '';
    return `${l.label}: ${l.detail}: ${formatUsd(l.amount)}${note}`;
  });
  for (const [label, amount] of extras) if (amount > 0) rows.push(`${label}: ${formatUsd(amount)}`);
  return rows;
}

function header(input) {
  const t = input.trip;
  const techs = `${input.team.technicians} tech${input.team.technicians > 1 ? 's' : ''}`;
  const where = t.mode === 'none' ? 'no travel' : `${t.origin || t.originAirport || 'origin'} to ${t.destination}`;
  const service = input.labor.serviceType === 'onsite' ? 'Onsite service' : 'Warehouse break/fix';
  return `${service}, ${techs}, ${where}, ${t.departDate} to ${t.returnDate}`;
}

// Builds the line item(s) for the Books estimate from a computed estimate.
function buildRollup(input, estimate, pricedAt) {
  const r = input.settings.rollup;
  const { totals } = estimate;
  const footer = `Priced ${pricedAt.slice(0, 10)}${estimate.allLive ? ' (live rates)' : ' (includes non live rates)'}`;
  const markupRows = [['Expense markup', totals.markup], ['Contingency', totals.contingency]];

  if (r.mode === 'laborSeparate') {
    const labor = estimate.lines.filter((l) => l.category === 'labor');
    const expenses = estimate.lines.filter((l) => l.category === 'expense');
    const travelTotal = toDollars(toCents(totals.total) - toCents(totals.labor));
    const items = [];
    if (labor.length) {
      items.push({ name: r.laborItemName, rate: totals.labor, quantity: 1,
        description: [header(input), ...describe(labor, [])].join('\n') });
    }
    if (travelTotal > 0) {
      items.push({ name: r.itemName, rate: travelTotal, quantity: 1,
        description: [header(input), ...describe(expenses, markupRows), footer].join('\n') });
    }
    return items;
  }

  return [{
    name: r.itemName,
    rate: totals.total,
    quantity: 1,
    description: [header(input), ...describe(estimate.lines, markupRows), footer].join('\n'),
  }];
}

module.exports = { buildRollup };
