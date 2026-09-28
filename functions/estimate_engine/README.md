# estimate_engine (Catalyst Advanced I/O function)

Server side engine for the Cobotiq travel and labor estimator. It fetches live
travel prices, applies the labor rules, and returns the roll-up line item for a
Zoho Books estimate. See `docs/PLAN.md` for the overall design.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Which provider keys are configured (never the values), and current defaults |
| POST | `/estimate/calculate` | Run an estimate |

In Catalyst the full URL is `https://<project-domain>/server/estimate_engine/estimate/calculate`.

## Request body

```json
{
  "dealId": "4876876000001234567",
  "customerName": "TASKI",
  "trip": {
    "mode": "fly",
    "origin": "Richmond, VA",
    "destination": "Austin, TX",
    "destinationZip": "78701",
    "originAirport": "RIC",
    "destAirport": "AUS",
    "departDate": "2026-03-01",
    "returnDate": "2026-03-05",
    "roundTripMiles": 0
  },
  "team": { "technicians": 2, "rooms": 2 },
  "labor": {
    "serviceType": "onsite",
    "workDays": 3,
    "hoursPerDay": 8,
    "overtimeHours": 0,
    "billTravelTime": true
  },
  "include": { "airfare": true, "lodging": true, "car": true, "fuel": true, "meals": true },
  "otherExpenses": [{ "description": "Parking", "amount": 40 }],
  "overrides": { "airfarePerPerson": 480 },
  "settings": { "labor": { "hourlyRate": 150 }, "travel": { "fuelPerCarPerDay": 30 } },
  "save": true
}
```

Only `trip.departDate`, `trip.returnDate` and (unless `mode` is `none`)
`trip.destination` are always required. Flights also need both airport codes;
drive trips need `roundTripMiles`. Everything else has a default.

| Field | Notes |
|-------|-------|
| `trip.mode` | `fly` (airfare, hotel, rental car, fuel), `drive` (mileage, hotel), `none` (labor only, for example warehouse work) |
| `trip.destinationZip` | Optional. Makes the GSA per diem lookup exact. |
| `team.rooms` | Defaults to one room per technician |
| `labor.serviceType` | `onsite` (4 hour daily minimum) or `warehouse` (no minimum) |
| `labor.workDays` | Defaults to trip days minus 2 travel days (at least 1) |
| `labor.overtimeHours` | Per technician, whole trip. Rate is hourly rate x 1.5 until the OT rule is defined |
| `overrides` | `airfarePerPerson`, `lodgingPerNight`, `carTotal` (per car, whole rental), `mealsPerDay`. Skips that search and marks it manual |
| `settings` | Overrides any value in `src/config.js` for this estimate |
| `save` | `true` stores a snapshot in the `EstimateSnapshots` table |

## Response (abridged)

```json
{
  "pricedAt": "2026-02-10T12:00:00.000Z",
  "estimate": {
    "lines": [{ "key": "lodging", "label": "Hotel", "detail": "4 nights x 2 rooms @ $180/night", "amount": 1440, "source": "live", "fetchedAt": "..." }],
    "totals": { "labor": 9600, "expenses": 3493.12, "markup": 0, "contingency": 0, "total": 13093.12 },
    "allLive": true
  },
  "lineItems": [{ "name": "Travel & Labor (Field Service)", "rate": 13093.12, "quantity": 1, "description": "..." }],
  "prices": { "airfare": { "amount": 512, "detail": "Delta, 1 stop", "source": "live" } },
  "options": { "airfare": [], "lodging": [], "car": [] },
  "warnings": [],
  "snapshotId": null
}
```

`source` on each price is `live`, `stale` (live search failed; a cached price up
to 7 days old was used), `fallback` (a default was used) or `manual`. Non live
prices are flagged in the line item description, so a quote never silently
uses a guess.

## Defaults

All in `src/config.js`, all editable per estimate through `settings`:
$150/hr, 4 hour onsite minimum, 1.5x overtime placeholder, 2 travel days at 4
hours each, midsize car, 1 car per 2 techs, $30/day fuel, GSA meals with 75% on
travel days, hotel pick = median of hotels rated 3.5+, flight pick = cheapest of
Google's "best" flights.

## Setup in Catalyst

1. **Environment variables** (function settings, never in code or chat):
   `SERPAPI_KEY`, `RAPIDAPI_KEY`, optional `GSA_API_KEY` (free from
   https://api.data.gov/signup, otherwise the rate limited `DEMO_KEY` is used),
   optional `ALLOWED_ORIGINS` (comma separated, only needed for calls from
   outside the Catalyst domain).
2. **RapidAPI**: subscribe to the free plan of the `booking-com15` API.
3. **Data Store tables**:
   - `ApiCache`: `cache_key` (Var Char 100, unique), `payload` (Text), `stored_at` (Var Char 30)
   - `EstimateSnapshots`: `deal_id` (Var Char 50), `total` (Double), `payload` (Text), `created_at` (Var Char 30)
4. Copy this folder into the Catalyst project's `functions/` directory (or register it with the Catalyst CLI), then deploy with `catalyst deploy`.
5. Open `/server/estimate_engine/health` and confirm both providers show `true`.

## Development

```
npm test          # unit tests, no network
npm run smoke     # live calls, needs SERPAPI_KEY and RAPIDAPI_KEY in the shell
npm run smoke -- --raw   # also saves raw responses to scripts/raw/ (git ignored)
```

The car rental parser (`src/providers/cars.js`) is written against the
documented `booking-com15` response shape. Run `npm run smoke -- --raw` once
with real keys and compare `scripts/raw/booking-com15-searchCarRentals.json`
to the parser before relying on car prices.
