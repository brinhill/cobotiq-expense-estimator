# Cobotiq Travel and Labor Estimator: Build Plan

Status: Draft v2 (decisions from review round 1 applied)
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

## 3. What v4 does today (baseline)

| Area | v4 behavior | Plan |
|------|-------------|------|
| Airfare | Only live call (Catalyst `flight_search`, Amadeus); $450 fallback | Rebuild with a supported live provider |
| Hotel | Hardcoded $107 / $156 / $212 per night | Live, date based hotel rates |
| Car rental | Hardcoded $40 to $75 per day | Rate table (editable), live provider later if wanted |
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
        |                           Google Routes API, car rate table
        v  POST /estimate/push
Zoho Books API
  - find draft estimate linked to the Deal, or create a draft
  - add or update the roll-up line item
```

The "sandbox function" is `/estimate/push`. It runs first against a Books
sandbox org (or a test customer in production) before it is allowed to write
to real estimates.

## 5. Live data sources

| Expense | Source (proposed) | Notes |
|---------|-------------------|-------|
| Airfare | SerpApi Google Flights (recommended) or Duffel | Amadeus Self-Service is reportedly being retired; confirm before relying on it |
| Hotel | SerpApi Google Hotels (recommended) or LiteAPI | Live nightly rates for check-in and check-out dates near the job site. GSA lodging rate shown as a reference cap |
| Meals | GSA Per Diem API (free, api.data.gov key) | M&IE by city/ZIP, 75% on travel days |
| Driving | Google Maps Routes API x IRS mileage rate | Used when the site is within the drive threshold |
| Car rental | Editable rate table in Catalyst | Live source can be added later |
| Airports | Nearest airport lookup from origin and site | Removes manual IATA code entry |

Using SerpApi for both flights and hotels means one vendor, one key and one bill.

## 6. Inputs

Trip
- Deal (prefills customer, site address from the Deal/Account)
- Origin (default: technician home base), departure and return dates
- Number of technicians, rooms (default one per technician)
- Travel mode: auto (fly vs drive by distance), fly, or drive

Labor (all editable, defaults from a config table)
- Service type: `Onsite service` or `Warehouse break/fix`
- Hourly rate: default $150
- Hours per technician per day, number of work days
- Onsite: billed hours per day = max(entered hours, 4)
- Warehouse break/fix: billed hours = entered hours (no minimum)
- Open items: overtime, travel time billing (see section 10)

Adjustments
- Expense markup %, contingency %, "Other" expense rows

## 7. Calculation rules (engine)

- Nights = return date minus departure date
- Lodging = live nightly rate x nights x rooms (+ taxes/fees if the provider returns them)
- Meals = technicians x (GSA M&IE x 0.75 x 2 travel days + GSA M&IE x middle days)
- Airfare = selected fare x technicians
- Car = daily rate x rental days (shared, one car per N technicians, configurable)
- Mileage = round trip miles x IRS rate (drive mode)
- Labor = technicians x days x billed hours x rate
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

1. **Setup**: API keys (SerpApi or alternatives, GSA, Google), Books sandbox or
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

- Hotel/flight API budget: SerpApi plans start around $75/month. OK, or prefer another provider?
- Labor inside the roll-up line, or labor as its own line and travel rolled up?
- Overtime: is there an OT rate or rule, or is everything $150/hr?
- Travel time: billed? If so, at what rate?
- Does the 4 hour onsite minimum apply to travel days too?
- Technician home base: one office location, or per technician?
- Books sandbox org available, or test against a test customer in production?

## 11. Proposed repo layout

```
functions/estimate-engine/   Catalyst Advanced I/O function (API)
functions/shared/calc/       pricing and labor rules + tests
client/                      calculator UI (Catalyst web client)
docs/                        plan, setup, SOP source
```
