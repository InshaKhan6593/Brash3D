# Architecture

## Application Routes

| Route | Purpose |
| --- | --- |
| `/` | Customer booking and appointment selection. |
| `/login` | Staff authentication. |
| `/seller` | Authenticated seller/admin dashboard. Overview is the bare path. |
| `/seller?tab=<tab>` | Bookings, customers, sessions, shipping, or schedule. |
| `/seller?sessionId=<id>` | Seller live-shopping session panel. |
| `/session/<id>?token=<token>` | Customer live cart, order progress, and payments. |
| `/local-team` | Colombia receiving, final collection, and delivery panel. |
| `/api/slots` | Lists booking availability. |
| `/api/bookings` | Creates and retrieves bookings. |
| `/api/sessions` | Reads and mutates shopping sessions. |
| `/api/shipping` | Seller/admin consolidated-box dispatch and manifests. |
| `/api/local-team` | Colombia box receipt and delivery operations. |
| `/api/payments/checkout` | Creates the 65% and final 35% Stripe Checkouts. |
| `/api/notifications` | Persistent seller payment notifications. |
| `/api/customer-history` | Secure customer purchase history and referral-reward summary. |
| `/api/stripe/webhook` | Verifies and processes all Stripe payment events. |
| `/access/session/<id>?token=<token>` | Sets the scoped HTTP-only cookie, then redirects to the order page with the token still in the URL. |
| `/session/<id>/access` | Returns the caller's own token back to the page, from the cookie. |

## Seller Dashboard Navigation

The visible tab is a search parameter (`/seller?tab=shipping`), not component
state, and every sidebar item is a plain link to its own tab.

It was `useState`, which meant the sidebar had nothing to link to. Inside a
live session panel (`/seller?sessionId=<id>`) the panel rendered its sidebar
with no tab handler, so all six items fell back to `<Link href="/seller">` —
clicking "Shipping" navigated to the dashboard and mounted it on Overview.
Reloading the dashboard also lost the tab, and Back left the dashboard
entirely instead of returning to the previous tab.

Paging is held against the tab it belongs to rather than reset by an effect:
page 4 of Bookings has no counterpart in Customers, and resetting in an effect
renders the wrong page once before correcting it.

## Customer Order Links

A customer's order link carries its own credential in the URL, and
`src/lib/customer-link.ts` is the only place that builds one.

This is what makes the link portable, which an order-tracking link has to be: a
booking is often made days before the session, and the customer may open it on
a phone and then a laptop, or come back after clearing site data. The token is
stored only as a SHA-256 hash, lives 90 days, is not single-use, and minting a
new one does not revoke the old — so a customer can hold a working link on
several devices at once.

`/access/session/<id>?token=…` additionally sets an HTTP-only cookie and
redirects to `/session/<id>?token=…`, keeping the token in the destination URL.
That redirect used to strip it, which left the customer looking at a URL with no
credential in it at all: the authority lived only in the cookie, so the address
bar could not be bookmarked, moved to another browser, or reopened after site
data was cleared. A customer who lost that browser profile had no way back and
the seller was the only one who could issue a new link.

The cookie is now a convenience rather than the credential — it keeps a clean
`/session/<id>` working for the browser that booked. `GET /api/sessions`,
`GET /api/customer-history` and `POST /api/payments/checkout` all accept the
token explicitly and fall back to the cookie, so neither path depends on the
other. `/session/<id>/access` hands a cookie-only caller its own token back, and
the page writes it into the address bar with `replaceState`, so even the
browser that made the booking ends up holding a portable URL.

Both Stripe return URLs carry the token too. Without that, a customer who paid
from a second device came back to a page they could not reload.

`Referrer-Policy: strict-origin-when-cross-origin` keeps the token out of the
`Referer` header on the outbound WhatsApp links, which send only the origin.

The one action a durable link must not enable is redirecting the goods.
`confirmDeliveryAddress` answers false once `monto_pagado_inicial > 0`, so the
delivery address freezes the moment money arrives: a forwarded link can read an
order already in flight, never change where it goes.

## Booking Flow

1. The customer or seller selects a slot.
2. The booking API validates the customer details and slot ID.
3. A PostgreSQL transaction locks the selected availability row and creates a 15-minute pending-payment hold.
4. Stripe Test Mode Checkout collects the 20 USD booking fee.
5. Only a signature-verified Stripe webhook confirms the reservation.
6. Expired holds are released atomically; a late successful payment is refunded idempotently.
7. The customer opens the session page while the seller manages the cart.

Slots are generated in one-hour intervals from 9:00 AM through 6:00 PM for the client-specified Nike Sawgrass outlet. A duplicate request for an active hold or confirmed slot receives a conflict response.

## Language

Customer-facing screens (`/`, `/session/<id>`) and the Colombia local-team panel
default to Spanish, matching the client's approved designs and the Colombian
buyer audience, and can be switched to English from the header. The USA
seller/admin dashboard is English only.

The switcher exists because browser translation cannot be used here. Chrome
rewrites text nodes in place while React still holds the nodes it rendered, so
the next re-render throws `NotFoundError` from `removeChild` and the error
boundary replaces the page — after the action that triggered the render has
already committed, which makes a successful write look like a failure. The root
layout therefore sets `translate="no"`, and the translation is the app's own, in
React's render, where the DOM stays React's to manage.

- `src/lib/i18n/locale.ts` — the `Locale` type, the cookie, and `intlLocale`,
  which picks the locale dates and numbers are formatted in.
- `src/lib/i18n/messages.ts` — both dictionaries. Spanish is written first in
  each entry because it is the copy the client approved; entries that
  interpolate a count or an amount are functions, since Spanish and English put
  the value in different places.
- `src/lib/i18n/provider.tsx` — holds the active locale. The initial value is
  read from the cookie on the server, so the first paint is already in the right
  language and `<html lang>` is correct for a screen reader. `useLocale` falls
  back to Spanish rather than throwing when no provider is above it, because
  `PurchaseHistoryTable` is shared with the English staff dashboard.

Switching is client-side: the cookie is not `httpOnly`, so the toggle rewrites
it and updates the context without a round trip. The value carries no
authority — anything unrecognised resolves to Spanish.

`POST /api/payments/checkout` composes its customer-facing errors on the server,
which cannot know which language the reader chose, so it sends a stable `code`
(`src/lib/checkout-errors.ts`) alongside the existing Spanish sentence and the
page translates the code. The sentences are unchanged on purpose: one is pinned
by `scripts/session-contract-smoke-test.mjs`, non-browser callers have nothing
to translate with, and they remain the fallback for an unrecognised code.

Copy that varies by destination country — the adjective in "otro municipio
colombiano", and the local-invoice explanation — is held per language in
`src/lib/countries.ts`. The country's own name is not translated.

## Access Control

Every query runs server-side behind the route handlers below, which authorize
each request before touching PostgreSQL. The application connects as the table
owner and never exposes a database key to any client.

Row Level Security is nevertheless enabled on every public table, with no
policies (migration 015). That is not what section 8 of the specification asked
for — its policies protect an anon key held by the browser, which this
application does not use — but the database is hosted on Supabase, and Supabase
serves PostgREST over the `public` schema to anyone holding the publishable key
whether or not the app touches supabase-js. RLS with no policies denies every
role except the owner, which closes that endpoint. Authorization in the route
handlers remains the real control; this is the floor beneath it.

A migration that adds a table must enable RLS on it explicitly. `npm run
db:check` fails if one does not.


- Staff authenticate through `/login`; database-backed sessions use random tokens stored only as SHA-256 hashes.
- Staff cookies are HTTP-only, same-site, secure in production, and expire after eight hours.
- Seller/admin pages and APIs verify authentication and role authorization on the server.
- Customer order links use random access tokens stored only as hashes. The access route sets an HTTP-only cookie and keeps the token in the order URL, so the link stays usable on any device — see [Customer Order Links](#customer-order-links). The delivery address freezes once the up-front payment lands, which is the one write a shared link must not reach.
- Login and public booking requests are rate limited, and repeated password failures temporarily lock the staff account.

## Live Session Flow

- Seller actions add, remove, and change product quantities through `/api/sessions`.
- The customer and seller session views poll PostgreSQL-backed APIs for updates every 1.5 seconds.
- Closing a session calculates subtotal, tax, and the Brash3D commission using the rates stored on that session. `TAX_RATE_FL` and `FEE_RATE` set the rates for newly created sessions; an existing session keeps the rates it was priced with, so a rate change never reprices a quoted invoice.
- A referrer earns at most `REFERRAL_REWARD_MONTHLY_CAP` complimentary bookings per calendar month.
- Each customer receives a referral code. A referrer earns one 20 USD booking reward only after the referred customer's first 65 percent payment; the next eligible booking automatically consumes that reward.
- Customer history exposes completed purchases to the customer through their secure session access and to the assigned seller through staff authorization.
- The seller chooses the up-front percentage when closing the session. `sesiones_compra.porcentaje_inicial` stores it, and both charges are derived from it: the initial share is rounded to the cent and the balance is the remainder, so the two always sum to the invoice.
- The customer starts the initial Stripe payment after invoicing; the Colombia team initiates the balance Stripe link at delivery or records cash/transfer.
- Those two routes are mutually exclusive and enforced as such. Recording cash or a transfer expires the Stripe balance link, and a charge that still arrives for a settled balance is refunded automatically and recorded — see [Collecting the balance](#collecting-the-balance). A customer who paid 100 percent up front has no balance, and the Colombia team confirms delivery without collecting.
- The customer confirms a Colombia delivery address before the 65 percent Checkout opens.
- The seller creates one labelled individual shipment after the 65 percent payment.
- USA operations attaches prepared shipments to a consolidated box with one courier/tracking number.
- Colombia confirms physical receipt from the digital manifest, then collects the final balance and confirms delivery.
- Each consolidated box shows a settlement summary: total collected on delivery, the Stripe portion (US LLC revenue), and the cash/transfer portion that stays in Colombia as the local team's operating fund. This is accounting metadata only; the system never moves money between the two legal entities.
- A booking whose customer requested a local Brash3D SAS invoice is flagged through the seller panel and the Colombia manifest, so the team knows which orders need one.

## Collecting the balance

The balance can be collected two ways, and a customer must never pay both.

The team copies a Stripe link and sends it over WhatsApp; the customer may then
turn up with cash. Recording that cash used to leave the link payable in Stripe
for hours. Paying it charged the customer twice, and the second charge was
invisible: `processSessionCheckoutEvent` guards its UPDATE on
`monto_pagado_final = 0`, so it matched nothing and returned `ignored` — the
outcome for a checkout id nobody recognises. No payment log, no notification.

Two guards now stand in that gap:

1. **Recording an offline collection closes the link.**
   `takeOpenCheckoutForStage` detaches the stored checkout id and returns it in
   one locked statement (the id comes from a CTE, because `RETURNING` on an
   `UPDATE ... SET x = NULL` reports the NULL it just wrote). The route then
   expires it in Stripe. This runs *after* the transaction commits: the balance
   is recorded either way, and a Stripe outage must not roll back money the
   team is holding.
2. **A charge that still arrives is refunded.** `already_settled` is returned
   for money against a stage that is already paid, read before the UPDATE so it
   is distinguishable from an unknown checkout. The webhook refunds it
   idempotently, then calls back with `duplicateRefunded`, which records a
   `refunded` row in `payment_logs`, notifies the seller, clears the checkout
   id, and only then writes the `stripe_webhook_events` row — so a Stripe retry
   cannot refund twice. This mirrors the late-booking refund exactly.

The offline collection always wins: the cash is physically in hand, so the card
charge is the one reversed and `metodo_pago_recibido` keeps the offline method.

Recording cash or a transfer is confirmed in a dialog, which warns when a Stripe
link for the same balance is still outstanding. It closes the delivery with no
undo, so it is not left one click away in a dropdown.

## UI

- Shared shadcn/ui primitives are kept in `src/components/ui`.
- The seller shell uses the shadcn sidebar and table primitives.
- `next-themes` controls the global light, dark, and system modes.

## Persistence Boundary

`src/lib/store/sessionStore.ts` and `src/lib/store/shippingStore.ts` are the PostgreSQL repository boundary. `src/lib/db.ts` owns the shared connection pool. Docker provides PostgreSQL locally, while tracked numbered SQL migrations provide a path to a managed PostgreSQL production service.
