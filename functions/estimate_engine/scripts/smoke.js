'use strict';

// Live smoke test. Makes real API calls (about 4 searches of quota).
//
//   SERPAPI_KEY=... RAPIDAPI_KEY=... npm run smoke
//   SERPAPI_KEY=... RAPIDAPI_KEY=... npm run smoke -- --raw
//
// --raw also saves every raw provider response to scripts/raw/ so parsers can
// be checked against what the providers actually return. The folder is git
// ignored because responses can echo the API key in their metadata.

const fs = require('fs');
const path = require('path');
const { runEstimate } = require('../src/engine');
const { createMemoryStore } = require('../src/store/memory');
const { keys } = require('../src/config');
const { addDays } = require('../src/calc/util');

const saveRaw = process.argv.includes('--raw');
const rawDir = path.join(__dirname, 'raw');

async function recordingFetch(url, init) {
  const res = await fetch(url, init);
  if (!saveRaw) return res;
  const text = await res.clone().text();
  const host = new URL(url).host.split('.')[0];
  const step = new URL(url).searchParams.get('engine') || new URL(url).pathname.split('/').pop();
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, `${host}-${step}.json`), text);
  return res;
}

async function main() {
  const k = keys();
  console.log(`Keys: serpapi=${Boolean(k.serpapi)} rapidapi=${Boolean(k.rapidapi)} gsa=${k.gsa === 'DEMO_KEY' ? 'DEMO_KEY' : 'set'}`);

  // A trip three weeks out so every provider has inventory.
  const depart = addDays(new Date().toISOString().slice(0, 10), 21);
  const body = {
    trip: {
      mode: 'fly',
      origin: 'Richmond, VA',
      destination: 'Austin, TX',
      originAirport: 'RIC',
      destAirport: 'AUS',
      departDate: depart,
      returnDate: addDays(depart, 4),
    },
    team: { technicians: 2 },
    labor: { serviceType: 'onsite', hoursPerDay: 8 },
  };

  const r = await runEstimate(body, { store: createMemoryStore(), keys: k, fetchImpl: recordingFetch });
  for (const [name, p] of Object.entries(r.prices)) {
    if (p) console.log(`${name.padEnd(8)} ${p.source.padEnd(8)} $${p.amount}  ${p.detail}`);
  }
  if (r.warnings.length) console.log(`\nWarnings:\n  ${r.warnings.join('\n  ')}`);
  console.log(`\n${r.lineItems[0].name}: $${r.lineItems[0].rate}\n${r.lineItems[0].description}`);
  if (saveRaw) console.log(`\nRaw responses saved to ${rawDir}`);
  process.exitCode = r.warnings.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
