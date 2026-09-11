# Future Scotty

A calm personal financial cockpit for one person, built on the [Up](https://up.com.au) API.

It is not a budgeting app. It exists to answer five questions:

1. Am I financially okay?
2. How much can I safely spend before payday?
3. Am I following the financial system I designed?
4. Can I afford the thing I am considering?
5. Am I quietly taking money from my future goals to fund current spending?

**This application never moves money and never makes payments.** It reads your
banking data, works out what your own plan says should be happening, and shows
you the difference. Up's own Pay Splitting does the transfers. The Up personal
access token grants write access to tags and categories, and this app touches
neither unless you explicitly turn that on in Settings.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Getting an Up token](#getting-an-up-token)
- [Setting up the webhook](#setting-up-the-webhook)
- [Connecting Notion](#connecting-notion)
- [Mock mode](#mock-mode)
- [Architecture](#architecture)
- [The financial system](#the-financial-system)
- [Database](#database)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security and privacy](#security-and-privacy)
- [Known limits](#known-limits)

---

## What it does

**Today.** One insight, then safe-to-spend, then Emergency and Future Options
progress, Travel and Gear balances, what has been invested this cycle, and how
long until payday. The insight is chosen from scored candidates and only ever
one is shown, because if everything can be surfaced then nothing is.

**Pay cycle.** Everything runs on your fortnight, not on calendar months. Cycle
boundaries are derived from observed salary transactions, so a payday that
moves around a public holiday is handled without configuration. Each category
shows allocated, spent, remaining, percentage used against percentage of the
cycle elapsed, and a status. Below it, the payday audit: what the plan says
should have moved into each Saver against what actually did.

**Goals.** Emergency and Future Options against their targets, Travel and Gear
balances and contributions, investing contributions this month and year, and
manual snapshots for things Up cannot see such as super and a brokerage
account. The app does not pretend to know market values.

**Shopping.** Your Notion wishlist, read-only, with a deterministic BUY / WAIT /
NOT FUNDED / NEEDS INFORMATION verdict on each item and the full list of checks
behind it.

**Review.** Weekly, monthly and six-month modes. The weekly one is built to be
read in about thirty seconds: spent, saved, invested, a handful of category
statuses, and one thing worth noticing.

**Transactions.** Filter by pay cycle, date, account, category, tag, merchant,
amount, leakage, recurring, or needs-review. Reassign a transaction's bucket by
hand and the change survives every future sync.

**Settings.** Every financial assumption the app makes. None of it is in the
source code.

### Saver leakage detection

The feature this was really built for. Up marks internal transfers with a
`transferAccount` relationship, so the app can see money leaving a Saver that
exists for one purpose, and correlate it with spending shortly afterwards:

```
11:04   $300 moved Travel → Spending
11:16   $285 at MAAP

POSSIBLE SAVER LEAKAGE  (confidence 86)
"$300 was moved from Travel shortly before a $285 Gear purchase."
```

Purpose-matched spending is never flagged: money out of Travel spent on a
flight is the system working. Emergency and Future Options are surfaced on any
movement out, because the movement itself is the thing worth seeing. Each
finding can be marked Expected, Legitimate exception, Not related, or Yes this
was leakage, and a finding you have ruled on is never raised again.

The wording is deliberately flat. Nothing here calls anything bad.

---

## Quick start

Requires Node 20.11+ and Docker (or a Postgres you already have).

```bash
git clone <this repo> && cd financechecker
npm install

# 1. Environment
cp .env.example .env
npm run gen-secret                          # paste into AUTH_SECRET
npm run hash-password -- "a long password"  # paste into APP_PASSWORD_HASH

# 2. Database
docker compose up -d db
npx prisma migrate deploy

# 3. Six months of believable mock data — no bank token needed
npm run db:seed

# 4. Go
npm run dev
```

Open http://localhost:3000 and sign in with the password you hashed.

`USE_MOCK_DATA` defaults to `true`, so none of this touches a real bank.

---

## Environment variables

Every value is read on the **server only**. Nothing is prefixed
`NEXT_PUBLIC_`, so nothing here can reach the browser bundle.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. |
| `USE_MOCK_DATA` | no | `true` uses the built-in mock bank. Default `true`. |
| `AUTH_SECRET` | yes | 32+ random bytes signing the session cookie. `npm run gen-secret`. |
| `APP_PASSWORD_HASH` | yes | scrypt hash of your login password. `npm run hash-password`. |
| `UP_API_TOKEN` | for real data | Up personal access token. Starts `up:yeah:`. |
| `UP_WEBHOOK_SECRET` | for webhooks | The `secretKey` Up returns once when you create a webhook. |
| `NOTION_TOKEN` | optional | Notion internal integration token. |
| `NOTION_PAGE_ID` | optional | The wishlist page id. |
| `APP_URL` | optional | Public URL, used to show you the webhook address. |

`.env` is gitignored, excluded from Docker images, and `.env.example` contains
placeholders only.

---

## Getting an Up token

1. Go to [api.up.com.au/getting_started](https://api.up.com.au/getting_started)
   and sign in with your Up account.
2. Generate a personal access token. It begins `up:yeah:`.
3. Put it in `UP_API_TOKEN` in `.env` and set `USE_MOCK_DATA=false`.
4. Restart, then open **Setup**. Step 1 calls `GET /util/ping` and tells you
   whether the token works.

The token is read on the server, is never returned by any endpoint, is never
written to the database, and every error path passes through a redaction
function that strips anything matching `up:yeah:…` before it can reach a log or
a screen.

Revoke a token at the same page if it is ever exposed.

---

## Setting up the webhook

Webhooks give you live updates instead of waiting for a manual sync. They need
a publicly reachable URL, so this is a deploy-time step.

Create the webhook against the Up API:

```bash
curl -X POST https://api.up.com.au/api/v1/webhooks \
  -H "Authorization: Bearer $UP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"attributes":{"url":"https://your-app.example.com/api/webhooks/up"}}}'
```

The response contains `secretKey` **once and only once**. Copy it into
`UP_WEBHOOK_SECRET` and redeploy. If you lose it, delete the webhook and create
a new one; there is no way to retrieve it.

Test it with `POST /webhooks/{id}/ping`, or from the Up API directly.

### How the signature is verified

Up signs every delivery with an `X-Up-Authenticity-Signature` header: the
SHA-256 HMAC of the raw request body, keyed on the webhook's `secretKey`. Four
things matter, and each is easy to get wrong:

1. **The raw body.** The route reads `await request.text()` and verifies before
   parsing. Parsing the JSON and re-serialising it changes whitespace and key
   order, and the signature will not match. There is a test asserting exactly
   this failure mode.
2. **Constant-time comparison.** `timingSafeEqual`, not `===`. A string compare
   leaks timing information that can be used to forge a signature byte by byte.
3. **The algorithm is pinned.** SHA-256, hard-coded, never read from the
   request. An attacker who picks the algorithm picks a weak one.
4. **Fail closed.** With no `UP_WEBHOOK_SECRET` set, every event is rejected
   with 401. An unverifiable event is never trusted.

All four Up event types are handled:

| Event | What happens |
| --- | --- |
| `PING` | Acknowledged. |
| `TRANSACTION_CREATED` | Fetch and store the transaction. |
| `TRANSACTION_SETTLED` | Fetch and update the **same row**. Up keeps the transaction id across the transition, so a settled hold updates in place rather than arriving as a second purchase. |
| `TRANSACTION_DELETED` | Soft delete. Up no longer holds the record, so the link would 404, but history stays explainable. |

Delivery is idempotent. Up retries on any non-200 response and the event id is
constant across retries, so the id is recorded and a repeat is a no-op. The
endpoint records the event, returns 200 immediately, and processes afterwards,
because Up times out at 30 seconds and advises against heavy work before
responding.

---

## Connecting Notion

Notion stays the canonical wishlist. This app only ever reads from it.

1. Create an internal integration at
   [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Copy the token into `NOTION_TOKEN`.
3. Open your wishlist page, and under the `…` menu choose **Connections → Add
   connections** and pick the integration. Without this the API returns 404
   even with a valid token.
4. Copy the 32-character id from the page URL into `NOTION_PAGE_ID`. Dashes
   optional.
5. Press **Sync Notion** on the Shopping screen.

The reader looks for a heading matching *On the horizon* or *active purchase
considerations*, then parses tables, bulleted lists, to-dos and child databases
underneath it. It also picks up an *Open system reviews* section if there is
one. If no matching heading is found it falls back to reading every table on
the page.

Parsing is deliberately forgiving because the page is written for a person.
"$129ish", "TBC", "already ordered" and "decision TBC" are all handled. An item
whose price cannot be read is imported anyway and returns NEEDS INFORMATION
rather than a wrong answer.

Matching is by Notion block id, so syncing repeatedly is idempotent. An item's
`addedAt` is set once and never moved by a later sync, because the waiting
period counts from when it entered consideration and a re-sync must not restart
that clock.

If Notion is not configured, the Shopping screen uses a local list and behaves
identically.

---

## Mock mode

`USE_MOCK_DATA=true` swaps the Up client for a mock bank that emits **genuine
Up-shaped resources**. They go through exactly the same normalisation, pay
cycle and detection code as real data, so the mock is a real development
environment rather than a set of fixtures that drift.

Everything is generated from a fixed seed. `npm run db:seed` gives you six
months containing:

- thirteen accounts, with Saver names that deliberately do **not** match the
  role names ("Rainy Day" is Emergency, "Optionality" is Future Options) so the
  mapping step is exercised rather than guessed
- fortnightly salary, a rent payment and a full pay split every payday
- one payday where the Gear split was skipped, so the audit has something to say
- eight recurring charges at weekly, fortnightly, monthly and quarterly
  intervals, one of them recent enough to surface as a possible new cost
- a `$300` Travel → Spending transfer followed twelve minutes later by a `$285`
  purchase, which is the leakage case
- a HELD transaction, so the settle path has something to settle
- an Emergency balance of `$11,455`, just short of the `$12,000` target

That last one is the interesting bit. Press **Simulate a payday** on the Pay
Cycle screen and Emergency crosses to `$12,063.06`, the milestone fires, and the
plan moves to Phase 2 — Travel `$364.84`, Investing `$516.85`, Future Options
`$364.84`, Gear `$152.02`. No money moves anywhere, because there is no money.

No real account identifiers, BSBs, card numbers or merchant references appear
anywhere in the fixtures. Mock account ids begin `mock-`, which is not a shape
Up ever issues.

---

## Architecture

```
src/
  lib/
    money.ts              integer cents, largest-remainder allocation
    time.ts               Australia/Sydney boundaries, RFC-3339 for Up filters
    env.ts                the only place secrets are read
    auth/                 scrypt password, HMAC-signed session cookie
    domain/               PURE FUNCTIONS. No database, no framework, no I/O.
      roles.ts            stable bucket identities
      phases.ts           Phase 1 / Phase 2 percentages and the transition
      payCycle.ts         salary detection, cycle boundaries
      allocation.ts       payday split and audit
      safeToSpend.ts      the explainable calculation
      status.ts           on track / running hot / near limit / spent
      leakage.ts          transfer-to-spend correlation
      recurring.ts        subscription detection
      buyIt.ts            the purchase decision engine
      merchantRules.ts    rule matching and role resolution
    up/                   typed client, mock bank, gateway, normalisation
    notion/               read-only client and a forgiving parser
    services/             everything that touches the database
  app/                    Next.js App Router screens and the webhook route
  components/             interface primitives
```

The rule that keeps this maintainable: **`domain/` never imports anything from
`services/`, `app/`, or Prisma's runtime.** Every financial rule is a pure
function of its inputs, which is why all of them can be tested without a
database and why the tests run in three seconds.

No React component performs a calculation. Screens read from `services/`, which
assemble inputs and call `domain/`.

**Stack.** Next.js 15 (App Router), TypeScript in strict mode with
`noUncheckedIndexedAccess`, Tailwind CSS, Prisma, PostgreSQL, Zod, date-fns
with `@date-fns/tz`, Vitest.

### Money

Every amount is an integer number of cents, everywhere, with no exceptions.
`0.1 + 0.2 !== 0.3` is not a rounding quirk to work around, it is a reason not
to represent money as a float in the first place.

Percentages are stored as **basis points** (1% = 100bp), so "must add to exactly
100%" is an exact integer comparison against 10000 rather than a float
tolerance.

A pay split uses the largest remainder method: floor everything, then hand the
leftover cents out one at a time to the parts with the largest fractional
remainder, breaking ties deterministically. The parts sum to exactly the
allocatable amount. No cent is lost, and no cent is invented.

### Safe to spend

The number this app refuses to show is your bank balance, because most of a
balance is already promised before you touch it.

```
  Dining & Social      remaining
+ Fun                  remaining
+ Gear & Objects       remaining
+ Buffer               remaining
− essential shortfalls          (groceries past its allocation still has to be paid)
− commitments before payday     (only the part their own bucket cannot cover)
= capped at the unprotected balance
= floored at zero
```

Emergency and Future Options never appear. Travel never appears, because Travel
is for travel. Rent and Bills are reserved. The daily figure is labelled a
*pace*, not an allowance.

Every step is returned as a labelled line with a plain-English explanation, and
the screen shows the whole working behind **How was this calculated?**

### Explainability

Every calculated conclusion carries its reasoning. Why is Dining running hot?
Why is safe-to-spend $184? Why was this flagged as leakage? Why is this WAIT
rather than BUY? Each is a `<details>` disclosure, so the explanations work
with JavaScript disabled and are announced correctly by screen readers.

There are no scores and no models. The Buy It engine in particular is
deterministic: the same inputs always produce the same verdict, and every check
is returned alongside it.

---

## The financial system

Seeded on first run, **all of it editable in Settings**. Nothing below is
referenced by name anywhere in the calculation code.

Rent comes off the top of every pay. Percentages apply to what is left.

| Bucket | Phase 1 | Phase 2 |
| --- | ---: | ---: |
| Bills | 12% | 12% |
| Health & Therapy | 11% | 11% |
| Groceries | 11% | 11% |
| Dining & Social | 8% | 8% |
| Fun | 5% | 5% |
| Transport | 4% | 4% |
| Travel | 10% | **12%** |
| Gear & Objects | 5% | 5% |
| Emergency | 20% | **0%** |
| Investing | 8% | **17%** |
| Future Options | 3% | **12%** |
| Buffer | 3% | 3% |
| | **100%** | **100%** |

Phase 1 runs until Emergency reaches its target. Phase 2 begins the moment it
does, and the app raises a calm notice rather than doing anything.

If the Emergency balance later dips below the floor, the plan **stays in Phase
2** and raises a notice. Reverting to Phase 1 would silently stop your
investing to rebuild a fund you have already built. A dip below the floor is a
thing to look at, not a thing to accommodate.

### Rules the engine enforces

- **Emergency** is defensive. Not for overspending, gear, travel or routine
  bills. Once reached, it is a floor.
- **Future Options** is for career change, study, relocation, a break. Not
  ordinary shopping.
- **Travel** is for travel, and does not fund gear or everyday life.
- **Gear & Objects** gets its 5% and never borrows from Travel, Emergency,
  Future Options or Investing. If it does not hold enough, the answer is *not
  yet*.

### Purchase waiting periods

| Price | Wait |
| --- | --- |
| Under $50 | none, if the correct Saver covers it |
| $50 – $200 | 72 hours |
| $200 – $500 | 14 days |
| Over $500 | 30 days |

A sale never shortens a waiting period. The correct Saver must cover 100% of
the cost. If a higher-priority item is affordable today and would stop being
affordable after this purchase, the answer is WAIT — but an item that was
already out of reach is not a blocker, because that would freeze the whole list
behind one expensive thing.

---

## Database

Prisma against PostgreSQL.

```bash
npx prisma migrate dev --name your_change   # create and apply a migration
npx prisma migrate deploy                   # apply in production
npx prisma studio                           # browse the data
npm run db:seed                             # seed defaults and sync
```

Up transaction and account ids are the primary keys, which is what makes
synchronisation idempotent: a re-sync, or a duplicate webhook delivery, upserts
the same row.

The stored projection is deliberately narrow. Attachments, performing-customer
records, note bodies, foreign-exchange breakdowns and the raw payloads
themselves are all discarded. `rawText` and the card's last four digits are
kept because merchant rules need the former and identifying which card was used
needs the latter; Up treats both as non-sensitive and neither identifies an
account.

A transaction's `role`, `roleSource`, `payCycleId`, `isSalary` and `needsReview`
are the app's own decisions and are never overwritten by a sync. A category you
corrected by hand survives everything.

---

## Testing

```bash
npm test           # 159 tests, about three seconds
npm run test:watch
npm run typecheck
```

The financial logic is pure, so it is tested directly with no database and no
mocking framework. Covered:

- Phase 1 and Phase 2 allocation totals, exactly 100% in basis points
- the phase transition at $12,000, including that it does not revert
- payday detection: employer rules, minimums, internal transfers excluded
- cycle boundaries: split deposits merged, moved paydays, overdue pay
- safe-to-spend, including protected exclusion, essential shortfalls,
  commitments, the balance cap and the zero floor
- leakage correlation, and that travel spending from Travel is **not** flagged
- purchase waiting periods and their tier boundaries
- the correct Saver funding 100%, and protected money never offered
- the higher-priority rule, including that it does not deadlock
- recurring detection, and that salary and internal transfers are excluded
- webhook HMAC verification: tampering, wrong secret, malformed signatures,
  missing secret, and the raw-body requirement
- HELD → SETTLED updating in place without duplication

Two tests exist purely to hold the tone: one asserts the leakage wording
contains no scolding language, another that a status explanation never calls
anything overspent or bad.

---

## Deployment

The app must not be publicly readable. It holds banking data, sends
`X-Robots-Tag: noindex`, and every route except the login page, the webhook and
the health check requires a session.

### Railway

1. New project → deploy from this repo.
2. Add a PostgreSQL plugin. `DATABASE_URL` is provided automatically.
3. Set `AUTH_SECRET`, `APP_PASSWORD_HASH`, `UP_API_TOKEN`, `USE_MOCK_DATA=false`
   and `APP_URL`.
4. `railway.json` already sets the start command to run migrations first and
   points the health check at `/api/health`.
5. Create the webhook against your deployed URL and set `UP_WEBHOOK_SECRET`.

### Vercel plus managed Postgres

Works with Neon, Supabase or Vercel Postgres. Set the same variables, and run
`npx prisma migrate deploy` as a build step or from your machine against the
production URL.

### Docker

```bash
docker compose up          # app on http://localhost:3000
```

The image runs as a non-root user, contains no secrets, and reads everything
from the environment at run time. Both the app and the database bind to
`127.0.0.1` only.

---

## Security and privacy

**The Up token.**

- Server-side only, read in exactly one module
- never prefixed `NEXT_PUBLIC_`, so it cannot be inlined into a client bundle
- never sent to the browser, never stored in a database row, never in a log
- every error path passes through a redaction function that strips
  `up:yeah:…` and `Bearer …` before the message can reach a log or a screen
- gitignored, excluded from Docker images, and `.env.example` holds only
  placeholders

**Authentication.** One password, no user table. scrypt (N=65536, r=8, p=1) from
Node's own crypto, with parameters stored in the hash string so raising the cost
factor later does not invalidate existing hashes. The session is a cookie signed
with HMAC-SHA256, `httpOnly`, `sameSite=lax`, `secure` in production, verified
with `timingSafeEqual`.

Middleware checks only that a cookie is *present*, because it runs on the Edge
runtime where `node:crypto` does not exist. Every page and every server action
verifies the signature properly on the server. A forged cookie gets past the
doorman and is stopped at the desk.

**What is not stored.** Raw API payloads, attachments, customer records, full
card numbers, and your Up token. Balances and transactions are stored as a
normalised projection of only the fields something actually uses.

**Writes to Up.** Tagging defaults to dry run and shows you suggestions without
changing anything. Categories are never altered without an explicit opt-in. The
app has no code path that moves money, because the Up API has no such endpoint —
and if it ever gains one, this app still will not.

---

## Known limits

Stated plainly rather than buried.

- **Single user by design.** No user table, no roles, no sharing. Do not deploy
  this for anyone else.
- **Investment values are manual.** Up does not know your super or brokerage
  balances, so neither does this. Snapshots are for trend, not accuracy.
- **Leakage detection is correlation, not proof.** It matches on timing and
  amount. It will occasionally be wrong, which is why every finding can be
  marked as unrelated and why the wording never accuses.
- **Recurring detection needs three occurrences.** A quarterly bill takes nine
  months of history before it is recognised. This is deliberate: two charges a
  month apart is a coincidence.
- **Notion parsing is best effort.** It reads prose written for a person. It
  will occasionally misread a row, and every field it imports is editable.
- **The pay cycle needs a detectable salary.** No salary rule means no cycles,
  and most of the app stands on cycles. Setup step 3 exists for this reason.
- **Learning from leakage verdicts is not implemented.** Verdicts are recorded
  and respected — a finding you have ruled on is never raised again — but they
  do not yet adjust the detector's thresholds. The verdicts are stored on
  `LeakageEvent` and the settings are already per-install, so this is a
  documented extension point rather than a redesign.
- **Auto-tagging to Up is wired but off.** `UpClient.addTags` and `setCategory`
  exist and are tested against the spec, and Settings offers the mode. Leaving
  it in dry run is the right default for something that writes to your bank.

---

Built against the official
[Up OpenAPI specification](https://github.com/up-banking/api). No endpoint in
this codebase was invented.


## Career-break planning and health trends

**Career-break planning** (`/plan?view=career-break`) connects the current Future Options balance to a saved
career-break scenario: start date, monthly costs, duration, contributions,
one-off costs and return-to-work buffer. The projection counts calendar paydays
before the break and stops contributions when it starts. It shows the funding
gap, required contribution, earliest funded start (within 20 years), and monthly
fund balances. Emergency and other balances are excluded.

The initial living-cost estimate uses the existing trailing three-month
normal-life spending average; incomplete history is flagged. Review this estimate
for your intended break. Contributions and costs remain constant in the scenario;
interest, investment returns, inflation and tax changes are not modelled. Saving
assumptions never changes bank allocations. One personal scenario is stored in
`CareerBreakPlan`; apply the included additive migration with
`npx prisma migrate deploy` before running the updated app.

Health retains all six dimensions in its score breakdown and selectable 1/3/6-month history
from recorded version-2 snapshots. Fewer than two observations produce an explicit
empty state. Charts also expose their numbers in accessible tables.


## Information architecture: three daily priorities

The primary navigation is **Today / Health / Future**. Supporting routes remain
available from the toolbar’s tools menu and contextual links; no financial
records were deleted as part of the simplification.

| Destination | Responsibility | What was moved off its default surface |
| --- | --- | --- |
| Today | Remaining spending pace, spending so far, Health/Future shortcuts | Repeated goal balances, payday card, investment totals, AI regeneration and career-break promotion |
| Health | Score, recorded trend and one next action | Balance sheet/runway, protection/admin and wellbeing use disclosures; duplicate goal projections and AI narration removed |
| Future | Contributions-only savings/investment path and extra-saving comparison | Career-break tool moved to `/plan?view=career-break`; saved plan remains intact |
| Supporting tools | Transaction search, pay-cycle audit, goal balances, purchases, review and settings | Removed from the primary tab bar |

The savings projection starts with Emergency, Future Options and recorded
investments. It retains scheduled Emergency/Future Options/Investing
contributions and optional extra saving. It excludes everyday cash, Travel,
Gear, super and debts and must not be presented as net worth. It assumes no
withdrawals, returns, fees, inflation or tax changes. Main forecast and Today’s
one-year preview share `projectSavings`; calendar paydays after today are counted
once. This comparison does not save assumptions or change allocations.
