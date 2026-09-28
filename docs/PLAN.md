# Cobotiq Travel and Labor Estimator: Build Plan

Status: v6. Phase 2 (engine) built; see `functions/estimate_engine/README.md`
Reference: `expense-calculator-v4` (Catalyst Slate page, single `index.html`)

## 1. Goal

Give sales and service staff a calculator, launched from a Zoho CRM Deal, that
combines live travel pricing with a few labor inputs and adds the result as a
roll-up line item to a Zoho Books estimate (via the Zoho Finance integration).
Embedding the calculator inside the Deal record UI is out of scope for now.

## 2. Decisions so far

| # | Topic | Decision |
|---|-------|----------|
| 1 | Primary system | Books estimates (Zoho Finance in CRM). Launched from CRM Deals. Output does not need to embed in the record yet; a sandbox function adds the line item to the estimate. |
| 2 | Catalyst `flight_search` | Rebuild from scratch. |
| 3 | Labor | Editable. Default $150/hr. Onsite service: 4 hour minimum per technician per day. Warehouse break/fix: no minimum. |
| 4 | Presentation | Roll-up line item on the estimate (breakdown kept in the description and snapshot). |
| 5 | Hotel pricing | Live, based on the trip dates. |
| 6 | Commit author | `Cobotiq <noreply@cobotiq.com>` |
| 7 | Overtime | Needed but not defined yet. Build an OT hours field and an editable OT rate (placeholder 1.5x), default 0 OT hours. |
| 8 | Travel time | TBD. Interim rule: each travel day is billed at the 4 hour minimum at the labor rate. Editable. |
| 9 | Technician origin | Technician is often unknown at estimate time. Origin is an editable field with a company default; picking a technician fills their home base, which can still be overridden. |
| 10 | API cost | Start on the SerpApi free plan (all in one, one key). Expected volume is 20 to 50 estimates per month. Later, go through the key process for cheaper or more capable providers (Duffel, LiteAPI) via the adapter layer. |
| 11 | Car rental | Live, market based prices from any vendor (National requirement dropped). Prices surge by market and date, so a static table is not acceptable. |
| 12 | Car defaults | Midsize class by default. Fuel estimated at $30 per car per day, editable. |
| 13 | Providers | SerpApi (flights, hotels) and RapidAPI `booking-com15` (cars) accounts created. |

## 3. What v4 does today (baseline)

| Area | v4 behavior | Plan |
|------|-------------|------|
| Airfare | Only live call (Catalyst `flight_search`, Amadeus); $450 fallback. Amadeus Self-Service shut down July 17, 2026, so this no longer returns live data | Rebuild with a supported live provider |
| Hotel | Hardcoded $107 / $156 / $212 per night | Live, date based hotel rates |
| Car rental | Hardcoded $40 to $75 per day | Live multi vendor rates for the pickup airport and dates |
| Meals | Flat $68/day | GSA M&IE by location, 75% first and last day |
| Labor | Hours x rate, typed manually | Service type rules, minimums, editable defaults |
| Save / Report / CSV | Placeholder alerts | Add to Books estimate, PDF/CSV summary |
| Math | Browser only | Server side in Catalyst (authoritative) |

## 4. Architecture

```
Zoho CRM Deal
  [Estimate Travel & Labor] button
        |
        v  opens with deal_id
Catalyst web client (calculator UI)
        |
        v  POST /estimate/calculate
Catalyst "Estimate Engine" (Node, Advanced I/O)
  - pricing and labor rules (shared, unit tested module)
  - API keys held server side (environment variables)
  - response cache (Data Store, short TTL)
  - estimate snapshots (Data Store)
        |                      |
        |                      +--> Flights API, Hotels API, GSA Per Diem API,
        |                           Google Routes API, Car rental API
        v  POST /estimate/push
Zoho Books API
  - find draft estimate linked to the Deal, or create a draft
  - add or update the roll-up line item
```

The "sandbox function" is `/estimate/push`. It runs first against a Books
sandbox org (or a test customer in production) before it is allowed to write
to real estimates.

## 5. Live data sources

Amadeus Self-Service APIs were shut down on July 17, 2026. The replacements
below are free or close to free at Cobotiq's expected volume. Each provider
sits behind an adapter in the engine so it can be swapped without touching
the calculator.

| Expense | Recommended start | Free / low cost alternative | Notes |
|---------|-------------------|-----------------------------|-------|
| Airfare | SerpApi Google Flights (free plan, 250 searches/month shared) | Duffel (search is free up to 1500 searches per booking, then about $0.005 per search) | Duffel is booking oriented; confirm estimate only use fits their terms |
| Hotel | SerpApi Google Hotels (same free plan) | LiteAPI (rate search endpoints free; sandbox key available) | Live nightly rates for the trip dates; GSA lodging shown as a reference cap |
| Meals | GSA Per Diem API (free, api.data.gov key) | none needed | M&IE by city/ZIP, 75% on travel days |
| Driving | Google Maps Routes API x IRS mileage rate | Google free monthly allowance | Used when the site is within the drive threshold |
| Car rental | Booking.com data via RapidAPI (`booking-com15`, free tier) | Avis Budget developer API (official, free sandbox; Avis, Budget, Payless only) | See 5.1 |
| Airports | Static airport dataset (OurAirports, free) | none needed | Nearest airport to origin and site |

Budget math for the free plan: one estimate uses about 2 live searches
(1 flight, 1 hotel). With a 24 hour cache that is roughly 100 or more
estimates per month on the SerpApi free plan. If the quota runs out, the
engine falls back to GSA lodging and a flagged airfare estimate instead of
failing, and the estimate is marked "not live". Upgrading (SerpApi paid, or
switching to Duffel/LiteAPI) only becomes necessary if volume grows.

### 5.1 Car rental: live market rates

SerpApi does not cover car rentals, so cars use a second provider behind the
same adapter layer.

| Option | Coverage | Cost / access | Fit |
|--------|----------|---------------|-----|
| RapidAPI `booking-com15` (Booking.com data) | Many vendors, live, by pickup location and dates | Free tier (about 500 requests/month reported; confirm on signup) | **Start here** |
| Avis Budget developer API | Avis, Budget, Payless only | Free sandbox; production needs Avis approval | Official, but not the whole market |
| Booking.com Demand API / Expedia Rapid Cars | Whole market, official | Partner/affiliate approval | Long term option if we go through the key process |

Notes:
- `booking-com15` is a third party wrapper, not an official Booking.com API.
  It can change or break, so the adapter must fail gracefully.
- Rule: search at the destination airport for the trip dates, take the
  cheapest car in the chosen class (default Midsize), include taxes and fees
  when the provider returns them.
- One car per N technicians (default 2 to 3, editable).
- Fallback when the feed fails or the quota runs out: last cached price for
  that market within 7 days, otherwise an editable default rate. The estimate
  is flagged "car price not live".
- Fuel: optional estimate from route miles, or a flat allowance.

## 6. Inputs

Trip
- Deal (prefills customer, site address from the Deal/Account)
- Origin: company default base, or a picked technician's home base; always editable
- Technician (optional; often unassigned at estimate time)
- Departure and return dates
- Number of technicians, rooms (default one per technician)
- Travel mode: auto (fly vs drive by distance), fly, or drive

Labor (all editable, defaults from a config table)
- Service type: `Onsite service` or `Warehouse break/fix`
- Hourly rate: default $150
- Hours per technician per day, number of work days
- Onsite: billed hours per day = max(entered hours, 4)
- Warehouse break/fix: billed hours = entered hours (no minimum)
- Overtime: OT hours (default 0) x editable OT rate (placeholder 1.5x), rules TBD
- Travel days (interim): billed at the 4 hour minimum x rate per technician, editable

Adjustments
- Expense markup %, contingency %, "Other" expense rows

## 7. Calculation rules (engine)

- Nights = return date minus departure date
- Lodging = live nightly rate x nights x rooms (+ taxes/fees if the provider returns them)
- Meals = technicians x (GSA M&IE x 0.75 x 2 travel days + GSA M&IE x middle days)
- Airfare = selected fare x technicians
- Car = daily rate x rental days (shared, one car per N technicians, configurable)
- Mileage = round trip miles x IRS rate (drive mode)
- Labor = technicians x work days x billed hours x rate
- Overtime = technicians x OT hours x OT rate
- Travel time (interim) = technicians x travel days x 4 hours x rate
- Totals rounded to cents; every figure stores its source and fetch time

## 8. Output to Books

Roll-up line item on the estimate, for example:

```
Item:        Travel & Labor (Field Service)
Rate:        <grand total>
Description: 2 techs, Richmond VA to Austin TX, Mar 1 to Mar 5 2026
             Labor 32 hrs @ $150 ........ $4,800.00
             Airfare (2) ................ $1,084.20
             Hotel 4 nights x 2 rooms ...   $998.40
             Meals (GSA) ................   $552.50
             Car rental .................   $248.00
             Priced 2026-02-10 (live rates)
```

- Uses a dedicated Books Item so reporting can separate it.
- If a draft estimate is already linked to the Deal, the line is added or
  replaced (matched by item); otherwise a new draft estimate is created for the
  Deal's customer.
- The full breakdown is saved as a snapshot so the quote can be explained later.

## 9. Phases

1. **Setup**: API keys (SerpApi free plan, RapidAPI free plan, GSA, Google), Books sandbox or
   test customer, Books Item for the roll-up, Catalyst project confirmed.
2. **Engine**: calculation module + unit tests, flights, hotels, GSA, mileage,
   caching, snapshots.
3. **Calculator UI (v5)**: rebuild of v4 on the engine, service type and labor
   rules, prefilled from a Deal id.
4. **Sandbox push**: `/estimate/push` to Books sandbox, then production.
5. **CRM launch point**: Deal custom button that opens the calculator.
6. **Docs and rollout**: SOP via the Cobotiq SOP workflow, staff walkthrough.
7. **Later**: native embed in the Deal/estimate record, Zoho FSM estimates.

## 10. Open questions

- Labor inside the roll-up line, or labor as its own line and travel rolled up?
- Overtime rule and rate (placeholder until defined).
- Travel time rule (interim: 4 hour minimum per travel day, $600 per tech per day at $150/hr).
- Company default origin (office address or city).
- Books sandbox org available, or test against a test customer in production?
- Default car class (proposed: Midsize) and whether fuel is estimated or left out.

## 11. Repo layout

```
functions/estimate_engine/          Catalyst Advanced I/O function (phase 2, built)
  index.js                          HTTP entry: /health, /estimate/calculate
  src/calc/                         pure rules: validation, labor, expenses, roll-up
  src/providers/                    SerpApi flights and hotels, RapidAPI cars, GSA
  src/pricing.js                    cache, stale and fallback handling
  src/store/                        Catalyst Data Store and in-memory stores
  test/                             unit tests with provider fixtures (npm test)
  scripts/smoke.js                  live check with real keys (npm run smoke)
client/                             calculator UI (phase 3)
docs/                               plan, SOP source
```

The shared calculation code lives inside the function folder, because each
Catalyst function deploys as its own package.
