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

### Collecting the balance without charging twice
- The two collection routes overlapped. The Colombia team can copy a Stripe balance link *and* record cash, and recording the cash left the link payable in Stripe for hours. A customer who handed over cash and then tapped the link they had already been sent was charged a second time.
- Worse than a double record: `processSessionCheckoutEvent` guards its UPDATE on `monto_pagado_final = 0`, so the second payment matched no row and fell through to `ignored` — the same outcome as an unrecognised checkout id. No `payment_logs` row, no notification, nothing anywhere in the app. Stripe held a real charge against a settled balance and nobody was told.
- Two guards now. Recording an offline collection detaches and expires the Stripe checkout (`takeOpenCheckoutForStage`, then `checkout.sessions.expire`), so the link stops working. Anything that still lands — someone paying in the seconds before the collection is recorded — is detected as `already_settled`, refunded automatically, written to `payment_logs` as `refunded`, and surfaced as a seller notification. The same shape as the existing late-booking refund.
- The Stripe link is expired after the transaction commits, deliberately: the balance is recorded either way, and a Stripe outage must never roll back money the team is physically holding.
- The cash collection always wins. The card charge is the one reversed, and `metodo_pago_recibido` keeps the offline method.
- Migration `017_duplicate_payment_notification.sql` permits the `duplicate_payment_refunded` notification type. Without it the refund transaction rolls back on the CHECK constraint, so the refund would be issued at Stripe and then left unrecorded -- exactly the gap this closes. Found by running the tests, not by review.
- Recording cash or a transfer now asks for confirmation first. It closes the delivery with no undo, so it should not be one click away in a dropdown, and the dialog warns explicitly when a Stripe link for the same balance is still outstanding.

### Shipping and Colombia operations
- Customer-confirmed Colombia delivery address before the 65 percent payment, plus system-generated shipment labels.
- USA consolidated-box dispatch and the Colombia local-team receipt manifest.
- Stripe, cash, and transfer collection at delivery, with transfer visually de-emphasised as the specification requires.
- Per-box settlement summary separating Stripe (US LLC revenue) from the cash and transfer amounts that stay in Colombia as the local operating fund.
- Customer-requested local Brash3D SAS invoice flag, surfaced in the seller panel and the Colombia delivery manifest.

### Customer order links
- The customer's order link carries its own access token, so it works in any browser, on any device, and again weeks later. Built in one place (`src/lib/customer-link.ts`) and used by the seller's copied link, the token-for-cookie redirect, and both Stripe return URLs.
- Previously the redirect stripped the token and left the customer on a `/session/<id>` with no credential in it: the authority lived only in a cookie in one browser profile. Since a booking is routinely made days ahead, a customer who closed that browser, switched device or cleared site data had no way back into their own order, and only the seller could mint a new link. Nothing reported an error — the page simply said the session did not exist.
- The cookie is now a convenience, not the credential. The three customer APIs each accept the token explicitly and fall back to the cookie, so neither path depends on the other, and a cookie-only visitor is handed its own token back and has it written into the address bar.
- The "session not found" card names the real cause and tells the customer to reopen the secure link. It used to assert the link was invalid, expired or replaced — all three wrong for the common case, and misleading enough to look like a defect.
- The delivery address freezes as soon as the up-front payment lands (`confirmDeliveryAddress`), which is what keeps a portable link safe: a forwarded link can read an order in flight but can never redirect the goods. That guard already existed as raw SQL in the checkout route; it moved behind the store boundary so it could be tested, and is now pinned in both directions.

### Language
- Spanish and English on every customer screen and the Colombia panel, switched from the header and remembered in a cookie for a year. The USA seller/admin dashboard stays English.
- The initial locale is read server-side, so the first paint is already in the reader's language and `<html lang>` is right for a screen reader.
- This is the app's own translation rather than the browser's on purpose: Chrome's rewrites text nodes in place, React throws `NotFoundError` from `removeChild` on the next render, and a committed write looks like a failure. `translate="no"` stays.
- `POST /api/payments/checkout` now sends a stable error `code` beside its Spanish sentence so the page can translate it. The sentences are byte-identical — one is pinned by the contract smoke test, and they remain the fallback for an unrecognised code.
- A test asserts both dictionaries have the same keys and the same shape, that every checkout code is translated, and that no entry was pasted into both languages untranslated. TypeScript cannot catch the dynamic lookups (`t.localTeam.filters[value]`, `t.session.payErrors[code]`).

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
- Row level security enabled on every public table (`015_enable_row_level_security.sql`, and each later migration for the tables it adds — 21 tables today), with the privileges Supabase grants `anon` and `authenticated` by default revoked. Supabase serves PostgREST over the `public` schema to anyone holding the publishable key, which is public by design, and that endpoint is live whether or not the application uses supabase-js — this one does not. Verified: before the migration every table answered reads and deletes over that endpoint, `staff_users.password_hash` included; after it, every one answers 401. The application is unaffected because it connects as the table owner, which bypasses RLS.
- Database TLS decided once in `src/lib/db-ssl.mjs` and shared by the application pool and the migration runner, the way `password.mjs` is shared with `create-staff.mjs`. A local host connects in the clear; every other host verifies against the system CA store, which is what a managed provider such as Supabase requires. `DATABASE_SSL` and `DATABASE_SSL_CA` override it.
- `npm run db:check` verifies a hosted database without writing to it: the TLS settings in force, a migration on disk the database has never applied, a migration file edited after it was applied, a public table without row level security, and any privilege `anon` or `authenticated` still holds. It exits non-zero, so a deploy can gate on it. Three of those matter only once the database is remote — a serverless host has no pre-deploy hook, so migrations are run by hand and the code can ship ahead of its schema.
- Scheduled maintenance (specification section 14): expired booking holds are released on a timer rather than only when somebody reads the slot list, and the three tables that otherwise only grow — `stripe_webhook_events`, `customer_session_access` and `request_rate_limits` — are pruned. Webhook-event retention deliberately outlasts Stripe's three-day retry window, since that ledger is what stops a retry being charged twice. A long-running host runs it in-process from `src/instrumentation.ts`; a serverless host, where timers never fire between requests, drives the same work through `POST /api/maintenance`, which stays closed unless `MAINTENANCE_SECRET` is set.

### Creating the shipment from the listing
- "Create shipment" now creates it in place and shows the label code to copy. It was a link into the session panel, where the seller pressed a second button to do the same thing and then copied the code from a third place. Nothing in there was a decision: the label is derived from the customer name and session id, and the address is whatever the customer already confirmed.
- Offered only for a closed, paid order with no shipment yet — the same `hasInitialPayment` gate the panel button uses, so the two cannot disagree.
- `POST /api/sessions` answered one generic 409 for every refusal, naming a "65%" payment the split stopped being fixed at. `updateDeliveryStatus` returns null for no payment, no confirmed address, an existing shipment and a session still open, and the route now distinguishes them — necessary once the action has no panel behind it to go and inspect.
- `src/lib/store/create-shipment.test.ts` pins the label format (accents and spaces stripped, since it is written on a box by hand), that the confirmed address is carried onto the shipment, and all four refusals including a double-click producing a second package.

### Copying links
- Copying a link now says whether it worked. Every clipboard call went through `navigator.clipboard.writeText` with the rejection either swallowed by an empty `catch` or not guarded at all, so a blocked clipboard was indistinguishable from a successful copy -- and the operator pasted whatever had been in the clipboard beforehand. Browsers reject that write outside a secure context, and when the page is not focused or the call is too far from the click.
- `src/lib/clipboard.ts` wraps it and returns a boolean instead of throwing, so a caller cannot ignore failure by accident. `CopyToast` then reports which happened: a small confirmation at the bottom of the screen that clears itself after two seconds, or a longer-lived error saying nothing was copied.
- The customer order link was the worst case: "Generate customer access link" copied silently with no confirmation either way, and it is the only way the customer receives their link today. Renamed to "Copy customer link", and the session panel header button with it.
- The Colombia team's Stripe balance link had the same silent failure plus a second problem: the confirmation it set rendered in the alert at the top of the page, behind the delivery sheet the button is usually pressed from. The toast is fixed to the viewport, so it sits above the sheet.
- The first attempt at this was a dialog showing the link with its own Copy button. It confirmed the copy, but it put a modal in front of an action the operator performs constantly and mid-call, and then made them dismiss it. Replaced with the toast, which says the same thing without taking focus.
- Showing the link rather than only copying it also covers the blocked case and lets the operator read it out over the call.

### Seller session listing
- The row menu offered a dead end. For an unpaid order its only item read "Payment not completed" — a status, not an action, and one the stage badge in the same row already showed as "Awaiting up-front payment". It now offers "Open order details", which is a real destination: the invoice and the confirmed address are there.
- Creating the shipment was already correctly gated on `hasInitialPayment` (the row label, the stage badge and the button inside the panel all share it), and every writer of `monto_pagado_inicial` sets `payment_intent_inicial_id` in the same statement, so the gate has no false-negative path either.

### Seller dashboard navigation
- The visible tab is a search parameter (`/seller?tab=shipping`), so every sidebar item is a real link.
- It was component state, which left the sidebar nothing to link to: inside a live session panel all six items fell back to `<Link href="/seller">`, so clicking "Shipping" — or any other item — landed on Overview. Reloading the dashboard lost the tab too, and Back left the dashboard rather than returning to the previous tab.
- Paging is stored against the tab it belongs to instead of being reset by an effect, so a tab change never renders the wrong page first.

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
- API contract coverage over HTTP (`scripts/session-contract-smoke-test.mjs`), which the Vitest suite cannot provide because it calls functions directly and never sees a status code. Its headline assertion is the money guard: `confirmDeliveryWithoutBalance` must refuse an order that still owes money, asserted in both directions. Supported by `scripts/seed-test-fixtures.mjs`, which builds the workflow states a test cannot reach on its own — most of the order lifecycle sits behind a Stripe webhook that cannot be forged — and `scripts/cleanup-test-fixtures.mjs`, which removes them again.
- Two defects came out of that work, both cases where the API refused a request correctly but described the refusal wrongly, and neither reachable from the panels because each gates its own UI. Cart edits on a session that existed but had not been started answered `404 Session not found`, which was simply false; they now answer 409 with the reason, agreeing with the 409 `start` already returned. A final-payment checkout for an order paid 100% up front reported that the amount could not be computed and logged at error level — a support-desk message and a false alert for a supported configuration — and now reports that the balance is settled. The deliberate responses are unchanged and now pinned by tests: an unknown session and another seller's session still answer 404 rather than 403.

### Platform
- PostgreSQL persistence for every entity, with repeatable numbered migrations.
- Staff login/logout, database-backed sessions, account lockout, rate limiting, and role authorization.
- Secure customer order links using hashed tokens exchanged for HTTP-only cookies.
- Spanish customer screens and Spanish Colombia local-team panel; English USA seller/admin dashboard.
- Responsive shadcn/ui components with light, dark, and system themes.
- Database health endpoint and repeatable API smoke tests.
- Deployed and exercised in production: the app on Vercel, the database on
  Supabase, and Stripe test mode driving a real booking from the public site
  through to a confirmed reservation. See "Deployment configuration" under
  Remaining for what is still outstanding there.

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

### 3. Seller/admin dashboard is still English-only
The client's mockup for the seller panel is in Spanish. The USA seller/admin
dashboard is the one surface with no Spanish, because the seller is Miami-based.

What changed is that this is now only a translation job, not a build. The
customer screens and the Colombia panel run on `src/lib/i18n`, with a header
switcher, a cookie, server-side initial locale and a test that holds the two
dictionaries in step. Translating the dashboard means adding a `seller` section
to `messages.ts` and threading `useLocale` through `seller-panel.tsx` and
`schedule-panel.tsx` — roughly 1,400 lines of dense JSX, so it is a sizeable
change, but it needs no new mechanism.

Still a product decision for the client: whether the Miami seller wants it.

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
Mostly done. The app is deployed on Vercel at `https://brash3-d.vercel.app`, the
database is hosted on Supabase (`us-east-1`, pooler, TLS pinned to
`certs/supabase-root-2021.crt`), and the Stripe webhook is registered against the
production domain for `checkout.session.completed` and `checkout.session.expired`.
Verified end to end on 12 September 2026: a booking paid on the live site was
confirmed by the webhook 20 seconds later, with the payment logged, the
reservation moved to `confirmada` and the seller notified. Before that
registration existed the same booking expired its hold and released the slot,
which is what the two `hold_expired` cancellations from 11 September are.

Still outstanding at deployment:

- Staff passwords created for testing are still in place and must be rotated.
- No error-tracking destination (item 8).
- The Supabase project is on the free plan, which pauses after a week of
  inactivity and takes the site down until somebody resumes it by hand.
- Stripe stays in test mode until the client is ready to go live. Live mode
  needs its own secret key **and** its own webhook endpoint with its own signing
  secret; neither carries over from test.
- Preview deployments share the production `DATABASE_URL`, so a preview build
  reads and writes live data. Harmless while the data is demo, not after.

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
on it.

| Specification | Built instead | Why |
| --- | --- | --- |
| Supabase Realtime | Polling over `pg` | The app talks to Postgres directly as the table owner. Supabase hosts the database; its Auth and Realtime products are unused |
| Separate Node/Express backend | Next.js route handlers | One deployable unit |
| Row Level Security policies (section 8) | RLS enabled with no policies, plus server-side authorization on every route | The spec's per-user policies need an `auth.uid()` no section ever creates. Migration 015 instead denies every role that is not the table owner, which closes Supabase's PostgREST endpoint to the publishable key; the route handlers remain the real authorization |
| Invoice computed in the browser (section 6) | Computed in PostgreSQL | The spec contradicts its own section 3 and would let a browser set any total |
| Referral dedupe by `reserva_id` (section 12.1) | Dedupe by `referido_id`, plus a monthly cap | The spec's version grants a second reward on a referred customer's second booking |
| Delivery marked before the charge clears (section 10) | Receipt required, Stripe confirmed by webhook only | The spec would record a declined card as delivered and paid |
| Three Payment Intents confirmed with Stripe.js | Three hosted Stripe Checkout sessions | Smaller PCI surface, no card fields in the app |
| Spanish table and column names | Kept as specified | Matches the business's internal language |
