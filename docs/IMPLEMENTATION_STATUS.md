# Implementation Status

Measured against `Brash3D_Design_and_Technical_Spec.md` (the four approved screen
designs and the 14-section technical specification).

## Delivered

### Booking and availability
- Customer booking interface with date selection and all visible hourly slots.
- Availability from today through the end of next month, one Nike Sawgrass schedule, 10 hourly slots per day from 9:00 AM to 6:00 PM.
- Unavailable slots remain visible, disabled, and labelled as booked.
- Transactional slot locking, duplicate-booking protection, and atomic 15-minute pending-payment holds with automatic release.
- Admin-managed opening hours. A weekly template per seller sets which days are open and between which hours, and dated exceptions close or re-time a single day for a holiday or an outlet closure. Slot generation reads both instead of the hard-coded `generate_series(9, 18)` that produced ten slots every day of the week with no way to close a Sunday. Migration 016 seeds the previous behaviour exactly — all seven days, 09:00 to 19:00 — so deploying it changes no customer-visible availability; closing a day is then a decision made in the panel. Reconciliation runs in both directions: slots left over from a previous schedule are removed, except where a reserva already points at one, because that appointment belongs to a customer. Those surface in the panel as a warning listing each stranded booking rather than being silently dropped.
- Seller-side booking creation on behalf of a customer.

### Live session
- Seller live product entry, cart editing, quantity changes, and session closure.
- Customer live cart and order-progress timeline, refreshed by polling.
- Tax and commission rates configurable through `TAX_RATE_FL` and `FEE_RATE`, recorded per session so a rate change never reprices an invoice already quoted.
- Admin-only session reopening for correction, recorded in an audit table.

### Payments
- All three Stripe stages: the 20 USD booking fee, the initial invoice, and the delivery-triggered balance.
- Per-order payment split. The seller chooses how much is paid up front when closing the session (100, 85, 65 percent or any figure between 1 and 100); the balance is collected on delivery. A fully prepaid order skips collection and goes straight to delivery confirmation.
- The two charges are derived by subtraction, so they always add up to the invoice exactly rather than drifting a cent through independent rounding.
- Signature-verified, idempotent webhook processing.
- Late booking payments refunded automatically, recorded in `payment_logs` and surfaced as a staff notification.
- Persistent seller notifications for booking, initial, and final payments.

### Shipping and Colombia operations
- Customer-confirmed Colombia delivery address before the 65 percent payment, plus system-generated shipment labels.
- USA consolidated-box dispatch and the Colombia local-team receipt manifest.
- Stripe, cash, and transfer collection at delivery, with transfer visually de-emphasised as the specification requires.
- Per-box settlement summary separating Stripe (US LLC revenue) from the cash and transfer amounts that stay in Colombia as the local operating fund.
- Customer-requested local Brash3D SAS invoice flag, surfaced in the seller panel and the Colombia delivery manifest.

### Referrals and history
- Referral codes, first-paid-referral rewards, automatic complimentary booking redemption, self-referral rejection, and a monthly cap per referrer.
- Secure customer purchase-history views for customers and assigned sellers.

### Production hardening
- Structured JSON logging (`src/lib/logger.ts`), one object per line, with automatic redaction of anything whose key looks like a credential. No vendor SDK, so it pipes into Vercel, CloudWatch or Datadog as-is.
- Every route handler wrapped by `withErrorHandling`: an unexpected throw is logged with its stack and answered with a generic 500 instead of failing silently.
- Malformed JSON bodies answer 400 rather than 500.
- Stripe webhook outcomes, refunds of late payments, and failed staff logins are all logged.
- Scrypt parameters defined once in `src/lib/password.mjs`, shared by the application and `scripts/create-staff.mjs`, with a test proving a script-created account can log in.
- `Strict-Transport-Security` alongside the existing nosniff, frame, referrer and permissions headers.
- Request bodies read through one helper (`readJsonBody`). Each route previously wrapped `await request.json()` in its own try/catch, which catches a parse failure but not a body that parses to something other than an object: `null`, `true`, `123` and `"str"` all reached handler code and threw on the first property access. Three routes answered 500 to a one-byte body, among them the public booking endpoint and the customer payment endpoint. Narrowing the parsed body from `any` to `unknown` also surfaced several fields that had been passed into typed parameters with no validation at all.
- Slot listing runs as one database round trip instead of three. Server-side each statement takes under 4 ms, but every statement costs a full network round trip to a managed database — about 160 ms to the Tokyo region — so the public booking page spent most of a second waiting on the network. Generating missing slots, releasing expired holds and reading the list now travel together over the simple query protocol, and the expired-hold release is a single CTE rather than a read followed by a dependent write. Measured on the booking page: 727-1018 ms before, 184 ms after.
- Row level security enabled on all 19 public tables (`015_enable_row_level_security.sql`), with the privileges Supabase grants `anon` and `authenticated` by default revoked. Supabase serves PostgREST over the `public` schema to anyone holding the publishable key, which is public by design, and that endpoint is live whether or not the application uses supabase-js — this one does not. Verified: before the migration every table answered reads and deletes over that endpoint, `staff_users.password_hash` included; after it, every one answers 401. The application is unaffected because it connects as the table owner, which bypasses RLS.
- Database TLS decided once in `src/lib/db-ssl.mjs` and shared by the application pool and the migration runner, the way `password.mjs` is shared with `create-staff.mjs`. A local host connects in the clear; every other host verifies against the system CA store, which is what a managed provider such as Supabase requires. `DATABASE_SSL` and `DATABASE_SSL_CA` override it.
- Scheduled maintenance (specification section 14): expired booking holds are released on a timer rather than only when somebody reads the slot list, and the three tables that otherwise only grow — `stripe_webhook_events`, `customer_session_access` and `request_rate_limits` — are pruned. Webhook-event retention deliberately outlasts Stripe's three-day retry window, since that ledger is what stops a retry being charged twice. A long-running host runs it in-process from `src/instrumentation.ts`; a serverless host, where timers never fire between requests, drives the same work through `POST /api/maintenance`, which stays closed unless `MAINTENANCE_SECRET` is set.

### Interface review
A screen-by-screen pass over every page at desktop and 375 px, covering all five
seller tabs, all three Colombia views and the customer screens.

- Fixed a 130 px horizontal overflow on the seller's live session panel — the screen used one-handed at the outlet during a call.
- Payment notifications stated the amount and the order's own percentage instead of a hard-coded "65%" and a malformed "inicial%".
- Removed nine hard-coded percentage labels left over from the fixed 65/35 split.
- Colombia panel: added the customer's WhatsApp number as a one-tap link in both the delivery list and the detail sheet — the team had no way to contact the customer they were delivering to.
- Colombia panel: removed a duplicated "Pago pendiente" badge, the "Saldo pendiente: Saldo $x" stutter, and added the originating box number.
- Bookings table: merged the split Date and Time columns and renamed the column called "Appointment" that actually held the status.
- Customers table: "Order value" renamed to "Latest order", which is what it shows.
- Customer screens: removed the header link that invited customers away mid-session, a disabled decorative button, ten repeated "Disponible" labels, and the referral, history and shipping cards that were not actionable during a live call.
- The booking button now explains why it is disabled and links to the slot grid, instead of dead-ending after a long scroll.
- The referral code gained a working copy button; the old icon had no handler.

### Testing
- Vitest suite covering the invoice maths, the payment split, the Stripe webhook, referral rules, and the box settlement split.
- CI runs lint, migrations, the test suite, the build, and an audit against a real PostgreSQL service.

### Platform
- PostgreSQL persistence for every entity, with repeatable numbered migrations.
- Staff login/logout, database-backed sessions, account lockout, rate limiting, and role authorization.
- Secure customer order links using hashed tokens exchanged for HTTP-only cookies.
- Spanish customer screens and Spanish Colombia local-team panel; English USA seller/admin dashboard.
- Responsive shadcn/ui components with light, dark, and system themes.
- Database health endpoint and repeatable API smoke tests.

## Remaining

### 1. WhatsApp Cloud API notifications
Specification section 7.1 asks for a WhatsApp text echo of each product as the
seller adds it. None of this is built; the WhatsApp references in the UI are
icons and links only.

Two of the specification's assumptions turned out to be wrong — a video call
does not open the 24-hour messaging window, and "sent freely" referred to
template approval rather than cost. A build path that needs no template
approvals and no Business Verification is written up in
[WhatsApp integration plan](WHATSAPP.md), along with the pricing change Meta
applies from 1 October 2026.

Needs from the client only if proactive status pushes are wanted: a Meta
business account, Business Verification, phone-number ID, access token and
verify token.

### 2. Automatic courier tracking — blocked on carrier selection
Specification section 10 suggests routing a courier's "delivered" webhook into
delivery confirmation. Today USA operations types the courier and tracking
number when dispatching a box, and Colombia confirms delivery by hand. Needs the
client's chosen carrier and API credentials.

### 3. Seller/admin dashboard is still in English
The client's mockup for the seller panel is in Spanish. The customer screens and
the Colombia panel were translated; the USA seller/admin dashboard was not,
because the seller is Miami-based and translating it is a large change. This is
a product decision for the client, not a technical blocker.

### 4. Polling instead of realtime
The specification assumed Supabase Realtime. The customer and seller session
views poll every 1.5 seconds and the Colombia panel every 5 seconds. This is
correct but chatty: each open session page issues about 40 requests per minute.
PostgreSQL `LISTEN`/`NOTIFY` behind Server-Sent Events is the natural upgrade
before many sessions run concurrently.

### 5. Query efficiency in the operations panels
`listBoxManifests` calls `listSessions()` and filters in JavaScript, and
`/api/local-team` invokes that pair on every 5-second poll. Fine at current data
volumes, worth scoping to the relevant sessions as history grows.

### 6. Supabase Auth and Realtime
The database is now hosted on Supabase, and row level security is enabled and
verified (see Production hardening) — the deny-by-default floor is in place.

Not yet built: Supabase Auth magic links for customers, per-customer RLS read
policies, and read-only Realtime subscriptions replacing the polling in item 4.
These three ship together and only become necessary together. Today no anon key
has a path to the data, so the deny-everything floor is the correct posture;
giving the browser a Realtime subscription is what would require the policies,
and those in turn require an authenticated customer identity for `auth.uid()` to
resolve — which specification section 8 assumes but never creates. Writes stay
server-side regardless. Requires client sign-off on customers receiving a
Supabase authentication email.

### 7. Deployment configuration
A managed database, a public HTTPS webhook endpoint, production staff accounts,
and an error-tracking destination for the JSON logs must be configured at
deployment. Stripe stays in test mode until the client is ready to go live.
See the production checklist in `README.md`.

### 8. Error tracking destination
Structured logs are emitted but nothing aggregates or alerts on them yet.
Whatever the host provides (Vercel log drains, CloudWatch) or a tracker such as
Sentry can consume them without code changes; only the destination is missing.

## Demo Data Assumptions

- Nike Sawgrass is the single outlet shown in the supplied client design.
- Maria Garcia is the active seeded seller.
- The 20 USD booking fee, Florida tax, and Brash3D commission are represented in the demo flow.

## Deliberate Deviations From The Specification

These differ from the written specification on purpose; each is an improvement
or a consequence of not using Supabase.

| Specification | Built instead | Why |
| --- | --- | --- |
| Supabase (Postgres + Realtime) | Self-hosted PostgreSQL via `pg` | No vendor dependency; realtime replaced by polling |
| Separate Node/Express backend | Next.js route handlers | One deployable unit |
| Row Level Security policies (section 8) | Server-side authorization on every route | The spec's policies need an `auth.uid()` no section ever creates; no database key reaches a browser today |
| Invoice computed in the browser (section 6) | Computed in PostgreSQL | The spec contradicts its own section 3 and would let a browser set any total |
| Referral dedupe by `reserva_id` (section 12.1) | Dedupe by `referido_id`, plus a monthly cap | The spec's version grants a second reward on a referred customer's second booking |
| Delivery marked before the charge clears (section 10) | Receipt required, Stripe confirmed by webhook only | The spec would record a declined card as delivered and paid |
| Three Payment Intents confirmed with Stripe.js | Three hosted Stripe Checkout sessions | Smaller PCI surface, no card fields in the app |
| Spanish table and column names | Kept as specified | Matches the business's internal language |
