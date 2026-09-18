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
- **Commission set per order, not per business.** The specification fixed it at 15% for everyone (§3, `FEE_RATE`); the client charges by the deal — 10% against a customer's budget, 15% on an ordinary split, 20 to 30% when Brash3D fronts the whole purchase. The seller now sets the rate from the live panel with 10/15/20/30 presets or any figure the database can store.
- The control sits in the session panel rather than the close dialog, where the up-front split lives. The customer watches their cart price itself live, so a rate that only appeared at close would show them 15% for the whole session and then move the total at the end — which reads as a bait and switch even when both sides agreed 25% that morning. Setting it before the first product is added is the intended order, and the card says so.
- Closing locks it with the rest of the invoice: `setCommissionRate` matches only an `en_progreso` session, so a repricing cannot move a total the customer has already been shown. Pinned by `src/lib/store/commission.test.ts`, along with the four rates the client named, the reprice of an existing cart, and the database range beneath the API's validation.
- Admin-only session reopening for correction, recorded in an audit table.

### Payments
- All three Stripe stages: the 20 USD booking fee, the initial invoice, and the delivery-triggered balance.
- Per-order payment split. The seller chooses how much is paid up front when closing the session (100, 85, 65 or 50 percent, or any figure between 50 and 100); the balance is collected on delivery. A fully prepaid order skips collection and goes straight to delivery confirmation.
- **Never below 50 percent up front.** The client stated it as a rule across every pricing model he described, not a preference: that money funds the purchase at the outlet, so a smaller share has Brash3D fronting stock against a promise. Enforced in the API and in the close dialog. It governs what a seller may choose, not what the system can price — an order closed before the rule settles at exactly the figure it was quoted, which is why `clampPercentage` was deliberately left alone and is pinned by a test in both directions.
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
- **The local-invoice offer is withdrawn** at the client's instruction. Specification section 14 asked for it and framed it as a service to a business buyer who needs to deduct the purchase locally; what it never says is the cost, which the client supplied: a Brash3D SAS invoice is a formal sale inside Colombia carrying IVA at 19%, and his customers will refuse to pay it. Offering it invited the one outcome the rest of the design works to avoid — money landing in the Colombian entity rather than the US LLC. `DEFAULT_COUNTRY.localInvoice` is `null`, which is what the field was built to take, so the checkbox is gone from the booking screen and the seller and Colombia badges have nothing left to show. The `requiere_factura_local` column and its index stay, holding false for every new booking; restoring the offer is that literal again. Bookings made before the change keep their flag and still show the badge.

### Customer order links
- The customer's order link carries its own access token, so it works in any browser, on any device, and again weeks later. Built in one place (`src/lib/customer-link.ts`) and used by the seller's copied link, the token-for-cookie redirect, and both Stripe return URLs.
- Previously the redirect stripped the token and left the customer on a `/session/<id>` with no credential in it: the authority lived only in a cookie in one browser profile. Since a booking is routinely made days ahead, a customer who closed that browser, switched device or cleared site data had no way back into their own order, and only the seller could mint a new link. Nothing reported an error — the page simply said the session did not exist.
- The cookie is now a convenience, not the credential. The three customer APIs each accept the token explicitly and fall back to the cookie, so neither path depends on the other, and a cookie-only visitor is handed its own token back and has it written into the address bar.
- The "session not found" card names the real cause and tells the customer to reopen the secure link. It used to assert the link was invalid, expired or replaced — all three wrong for the common case, and misleading enough to look like a defect.
- The delivery address freezes as soon as the up-front payment lands (`confirmDeliveryAddress`), which is what keeps a portable link safe: a forwarded link can read an order in flight but can never redirect the goods. That guard already existed as raw SQL in the checkout route; it moved behind the store boundary so it could be tested, and is now pinned in both directions.

### WhatsApp
- The booking confirmation is sent when the Stripe webhook confirms payment, carrying the customer's own order link. This is specification screen 3 -- "After payment, the customer receives the WhatsApp video call link" -- and the client's own reason for wanting WhatsApp at all: a booking is made days ahead, nobody keeps a browser tab that long, and the link previously existed only in a page the customer was about to close. A WhatsApp thread is where these buyers already are, and it is still there on the day.
- Specification 7.1's product echo, sent as the seller adds each item. Free text inside an open messaging window, and an approved template when there is none, chosen per send -- so the customer receives their cart without having to tap anything first.
- A send never costs a cart insert. `sendText` and `sendTemplate` return an outcome rather than throwing, which is section 7.1's explicit instruction: the item is on the invoice whether or not Meta was reachable.
- The customer opts in, from their order page, during the session. Offered only once the seller has started, because that is when the seller can say "tap the green button on your screen"; before then there is nothing to update. One tap opens their WhatsApp *and* records consent -- the same act that reopens Meta's 24-hour window. Once used the control settles into a confirmation rather than staying an inviting button, with an understated way to turn it off.
- Consent is checked before every echo. Meta's window governs how a message may be sent; nothing in the platform records whether it was wanted, and an unasked-for message is how a business number earns a low quality rating.
- The seller panel shows whether the window is open, so a shut one is discovered before the first product rather than as a rejected send mid-call.
- Inbound webhook with the `GET` verification handshake and `X-Hub-Signature-256` verification. With no app secret it refuses every POST rather than trusting the body: what an open webhook would accept is "the customer messaged us", which is exactly the fact the seller acts on.
- Delivery and read receipts are ignored. A receipt is generated by our own outbound message and would otherwise hold the window open in the UI while Meta considers it shut.
- Optional throughout. With no credentials nothing sends, the webhook stays closed, and the web cart carries the session exactly as before.
- Message copy lives in one module with Spanish and English, chosen by `WHATSAPP_MESSAGE_LOCALE`. Spanish is the default and the shipping copy; English exists for testing, and a test pins the default so nobody ships English to Colombian buyers by forgetting.
- Two of the specification's assumptions about the platform were wrong, and both are recorded in [the plan](WHATSAPP.md): a WhatsApp *video* call does not open the messaging window, and "sent freely" meant without template approval rather than without cost.

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

### 1. WhatsApp reaches the customer; the templates do not exist yet
Specification screen 3 -- "After payment, the customer receives the WhatsApp
video call link" -- is built. When the booking payment is confirmed, the Stripe
webhook sends the customer their order link over WhatsApp, and section 7.1's
product echo follows during the live session. See
[WhatsApp integration plan](WHATSAPP.md) for the platform rules that shape it.

What is not done is the part only the client can start. Meta refuses free text
to anyone who has not messaged the business in the last 24 hours, and a booking
is routinely made days ahead, so the confirmation has to go as an **approved
template**. Three are drafted in the plan document. Creating them needs the
client's Meta Business Account and Business Verification, which takes days.

Until a template exists the confirmation is sent as free text, which only
reaches a customer whose window happens to be open -- in practice, a tester.
The code prefers the template whenever `WHATSAPP_TEMPLATE_BOOKING` names one,
so nothing changes but the environment.

Still worth adding, and independent of Meta: **a booking confirmation email**.
It needs an email provider and nothing else, and it covers the customer who
gives a phone number WhatsApp does not reach.

### 2. Nothing is sent when the session starts
The customer is told their session has begun only if they are looking at their
order page. A short message when the seller presses Start would carry them
there, and would open the messaging window for the echo that follows. One more
message per order, so it is a product decision rather than a technical one.

Past the session, nothing is pushed at all -- invoice ready, payment confirmed,
shipped, delivered. The client never asked for these and screen 4 of his own
design puts them on the order timeline, which is built.

### 3. Automatic courier tracking — blocked on carrier selection
Specification section 10 suggests routing a courier's "delivered" webhook into
delivery confirmation. Today USA operations types the courier and tracking
number when dispatching a box, and Colombia confirms delivery by hand. Needs the
client's chosen carrier and API credentials.

### 4. Seller/admin dashboard is still English-only
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

### 5. The Colombia panel still polls
The customer's live cart now arrives over Supabase Realtime (see "Live session"),
with polling kept underneath at 30 seconds because a socket can die quietly on a
sleeping phone. The Colombia local-team panel still polls every 5 seconds. It is
correct but chatty, and it is the one surface left where the specification's
realtime model has not been applied.

### 6. Query efficiency in the operations panels
`listBoxManifests` calls `listSessions()` and filters in JavaScript, and
`/api/local-team` invokes that pair on every 5-second poll. Fine at current data
volumes, worth scoping to the relevant sessions as history grows.

### 7. Supabase Auth
Row level security is enabled and verified (see Production hardening), and
migration 018 added read policies for the three tables the customer's live cart
subscribes to. Access is a signed claim naming one session, minted only for a
caller that already proved it holds that session's customer access token — so
Realtime shipped without needing `auth.uid()`, and the publishable key alone
still reads nothing.

Not built: Supabase Auth magic links for customers. The specification's section 8
policies assume an `auth.uid()` that no section ever creates, and nothing today
needs one. It becomes worth revisiting only if customers should sign in rather
than hold a link — which requires client sign-off, since they would begin
receiving a Supabase authentication email in place of the current secure link.

### 8. Deployment configuration
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
- No error-tracking destination (item 9).
- The Supabase project is on the free plan, which pauses after a week of
  inactivity and takes the site down until somebody resumes it by hand.
- Stripe stays in test mode until the client is ready to go live. Live mode
  needs its own secret key **and** its own webhook endpoint with its own signing
  secret; neither carries over from test.
- Preview deployments share the production `DATABASE_URL`, so a preview build
  reads and writes live data. Harmless while the data is demo, not after.

See the production checklist in `README.md`.

### 9. Error tracking destination
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
| Supabase Realtime subscribed with the anon key | Realtime subscribed with a server-minted session claim | The app talks to Postgres as the table owner and hands no database key to a browser. The customer's socket carries a short-lived token naming one session, which migration 018's policies check per row — a subscription filter is chosen by the client and is worthless as a boundary |
| Separate Node/Express backend | Next.js route handlers | One deployable unit |
| Row Level Security policies scoped on `auth.uid()` (section 8) | Deny-all floor (015), plus read policies scoped on a server-minted session claim (018) | The spec's per-user policies need an `auth.uid()` no section ever creates. Migration 015 denies every role that is not the table owner, closing Supabase's PostgREST endpoint to the publishable key; 018 reopens SELECT on exactly three tables to a claim the server issues. Route handlers remain the real authorization |
| Commission fixed at `FEE_RATE` for the whole business (section 3) | Set per order by the seller | The client prices by the deal — 10% against a budget, 15% on a split, 20-30% when Brash3D fronts the purchase. One business-wide rate cannot express any of it |
| A local Brash3D SAS invoice on request (section 14) | Offer withdrawn | The spec names the feature but not its cost: a formal sale inside Colombia carries 19% IVA, and the client's customers refuse to pay it. It invited money into the entity the rest of the design keeps money out of |
| Up-front share left open (section 1 states 65%) | Never below 50% | The client's one constant across every pricing model he described. That money funds the purchase at the outlet |
| Invoice computed in the browser (section 6) | Computed in PostgreSQL | The spec contradicts its own section 3 and would let a browser set any total |
| Referral dedupe by `reserva_id` (section 12.1) | Dedupe by `referido_id`, plus a monthly cap | The spec's version grants a second reward on a referred customer's second booking |
| Delivery marked before the charge clears (section 10) | Receipt required, Stripe confirmed by webhook only | The spec would record a declined card as delivered and paid |
| Three Payment Intents confirmed with Stripe.js | Three hosted Stripe Checkout sessions | Smaller PCI surface, no card fields in the app |
| Spanish table and column names | Kept as specified | Matches the business's internal language |
