# Testing Guide

## Automated Checks

Run all checks before committing changes:

```bash
npm run lint
npm test
npm run build
npm audit --omit=dev
```

`npm test` is the Vitest suite. Part of it runs against a real PostgreSQL,
because the invoice and payment-split logic is SQL, so it needs
`docker compose up -d` and `npm run db:migrate` first. Without them those files
fail with `ECONNREFUSED 127.0.0.1:5440` while the pure-logic tests still pass.

**That address is the point, not an oversight.** The store tests create and
delete rows, and `DATABASE_URL` in `.env.local` points at the hosted Supabase
database. Next's env loader deliberately skips `.env.local` when `NODE_ENV` is
`test`, so the suite never sees that URL and falls back to the local container
in `src/lib/db.ts`. Do not "fix" the connection error by exporting a hosted
`DATABASE_URL`: the fixtures would be created and dropped in the real database.
Start Docker instead.

With the local development server running, execute the database-backed smoke tests:

```bash
npm run test:smoke
node scripts/referral-smoke-test.mjs
node scripts/referral-webhook-smoke-test.mjs
SEED_ADMIN_PASSWORD='<admin password>' SEED_SELLER_PASSWORD='<seller password>' \
  node scripts/session-contract-smoke-test.mjs
```

Each script removes the records it creates. Together with the Vitest suite and
the manual passes below, these are the whole safety net.

### API contract checks

`session-contract-smoke-test.mjs` covers what neither the Vitest suite nor a
manual pass can reach. Vitest calls functions directly and never sees a status
code; the panels gate their own UI so some API states are unreachable by
clicking. The script asserts the responses of `POST /api/sessions`,
`POST /api/payments/checkout` and `POST /api/local-team` over HTTP.

Its headline assertion is the money guard: `confirmDeliveryWithoutBalance` must
refuse an order that still owes money. That is the whole reason the endpoint is
separate from ordinary delivery confirmation, and it is asserted in both
directions — 409 with a balance, 200 for an order paid 100% up front.

It needs the workflow states a live order passes through. If it reports missing
fixtures, create them and then remove them afterwards:

```bash
SEED_ADMIN_PASSWORD='<admin password>' node scripts/seed-test-fixtures.mjs
node scripts/cleanup-test-fixtures.mjs            # dry run
node scripts/cleanup-test-fixtures.mjs --apply    # delete
```

The seeder drives the real API for every step and writes SQL only for the two
Stripe-webhook confirmations, which cannot be forged from a script. It writes
payment rows that no money backs, so point it only at a demo database. See
`README.md` for the detail, including what the cleanup deliberately leaves
behind.

For local Stripe events, run `stripe login`, then:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Put the emitted `whsec_...` value directly in `.env.local`, restart Next.js, and use Stripe test cards. Never commit or paste Stripe secrets into chat.

## Customer Link Test

The point of this one is that the customer's link must not depend on the
browser that made the booking.

1. Book from the public site and complete the 20 USD test checkout.
2. Confirm the address bar now reads `/session/<id>?token=...`. A `/session/<id>`
   with no token means the token is being stripped somewhere.
3. Copy that full URL into a **different browser**, or a private window, and
   confirm the order opens.
4. In the seller dashboard, use **Copy customer link** on the same session and
   confirm that link also opens in a third browser — minting a new token must
   not invalidate the one already in use.
5. Clear site data in the original browser, reload the tokenised URL, and
   confirm the order still opens.
6. Open `/session/<id>` with the token removed, in a browser with no cookie, and
   confirm the card says to reopen the secure link — not that the link is
   invalid or expired.
7. Confirm the delivery address can no longer be changed after the up-front
   payment: `confirmDeliveryAddress` answers 409 with `CHECKOUT_ADDRESS_LOCKED`.
   This is the guard that makes a shareable link safe, and
   `src/lib/store/delivery-address.test.ts` pins it in both directions.

## Language Test

1. On `/`, switch the header language control to English and confirm the whole
   page changes, including the slot count, the local-invoice checkbox and the
   validation messages.
2. Reload. The choice is a cookie, so it must survive, and view source should
   show `<html lang="en">` on the first response rather than switching after
   paint.
3. Repeat on `/session/<id>` and `/local-team`.
4. Trigger a payment error in English — submit the initial payment with a
   two-character address — and confirm the message is English. The API composes
   these server-side and returns a code the page translates, so a Spanish
   sentence appearing here means a code is missing from the dictionary.
5. Confirm `/seller` is unaffected and stays English.

Do **not** use the browser's own translation to check any of this. The app sets
`translate="no"` because Chrome rewrites text nodes React still owns, which
throws `NotFoundError` on the next render and makes a successful write look
like it failed.

## Seller Navigation Test

1. Open a live session panel (`/seller?sessionId=<id>`).
2. Click **Shipping** in the sidebar and confirm Shipping opens — not Overview.
   Repeat for Bookings, Customers and Sessions.
3. Reload on `/seller?tab=shipping` and confirm the tab survives.
4. Use the browser Back button and confirm it returns to the previous tab
   rather than leaving the dashboard.
5. Page to page 2 of Bookings, switch to Customers, and confirm it starts at
   page 1 rather than an empty table.

## Manual Customer Booking Test

The customer screens are in Spanish.

1. Run `npm run dev` and open `http://localhost:3000`.
2. Select a date between today and the end of next month.
3. Confirm all hourly Nike Sawgrass slots are shown.
4. Confirm booked slots are disabled and labelled `Reservado`.
5. Enter customer details and complete the 20 USD Stripe Test Mode Checkout.
6. Confirm the verified webhook changes the reservation from pending to confirmed.
7. Abandon another checkout and confirm the slot becomes available after 15 minutes.
8. Book again with **Necesito factura local de Brash3D SAS** ticked, and confirm the flag appears in the seller session header and the Colombia delivery list.

## Manual Seller Dashboard Test

1. Open `http://localhost:3000/seller` and confirm it redirects to `/login` while signed out.
2. Sign in with a staff account created through `npm run auth:create-staff`.
3. Check Overview, Bookings, Customers, and Sessions.
4. Confirm each table fits the dashboard content area and changes records through pagination.
5. Use a row action to open the seller or secure customer session view.
6. Use Book for customer to create a seller-side appointment.
7. In a seller session, add products, change quantities, remove a product, and close the session.
8. Sign out and confirm the seller page and APIs are no longer accessible.

## Live Synchronization Test

1. Keep the customer session and seller session open in separate browser tabs.
2. Add or edit products in the seller panel.
3. Confirm the customer cart updates without manually refreshing.
4. Close the session and complete the 65 percent Stripe test payment from the customer page while `stripe listen` forwards webhooks.
5. Confirm the customer enters a Colombia city and complete delivery address before Checkout opens.
6. Create the individual shipment, attach it to a consolidated box, and verify its digital manifest.
7. Sign in as Colombia staff, receive the box, record the final payment, and confirm seller/customer status updates.
8. Confirm the customer invoice labels the tax and commission percentages that the session actually stored, not a hard-coded 7/15.

## Duplicate Payment Test

The case this protects against: the team sends a Stripe balance link, the
customer pays cash instead, and the link is still live.

1. As the Colombia team, open a delivery with a balance outstanding and use
   **Copiar link de pago Stripe**. A toast should confirm the link was copied —
   if nothing appears, the clipboard was blocked and nothing was copied. Keep
   the link.
2. Record **Efectivo recibido** on the same delivery. Confirm the dialog appears
   *before* anything is recorded, and that it warns a Stripe link is still live.
3. Confirm. Then open the copied link: Stripe should report the session is
   expired. Check the server log for `Expired the Stripe balance link after an
   offline collection`.
4. To exercise the second guard, reverse the order: open the Stripe link and
   complete payment with `stripe listen` running, but record the cash first, in
   the seconds before the webhook lands. The webhook should refund the card
   automatically. Verify a `refunded` row in `payment_logs`, a
   "Duplicate payment refunded" seller notification, and that
   `monto_pagado_final` still reflects the cash, with `metodo_pago_recibido`
   still `efectivo`.
5. Replay the same Stripe event. It must answer `duplicate` and must not refund
   again.

`src/lib/store/duplicate-payment.test.ts` pins all of this except the Stripe
calls themselves.

## Box Settlement Test

The Colombia panel is in Spanish.

1. Put at least three deliveries in one consolidated box and collect them three different ways: Stripe link, `Efectivo recibido`, and `Transferencia`.
2. Open the box under `Cajas recibidas` and check **Resumen de esta caja**.
3. Confirm `vía Stripe` plus `fondo local Colombia` equals `total cobrado en entregas`.
4. Confirm the cash and transfer amounts are broken out under the local fund line.
5. Confirm any uncollected delivery appears under `saldo pendiente por cobrar`.

## Referral Cap Test

1. Set `REFERRAL_REWARD_MONTHLY_CAP` to a small number and restart the app.
2. Have that many referred customers each complete a first 65 percent payment.
3. Confirm one more referred customer's first payment grants no further reward that month.

## Theme Test

Use the theme control in the customer header or seller dashboard header. Confirm Light, Dark, and System themes apply across the full page.

## Language Check

Customer screens (`/`, `/session/<id>`) and the Colombia panel (`/local-team`)
are Spanish. The USA seller/admin dashboard (`/seller`) is English. The shared
purchase-history table takes a `locale` prop, so confirm it reads Spanish on the
customer page and English in the seller dashboard.
